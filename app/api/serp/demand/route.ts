// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

/**
 * INPUT (GET):
 *  - q: string                 // es: "hotel firenze"
 *  - lat, lng: number          // per dedurre la regione IT (geo)
 *  - monthISO: string          // es: "2025-09-01" (usato per costruire il calendario mensile)
 *  - radiusKm, mode, types     // facoltativi (li ignoriamo per ora)
 *
 * OUTPUT: schema atteso dal frontend (SerpDemandPayload)
 */

const ISO_REGION_IT: Record<string, string> = {
  "toscana": "IT-52", "lombardia": "IT-25", "lazio": "IT-62", "sicilia": "IT-82",
  "piemonte": "IT-21", "veneto": "IT-34", "emilia-romagna": "IT-45", "puglia": "IT-75",
  "campania": "IT-72", "liguria": "IT-42", "marche": "IT-57", "umbria": "IT-55",
  "abruzzo": "IT-65", "calabria": "IT-78", "sardegna": "IT-88",
  "friuli-venezia giulia": "IT-36", "trentino-alto adige": "IT-32",
  "alto adige": "IT-32", "trentino": "IT-32",
  "basilicata": "IT-77", "molise": "IT-67",
  "valle d'aosta": "IT-23", "valle d’aosta": "IT-23"
};

