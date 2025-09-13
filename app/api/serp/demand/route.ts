// app/api/serp/demand/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

/** ----- Mappa regioni IT (per geo più specifico quando possibile) ----- */
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

async function guessGeoFromLatLng(lat?: number, lng?: number): Promise<string> {
  if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return "IT";
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=7&addressdetails=1`;
    const r = await fetch(u, { headers: { "User-Agent": "HospitalityWidget/1.0" }, cache: "no-store" });
    const j = await r.json();
    const state: string = (j?.address?.state || j?.address?.region || j?.address?.county || "").toLowerCase();
    for (const k of Object.keys(ISO_REGION_IT)) if (state.includes(k)) return ISO_REGION_IT[k];
  } catch {}
  return "IT";
}

function parseTimeseries(json: any): { date: string; score: number }[] {
  const tl: any[] = json?.interest_over_time?.timeline_data || [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const ts = row?.timestamp ? Number(row.timestamp) * 1000 : null;
    const v  = Array.isArray(row?.values) ? Number(row.values[0]?.value ?? 0) : 0;
    if (ts != null) out.push({ date: new Date(ts).toISOString().slice(0, 10), score: Math.max(0, Math.min(100, Math.round(v))) });
  }
  return out;
}

function pickTopN(list: string[], n: number) {
  return list.filter(Boolean).map(s => s.trim()).filter((s, i, a) => s.length > 1 && a.indexOf(s) === i).slice(0, n);
}
function bucketsFromRelated(queries: string[]) {
  const q = queries.map(s => s.toLowerCase());
  const channels: Record<string, number> = { booking: 0, airbnb: 0, diretto: 0, expedia: 0, altro: 0 };
  q.forEach(s => {
    if (s.includes("booking")) channels.booking++;
    else if (s.includes("airbnb")) channels.airbnb++;
    else if (s.includes("expedia")) channels.expedia++;
    else if (/(diretto|sito|telefono)/.test(s)) channels.diretto++;
    else channels.altro++;
  });
  const prov: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach(s => {
    if (/(italia|rome|milan|florence|napoli)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });
  const los: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach(s => {
    if (/(1 notte|una notte|weekend)/.test(s)) los["1 notte"]++;
    else if (/(2|3).*(nott[ei])/.test(s)) los["2-3 notti"]++;
    else if (/(4|5|6).*(nott[ei])/.test(s)) los["4-6 notti"]++;
    else if (/(7|settimana|14|due settimane)/.test(s)) los["7+ notti"]++;
  });
  const toArr = (o: Record<string, number>) => Object.entries(o).map(([label, value]) => ({ label, value }));
  return { channels: toArr(channels), provenance: toArr(prov), los: toArr(los) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });

  const topic = (url.searchParams.get("q") || "").trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const monthISO = (url.searchParams.get("monthISO") || "").trim(); // (non obbligatorio qui)
  const parts = (url.searchParams.get("parts") || "trend").split(","); // "trend", "related"
  const cat = url.searchParams.get("cat") || "203";                    // 203 = Travel
  // per avere copertura sufficiente: 12 mesi
  const date = url.searchParams.get("date") || "today 12-m";

  if (!topic) return NextResponse.json({ ok: false, error: "Manca 'q'." }, { status: 400 });

  const geo = await guessGeoFromLatLng(lat, lng);

  // ----- A) Trends (serie) -----
  let trendSeries: { date: string; score: number }[] = [];
  let usage: any | undefined;
  if (parts.includes("trend")) {
    const p = new URLSearchParams({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: topic,
      geo,
      date,
      cat,
      api_key: apiKey,
    });
    const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
    const j = await r.json();
    trendSeries = parseTimeseries(j);
    usage = j?.search_metadata;
  }

  // ----- B) Related Queries (bucket) -----
  let related: { channels: any[]; provenance: any[]; los: any[] } | undefined;
  let note: string | undefined;
  if (parts.includes("related")) {
    const rq = new URLSearchParams({
      engine: "google_trends",
      data_type: "RELATED_QUERIES",
      q: topic,
      geo,
      date,
      cat,
      api_key: apiKey,
    });
    const r2 = await fetch(`https://serpapi.com/search.json?${rq.toString()}`, { cache: "no-store" });
    const j2 = await r2.json();
    const relatedQueries: string[] =
      j2?.related_queries?.flatMap((g: any) => (g?.queries || []).map((x: any) => String(x?.query || ""))) || [];
    if (relatedQueries.length > 0) related = bucketsFromRelated(pickTopN(relatedQueries, 120));
    else note = "Dati Trends senza related queries (campioni ridotti).";
  }

  if (parts.includes("trend") && trendSeries.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "Nessuna serie disponibile per il topic/periodo selezionato.",
      hint: "Prova con 'hotel <città>' e periodo 'today 12-m'."
    }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    topic,
    geo,
    dateRange: date,
    cat,
    series: trendSeries,
    related,
    usage,
    note,
  }, { status: 200 });
}
