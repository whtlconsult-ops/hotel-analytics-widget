// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

/* ---------- Util ---------- */
const ISO_REGION_IT: Record<string, string> = {
  "toscana": "IT-52","lombardia": "IT-25","lazio": "IT-62","sicilia": "IT-82",
  "piemonte": "IT-21","veneto": "IT-34","emilia-romagna": "IT-45","puglia": "IT-75",
  "campania": "IT-72","liguria": "IT-42","marche": "IT-57","umbria": "IT-55",
  "abruzzo": "IT-65","calabria": "IT-78","sardegna": "IT-88","friuli-venezia giulia": "IT-36",
  "trentino-alto adige": "IT-32","alto adige": "IT-32","trentino": "IT-32",
  "basilicata": "IT-77","molise": "IT-67","valle d'aosta": "IT-23","valle d’aosta": "IT-23"
};

async function guessGeoFromLatLng(lat?: number, lng?: number, debug = false): Promise<{ geo: string; _dbg?: any }> {
  if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return { geo: "IT" };
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=7&addressdetails=1`;
    const r = await fetch(u, { headers: { "User-Agent": "HospitalityWidget/1.0" }, cache: "no-store" });
    const j = await safeJson(r);
    const state: string = (j?.address?.state || j?.address?.region || j?.address?.county || "").toLowerCase();
    for (const k of Object.keys(ISO_REGION_IT)) if (state.includes(k)) return { geo: ISO_REGION_IT[k], _dbg: debug ? j : undefined };
    return { geo: "IT", _dbg: debug ? j : undefined };
  } catch (e) {
    return { geo: "IT", _dbg: debug ? String(e) : undefined };
  }
}

function parseTimeseries(json: any): { date: string; score: number }[] {
  const tl: any[] = json?.interest_over_time?.timeline_data || json?.timeseries || [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const when =
      row?.time ? new Date(Number(row.time) * 1000) :
      row?.timestamp ? new Date(row.timestamp) :
      row?.formattedTime ? new Date(row.formattedTime) : null;

    const v = Array.isArray(row?.values) && row.values[0]?.value != null
      ? Number(row.values[0].value)
      : Number(row?.value ?? row?.score ?? 0);

    if (when && Number.isFinite(v)) {
      const iso = new Date(when).toISOString().slice(0, 10);
      out.push({ date: iso, score: Math.max(0, Math.min(100, Math.round(v))) });
    }
  }
  return out;
}

function pickTopN(list: string[], n: number): string[] {
  return list.filter(Boolean).map(s=>s.trim()).filter((s,i,a)=>s.length>1 && a.indexOf(s)===i).slice(0,n);
}

function bucketsFromRelated(queries: string[]) {
  const q = queries.map(s=>s.toLowerCase());
  const channels: Record<string, number> = { booking:0, airbnb:0, diretto:0, expedia:0, altro:0 };
  q.forEach(s=>{
    if (s.includes("booking")) channels.booking++;
    else if (s.includes("airbnb")) channels.airbnb++;
    else if (s.includes("expedia")) channels.expedia++;
    else if (s.includes("diretto") || s.includes("sito") || s.includes("telefono")) channels.diretto++;
    else channels.altro++;
  });
  const prov: Record<string, number> = { italia:0, germania:0, francia:0, usa:0, uk:0, altro:0 };
  q.forEach(s=>{
    if (/(italia|rome|milan|florence|napoli|torino|bologna)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese|lyon)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });
  const los: Record<string, number> = { "1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0 };
  q.forEach(s=>{
    if (/(1 notte|una notte|weekend)/.test(s)) los["1 notte"]++;
    else if (/(2|3).*(nott[ei])/.test(s)) los["2-3 notti"]++;
    else if (/(4|5|6).*(nott[ei])/.test(s)) los["4-6 notti"]++;
    else if (/(7|settimana|14|due settimane)/.test(s)) los["7+ notti"]++;
  });
  const toArr = (o: Record<string, number>) => Object.entries(o).map(([label,value])=>({ label, value }));
  return { channels: toArr(channels), provenance: toArr(prov), los: toArr(los) };
}

function mapScoreToPressure(s: number) { return Math.round(50 + (s/100)*110); } // 50..160
function mapScoreToADR(s: number) { return Math.round(80 + (s/100)*100); }     // 80..180

async function safeJson(r: Response) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

/* ---------- Handler ---------- */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante (Vercel → Project → Settings → Environment Variables)" }, { status: 500 });
  }

  const qRaw = (url.searchParams.get("q") || "").trim();
  if (!qRaw) return NextResponse.json({ ok: false, error: "Parametro 'q' mancante" }, { status: 400 });

  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const monthISO = (url.searchParams.get("monthISO") || "").trim();

  const topic = /hotel/i.test(qRaw) ? qRaw : `${qRaw} hotel`;
  const { geo, _dbg: geoDbg } = await guessGeoFromLatLng(lat, lng, debug);
  const dateRange = "today 3-m";

  // --- 1) TIMESERIES ---
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: topic,
    geo,
    date: dateRange,
    api_key: key,
  });

  let j: any;
  try {
    const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
    if (!r.ok) {
      const body = await safeJson(r);
      return NextResponse.json({ ok: false, error: "SerpAPI TIMESERIES non OK", status: r.status, body, debug: { geo, topic, dateRange, geoDbg } }, { status: 502 });
    }
    j = await safeJson(r);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Errore fetch SerpAPI TIMESERIES: ${String(e?.message||e)}`, debug: { geo, topic, dateRange, geoDbg } }, { status: 502 });
  }

  const series = parseTimeseries(j);
  let relatedQueries: string[] =
    j?.related_queries?.flatMap((g: any) => (g?.queries || []).map((x: any) => String(x?.query || ""))) || [];

  // --- 2) RELATED_QUERIES (fallback) ---
  if (relatedQueries.length === 0) {
    try {
      const rq = new URLSearchParams({
        engine: "google_trends",
        data_type: "RELATED_QUERIES",
        q: topic,
        geo,
        date: dateRange,
        api_key: key,
      });
      const r2 = await fetch(`https://serpapi.com/search.json?${rq.toString()}`, { cache: "no-store" });
      if (r2.ok) {
        const j2 = await safeJson(r2);
        relatedQueries =
          j2?.related_queries?.flatMap((g: any) => (g?.queries || []).map((x: any) => String(x?.query || ""))) || [];
      }
    } catch {}
  }

  // --- Trend (grafico linea) ---
  const trend = series.map(s => ({
    dateLabel: s.date.slice(8,10) + " " + new Date(s.date).toLocaleString("it-IT", { month: "short" }),
    value: s.score
  }));

  // --- Calendario ---
  const now = new Date();
  const mStart = monthISO && /^\d{4}-\d{2}-\d{2}$/.test(monthISO)
    ? new Date(monthISO)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const mEnd = new Date(mStart.getFullYear(), mStart.getMonth()+1, 0);

  const days: string[] = [];
  for (let d = new Date(mStart.getTime()); d <= mEnd; d.setDate(d.getDate()+1)) {
    days.push(new Date(d.getTime()).toISOString().slice(0,10));
  }

  const scoreByDay = new Map(series.map(s => [s.date, s.score]));
  const byDate = days.map(iso => {
    const s = scoreByDay.get(iso) ?? 50;
    return { dateISO: iso, pressure: mapScoreToPressure(s), adr: mapScoreToADR(s) };
    // volendo: pressure potrebbe pesare weekend ecc.
  });

  // --- Buckets da related queries ---
  const buckets = relatedQueries.length ? bucketsFromRelated(pickTopN(relatedQueries, 100)) : null;

  const payload: any = {
    ok: series.length > 0,
    topic,
    geo,
    dateRange,
    byDate,
    channels: buckets ? buckets.channels.map(x=>({ channel: x.label, value: x.value })) : [],
    origins:  buckets ? buckets.provenance.map(x=>({ name: x.label[0].toUpperCase()+x.label.slice(1), value: x.value })) : [],
    losDist:  buckets ? buckets.los.map(x=>({ bucket: x.label, value: x.value })) : [],
    trend,
    note: relatedQueries.length ? undefined : "Dati Trends senza related queries (campioni ridotti)."
  };

  if (debug) payload._debug = { geoDbg, serp_meta: j?.search_metadata || j?.search_parameters || null };

  if (!payload.ok) {
    // serie vuota → informo con dettaglio
    return NextResponse.json({ ok: false, error: "Nessuna serie disponibile dai Trends per questo topic/periodo.", debug: payload._debug ?? { topic, geo, dateRange } }, { status: 200 });
  }

  return NextResponse.json(payload, { status: 200 });
}