// ---------- helpers ----------
function daysOfMonthISO(monthISO: string): string[] {
  // monthISO formato "YYYY-MM-01"
  try {
    const y = Number(monthISO.slice(0, 4));
    const m = Number(monthISO.slice(5, 7)) - 1;
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  } catch {
    // mese corrente fallback
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
}

async function guessGeoFromLatLng(lat?: number, lng?: number): Promise<string> {
  if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return "IT";
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=7&addressdetails=1`;
    const r = await fetch(u, {
      headers: { "User-Agent": "HospitalityWidget/1.0 (+contact:owner)" },
      cache: "no-store",
    });
    const j = await r.json();
    const state: string =
      (j?.address?.state || j?.address?.region || j?.address?.county || "")
        .toLowerCase();
    for (const k of Object.keys(ISO_REGION_IT)) {
      if (state.includes(k)) return ISO_REGION_IT[k];
    }
  } catch {/* ignore */}
  return "IT";
}

function parseTimeseries(json: any): { dateISO: string; score: number }[] {
  const tl: any[] =
    json?.interest_over_time?.timeline_data ||
    json?.timeseries ||
    [];
  const out: { dateISO: string; score: number }[] = [];
  for (const row of tl) {
    const when =
      row?.time
        ? new Date(Number(row.time) * 1000)
        : row?.timestamp
        ? new Date(row.timestamp)
        : row?.formattedTime
        ? new Date(row.formattedTime)
        : null;
    const v =
      Array.isArray(row?.values) && row.values[0]?.value != null
        ? Number(row.values[0].value)
        : Number(row?.value ?? row?.score ?? 0);
    if (when && !Number.isNaN(v)) {
      out.push({
        dateISO: new Date(when).toISOString().slice(0, 10),
        score: Math.max(0, Math.min(100, Math.round(v))),
      });
    }
  }
  return out;
}

function pickTopN(list: string[], n: number): string[] {
  return list
    .filter(Boolean)
    .map((s) => s.trim())
    .filter((s, i, a) => s.length > 1 && a.indexOf(s) === i)
    .slice(0, n);
}

function bucketsFromRelated(queries: string[]) {
  const q = queries.map((s) => s.toLowerCase());

  // canali
  const channels: Record<string, number> = { booking: 0, airbnb: 0, diretto: 0, expedia: 0, altro: 0 };
  q.forEach((s) => {
    if (s.includes("booking")) channels.booking++;
    else if (s.includes("airbnb")) channels.airbnb++;
    else if (s.includes("expedia")) channels.expedia++;
    else if (s.includes("diretto") || s.includes("sito") || s.includes("telefono")) channels.diretto++;
    else channels.altro++;
  });

  // provenienza (molto euristico)
  const prov: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach((s) => {
    if (/(italia|rome|milan|florence|napoli|torino|bologna|venezia)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese|marseille|lyon)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami|san francisco)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra|manchester)/.test(s)) prov.uk++;
    else prov.altro++;
  });

  // LOS
  const los: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach((s) => {
    if (/(1 notte|una notte|weekend)/.test(s)) los["1 notte"]++;
    else if (/(2|3).*(nott[ei])/.test(s)) los["2-3 notti"]++;
    else if (/(4|5|6).*(nott[ei])/.test(s)) los["4-6 notti"]++;
    else if (/(7|settimana|14|due settimane)/.test(s)) los["7+ notti"]++;
  });

  const toArr = (o: Record<string, number>) =>
    Object.entries(o).map(([label, value]) => ({ label, value }));

  return {
    channels: toArr(channels),
    provenance: toArr(prov),
    los: toArr(los),
  };
}

// ---------- handler ----------
export async function GET(req: Request) {
  const url = new URL(req.url);

  const topic = (url.searchParams.get("q") || "").trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const monthISO = (url.searchParams.get("monthISO") || "").trim();
  const mode = (url.searchParams.get("mode") || "zone").trim(); // per ADR sintetico

  if (!topic) {
    return NextResponse.json({ ok: false, error: "Missing 'q'." }, { status: 400 });
  }

  // ⚠️ Nome variabile d'ambiente: usa SERPAPI_KEY
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing SERPAPI_KEY env." }, { status: 500 });
  }

  const geo = await guessGeoFromLatLng(lat, lng);
  const dateRange = "today 3-m"; // sufficiente per trend recente

  // --- 1) Timeseries Google Trends ---
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: topic,
    geo,
    date: dateRange,
    api_key: apiKey,
  });

  const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
  const j = await r.json();
  const series = parseTimeseries(j); // [{dateISO, score}]

  // --- 2) Related queries (per bucket) ---
  let relatedQueries: string[] =
    j?.related_queries?.flatMap((g: any) =>
      (g?.queries || []).map((x: any) => String(x?.query || ""))
    ) || [];

  if (relatedQueries.length === 0) {
    try {
      const rq = new URLSearchParams({
        engine: "google_trends",
        data_type: "RELATED_QUERIES",
        q: topic,
        geo,
        date: dateRange,
        api_key: apiKey,
      });
      const r2 = await fetch(`https://serpapi.com/search.json?${rq.toString()}`, { cache: "no-store" });
      const j2 = await r2.json();
      relatedQueries =
        j2?.related_queries?.flatMap((g: any) =>
          (g?.queries || []).map((x: any) => String(x?.query || ""))
        ) || [];
    } catch {/* ignore */}
  }

  // --- 3) Trasformazioni allo schema del frontend ---
  // trend per LineChart (dateLabel breve IT)
  const trend = series.map((pt) => {
    const d = new Date(pt.dateISO + "T00:00:00Z");
    const label = d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
    return { dateLabel: label, value: pt.score };
  });

  // calendario byDate (mese selezionato): mappo lo score 0..100 → "pressure" 60..160
  // e ADR sintetico: 90 + score*0.6 (+15 se competitor)
  const days = daysOfMonthISO(monthISO || (series[0]?.dateISO ?? new Date().toISOString().slice(0, 10)));
  const scoreByISO = new Map(series.map((s) => [s.dateISO, s.score]));
  const byDate = days.map((iso) => {
    const score = scoreByISO.get(iso) ?? 50; // neutro se manca
    const pressure = 60 + Math.round(score);       // scala semplice
    const adr = Math.round(90 + score * 0.6 + (mode === "competitor" ? 15 : 0));
    return { dateISO: iso, pressure, adr };
  });

  // bucket euristici dai related
  const rel = relatedQueries.length > 0 ? bucketsFromRelated(pickTopN(relatedQueries, 100)) : null;

  const channels = (rel?.channels || []).map((x) => ({ channel: x.label.charAt(0).toUpperCase() + x.label.slice(1), value: x.value }));
  const origins = (rel?.provenance || []).map((x) => ({
    name: x.label === "usa" ? "USA" : x.label.toUpperCase().replace("ITALIA", "Italia").replace("GERMANIA","Germania").replace("FRANCIA","Francia").replace("UK","UK"),
    value: x.value
  }));
  const losDist = (rel?.los || []).map((x) => ({ bucket: x.label, value: x.value }));

  // --- 4) Esito ---
  const payload: any = {
    ok: true,
    byDate,
    channels,
    origins,
    losDist,
    trend,
    usage: j?.search_metadata || j?.search_parameters || undefined,
  };

  if (series.length === 0) {
    payload.ok = false;
    payload.error = "Nessuna serie disponibile per il topic/periodo selezionato.";
  } else if (!rel) {
    payload.note = "Dati Trends senza related queries (campioni ridotti).";
  }

  return NextResponse.json(payload, { status: 200 });
}
