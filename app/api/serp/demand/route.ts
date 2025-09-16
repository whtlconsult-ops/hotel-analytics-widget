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

/* ---------- Helpers ---------- */
function parseTimeseries(json: any): { date: string; score: number }[] {
  const tl: any[] = Array.isArray(json?.interest_over_time?.timeline_data)
    ? json.interest_over_time.timeline_data
    : [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const ts = row?.timestamp ? Number(row.timestamp) * 1000 : null;
    const v = Array.isArray(row?.values) ? Number(row.values[0]?.value ?? 0) : 0;
    if (ts != null) out.push({ date: new Date(ts).toISOString().slice(0, 10), score: Math.max(0, Math.min(100, Math.round(v))) });
  }
  return out;
}
const nonZeroCount = (a: {score:number}[]) => a.reduce((acc,x)=> acc + (x.score>0?1:0), 0);

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
    if (/(italia|rome|roma|milan|milano|florence|firenze|napoli|naples)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese|français)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });
  const los: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach(s => {
    if (/(^|\W)(1|una)\s*notte|weekend/.test(s)) los["1 notte"]++;
    else if (/(^|\W)(2|3).*(nott[ei])/.test(s)) los["2-3 notti"]++;
    else if (/(^|\W)(4|5|6).*(nott[ei])/.test(s)) los["4-6 notti"]++;
    else if (/(^|\W)(7|settimana|14|due settimane)/.test(s)) los["7+ notti"]++;
  });
  const toArr = (o: Record<string, number>) => Object.entries(o).map(([label, value]) => ({ label, value }));
  return { channels: toArr(channels), provenance: toArr(prov), los: toArr(los) };
}
function extractRelatedQueries(j2: any): string[] {
  const rq = j2?.related_queries;
  if (!rq) return [];
  if (Array.isArray(rq)) {
    return rq.flatMap((g: any) => (g?.queries || g?.top || g?.rising || []))
             .map((x: any) => String(x?.query || "")).filter(Boolean);
  }
  if (typeof rq === "object") {
    const buckets: any[] = [];
    if (Array.isArray(rq.top)) buckets.push(...rq.top);
    if (Array.isArray(rq.rising)) buckets.push(...rq.rising);
    Object.values(rq).forEach((v: any) => { if (Array.isArray(v)) buckets.push(...v); });
    return buckets.map((x: any) => String(x?.query || "")).filter(Boolean);
  }
  return [];
}

/* ---------- SerpAPI wrappers ---------- */
async function fetchTrends(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"TIMESERIES", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  return { json: j, series: parseTimeseries(j) as {date:string; score:number}[], usage: j?.search_metadata };
}
async function fetchRelated(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"RELATED_QUERIES", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  return extractRelatedQueries(j);
}

/* ---------- Query variants (per aumentare il segnale) ---------- */
function buildQueryVariants(topic: string) {
  const raw = topic.trim();
  // prova a estrarre la città rimuovendo parole turistiche comuni
  let city = raw.replace(/(hotel|alberghi?|b&b|resort|agriturismo|alloggi|alloggio)/ig, "").trim();
  city = city.replace(/\s+/g, " ").trim();
  const v = new Set<string>([raw]);
  if (/hotel/i.test(raw)) {
    v.add(raw.replace(/^\s*(.*?)\s+hotel\b/i, "hotel $1")); // "Firenze hotel" -> "hotel Firenze"
    v.add(raw.replace(/\bhotel\s+(.*)$/i, "$1 hotel"));     // "hotel Firenze" -> "Firenze hotel"
  } else if (city) {
    v.add(`hotel ${city}`);
    v.add(`${city} hotel`);
  }
  if (city) {
    v.add(`${city} alberghi`);
    v.add(`${city} b&b`);
  }
  return Array.from(v).map(s => s.trim()).filter(Boolean).slice(0, 4); // max 4 varianti
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });

    const topic = (url.searchParams.get("q") || "").trim();
    if (!topic) return NextResponse.json({ ok: false, error: "Manca 'q'." }, { status: 400 });

    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const parts = (url.searchParams.get("parts") || "trend").split(",").map(s=>s.trim().toLowerCase());

    const wantCh   = url.searchParams.get("ch")   === "1";
    const wantProv = url.searchParams.get("prov") === "1";
    const wantLos  = url.searchParams.get("los")  === "1";
    const noFlags  = url.searchParams.get("ch")===null && url.searchParams.get("prov")===null && url.searchParams.get("los")===null;

    const cat  = url.searchParams.get("cat")  || "203";         // Travel
    const date = url.searchParams.get("date") || "today 12-m";  // default

    const geoRegion = await guessGeoFromLatLng(lat, lng);
    const notes: string[] = [];

    /* ----- A) Serie con fallback ----- */
    let series: { date: string; score: number }[] = [];
    let usage: any;
    if (parts.includes("trend")) {
      // 1) regionale
      let t = await fetchTrends(apiKey, topic, geoRegion, date, cat);
      series = t.series; usage = t.usage;
      if (nonZeroCount(series) < 3) {
        notes.push("Serie debole su geo regionale → fallback geo=IT.");
        t = await fetchTrends(apiKey, topic, "IT", date, cat);
        series = t.series; usage = usage || t.usage;
      }
      if (nonZeroCount(series) < 3 && date !== "today 5-y") {
        notes.push("Serie ancora debole → fallback periodo today 5-y.");
        t = await fetchTrends(apiKey, topic, "IT", "today 5-y", cat);
        series = t.series; usage = usage || t.usage;
      }
    }

    /* ----- B) Related con fallback + varianti query ----- */
    let related: { channels: any[]; provenance: any[]; los: any[] } | undefined;
    if (parts.includes("related")) {
      const minNeeded = 20;
const maxCalls  = 6;
let calls = 0;

const gather = async (q: string, geo: string, timeframe: string): Promise<string[]> => {
  if (calls >= maxCalls) return [];
  calls++;
  return await fetchRelated(apiKey, q, geo, timeframe, cat);
};

      // 1) tentativi sul topic originale (geo fallback + periodo)
      let pool = new Set<string>(await gather(topic, geoRegion, date));
      if (pool.size < minNeeded) { notes.push("Related poveri su geo regionale → fallback geo=IT."); for (const s of await gather(topic, "IT", date)) pool.add(s); }
      if (pool.size < minNeeded && date !== "today 5-y") { notes.push("Related ancora poveri → fallback periodo today 5-y."); for (const s of await gather(topic, "IT", "today 5-y")) pool.add(s); }

      // 2) se ancora poveri, prova varianti intelligenti della query
      if (pool.size < minNeeded) {
        const variants = buildQueryVariants(topic);
        for (const v of variants) {
          if (pool.size >= minNeeded || calls >= maxCalls) break;
          notes.push(`Aggiunta variante query: "${v}".`);
          for (const s of await gather(v, "IT", "today 5-y")) pool.add(s);
        }
      }

      const queries = Array.from(pool);
      if (queries.length > 0) {
        const all = bucketsFromRelated(pickTopN(queries, 120));
        related = {
          channels:   (noFlags || wantCh)   ? all.channels   : [],
          provenance: (noFlags || wantProv) ? all.provenance : [],
          los:        (noFlags || wantLos)  ? all.los        : [],
        };
      } else {
        related = { channels: [], provenance: [], los: [] };
        notes.push("Related non disponibili (campioni ridotti).");
      }
    }

    if (parts.includes("trend") && series.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna serie disponibile per il topic/periodo selezionato.", hint: "Prova con 'hotel <città>'." },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, topic, geo: geoRegion, dateRange: date, cat, series, related, usage, note: notes.length ? notes.join(" ") : undefined },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
