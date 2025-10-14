export const runtime = "nodejs";
import { NextResponse } from "next/server";

/** ----- Geo helper (IT regioni) ----- */
const ISO_REGION_IT: Record<string, string> = {
  "toscana": "IT-52","lombardia":"IT-25","lazio":"IT-62","sicilia":"IT-82","piemonte":"IT-21",
  "veneto":"IT-34","emilia-romagna":"IT-45","puglia":"IT-75","campania":"IT-72","liguria":"IT-42",
  "marche":"IT-57","umbria":"IT-55","abruzzo":"IT-65","calabria":"IT-78","sardegna":"IT-88",
  "friuli-venezia giulia":"IT-36","trentino-alto adige":"IT-32","alto adige":"IT-32","trentino":"IT-32",
  "basilicata":"IT-77","molise":"IT-67","valle d'aosta":"IT-23","valle d’aosta":"IT-23"
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

/** ----- Utils ----- */
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
const pickTopN = (list: string[], n: number) =>
  list.filter(Boolean).map(s=>s.trim()).filter((s,i,a)=> s.length>1 && a.indexOf(s)===i).slice(0,n);

function bucketsFromRelated(queries: string[]) {
  const q = queries.map(s => s.toLowerCase());

  // CHANNElS: espandi i sinonimi → poi riduci ai 4 bucket richiesti
  const channels: Record<string, number> = { booking: 0, airbnb: 0, diretto: 0, expedia: 0, altro: 0 };
  q.forEach(s => {
    if (/\bbooking(\.com)?\b/.test(s)) channels.booking++;
    else if (/\bair\s*bnb|airbnb\b/.test(s)) channels.airbnb++;
    else if (/\bexpedia|hotels\.com|orbitz|vrbo|ebookers\b/.test(s)) channels.expedia++;
    else if (/(diretto|sito\s*ufficiale|prenota\s*dal|telefono|call\s*center)/.test(s)) channels.diretto++;
    else channels.altro++;
  });

  // PROVENIENZA (query words)
  const provCount: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach(s => {
    if (/(italia|rome|roma|milan|milano|florence|firenze|napoli|naples|venice|venezia|turin|torino|bologna)/.test(s)) provCount.italia++;
    else if (/(german|berlin|munich|frankfurt|deutsch)/.test(s)) provCount.germania++;
    else if (/(france|paris|marseille|lyon|français|francese)/.test(s)) provCount.francia++;
    else if (/(usa|united states|new york|los angeles|miami|chicago|boston)/.test(s)) provCount.usa++;
    else if (/(uk|united kingdom|london|british|inghilterra|manchester)/.test(s)) provCount.uk++;
    else provCount.altro++;
  });

  // LOS (query words)
  const losBuckets: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach(s => {
    if (/(^|\W)(1|una)\s*notte|weekend\b/.test(s)) losBuckets["1 notte"]++;
    else if (/(^|\W)(2|3).*(nott[ei])/.test(s)) losBuckets["2-3 notti"]++;
    else if (/(^|\W)(4|5|6).*(nott[ei])/.test(s)) losBuckets["4-6 notti"]++;
    else if (/(^|\W)(7|settimana|14|due settimane)/.test(s)) losBuckets["7+ notti"]++;
  });

  const toArr = (o: Record<string, number>) => Object.entries(o).map(([label, value]) => ({ label, value }));
  return { channels: toArr(channels), provenance: toArr(provCount), los: toArr(losBuckets) };
}

/** Related Queries / Topics parser */
function extractRelatedQueries(j2: any): string[] {
  const rq = j2?.related_queries;
  if (!rq) return [];
  if (Array.isArray(rq)) {
    return rq.flatMap((g: any) => (g?.queries || g?.top || g?.rising || []))
             .map((x: any) => String(x?.query || "")).filter(Boolean);
  }
  if (typeof rq === "object") {
    const arr: any[] = [];
    if (Array.isArray(rq.top)) arr.push(...rq.top);
    if (Array.isArray(rq.rising)) arr.push(...rq.rising);
    Object.values(rq).forEach((v: any) => { if (Array.isArray(v)) arr.push(...v); });
    return arr.map((x: any) => String(x?.query || "")).filter(Boolean);
  }
  return [];
}
function extractRelatedTopics(j2: any): string[] {
  const rt = j2?.related_topics;
  if (!rt) return [];
  const pull = (list: any[]) => list.map(x => String(x?.topic_title || x?.title || x?.query || "")).filter(Boolean);
  if (Array.isArray(rt)) return rt.flatMap((g: any)=> pull(g?.topics || g?.top || g?.rising || []));
  if (typeof rt === "object") {
    const arr: any[] = [];
    if (Array.isArray(rt.top)) arr.push(...rt.top);
    if (Array.isArray(rt.rising)) arr.push(...rt.rising);
    Object.values(rt).forEach((v: any)=>{ if (Array.isArray(v)) arr.push(...v); });
    return pull(arr);
  }
  return [];
}

/** GeoMap → paese e score (per Provenienza fallback) */
function extractGeoMapCountries(j: any): Array<{ code?: string; name: string; value: number }> {
  const gm = j?.interest_by_region ?? j?.geo_map ?? j?.geoMap;
  const list: any[] =
    (Array.isArray(gm?.geo_map_data) ? gm.geo_map_data :
     Array.isArray(gm?.geoMapData)   ? gm.geoMapData   :
     Array.isArray(gm?.data)         ? gm.data         : []);
  return list.map((row: any) => ({
    code: row?.geo_code || row?.geoCode || row?.geo || row?.country_code,
    name: String(row?.geo_name || row?.geoName || row?.country || row?.name || ""),
    value: Number(row?.value || row?.score || row?.interest || 0)
  })).filter(x => x.name);
}

/** ----- SerpAPI wrappers (con caching lato Vercel) ----- */
const serpFetch = async (u: string, timeoutMs = 8000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, { cache: "force-cache", next: { revalidate: 21600 }, signal: ctrl.signal });
    return await r.json();
  } catch {
    return {};
  } finally {
    clearTimeout(id);
  }
};

async function fetchTrends(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"TIMESERIES", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
  return { json: j, series: parseTimeseries(j) as {date:string; score:number}[], usage: j?.search_metadata };
}
async function fetchRelatedQueries(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"RELATED_QUERIES", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
  return extractRelatedQueries(j);
}
async function fetchRelatedTopics(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"RELATED_TOPICS", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
  return extractRelatedTopics(j);
}
async function fetchGeoMap(apiKey: string, q: string, geo: string, date: string, cat: string) {
  const p = new URLSearchParams({ engine:"google_trends", data_type:"GEO_MAP", q, geo, date, cat, api_key: apiKey, hl:"it" });
  const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
  return extractGeoMapCountries(j);
}

/** Query variants (per aumentare segnale) */
function buildQueryVariants(topic: string) {
  const raw = topic.trim();
  let city = raw.replace(/(hotel|alberghi?|b&b|resort|agriturismo|alloggi|alloggio)/ig, "").trim();
  city = city.replace(/\s+/g, " ").trim();
  const set = new Set<string>([raw]);
  if (/hotel/i.test(raw)) { set.add(raw.replace(/^\s*(.*?)\s+hotel\b/i,"hotel $1")); set.add(raw.replace(/\bhotel\s+(.*)$/i,"$1 hotel")); }
  else if (city) { set.add(`hotel ${city}`); set.add(`${city} hotel`); }
  if (city) { set.add(`${city} alberghi`); set.add(`${city} b&b`); }
  return Array.from(set).map(s=>s.trim()).filter(Boolean).slice(0,5);
}

/** Mappa paese → bucket (Italia/Germania/Francia/USA/UK/Altro) */
function countryBucket(nameOrCode: string) {
  const s = (nameOrCode||"").toLowerCase();
  if (s==="it"||/ital/.test(s)||/italia/.test(s)||/rome|roma|florence|firenze|milan|milano|venice|venezia/.test(s)) return "italia";
  if (s==="de"||/german|deutsch|berlin|munich|frankfurt/.test(s)) return "germania";
  if (s==="fr"||/france|franc|paris|lyon|marseille/.test(s)) return "francia";
  if (s==="us"||s==="usa"||/united states|new york|los angeles|miami|boston|chicago/.test(s)) return "usa";
  if (s==="gb"||s==="uk"||/united kingdom|london|british|inghilterra|manchester/.test(s)) return "uk";
  return "altro";
}

/** --------- ROUTE --------- */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fast = url.searchParams.get("fast") === "1";
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

    /* ----- A) Serie con fallback progressivo ----- */
    let series: { date: string; score: number }[] = [];
    let usage: any;
    if (parts.includes("trend")) {
      // 1) regionale
      let t = await fetchTrends(apiKey, topic, geoRegion, date, cat);
      series = t.series; usage = t.usage;
      if (nonZeroCount(series) < 3) { // poca dinamica → prova nazionale
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

    /* ----- B) Related: fallback + topics + varianti + geoMap per Provenienza ----- */
    let related: { channels: any[]; provenance: any[]; los: any[] } | undefined;

    if (parts.includes("related")) {
      const minNeeded = fast ? 10 : 30;   // FAST → soglia più bassa
      const maxCalls  = fast ? 2  : 8;    // FAST → poche chiamate
      let calls = 0;

      const gatherQ = async (q: string, geo: string, timeframe: string): Promise<string[]> => {
        if (calls >= maxCalls) return [];
        calls++;
        return await fetchRelatedQueries(apiKey, q, geo, timeframe, cat);
      };
      const gatherT = async (q: string, geo: string, timeframe: string): Promise<string[]> => {
        if (calls >= maxCalls) return [];
        calls++;
        return await fetchRelatedTopics(apiKey, q, geo, timeframe, cat);
      };

      // 1) tentativi sul topic originale (queries)
      let pool = new Set<string>(await gatherQ(topic, geoRegion, date));
      if (pool.size < minNeeded) { notes.push("Related poveri su geo regionale → fallback geo=IT."); for (const s of await gatherQ(topic, "IT", date)) pool.add(s); }
      if (pool.size < minNeeded && date !== "today 5-y") { notes.push("Related ancora poveri → periodo today 5-y."); for (const s of await gatherQ(topic, "IT", "today 5-y")) pool.add(s); }

      // 2) aggiungi anche i TOPICS (nomi) per aumentare segnale canali/LOS
      if (pool.size < minNeeded) {
        notes.push("Aggiunti related TOPICS per aumentare segnale.");
        for (const s of await gatherT(topic, "IT", "today 5-y")) pool.add(s);
      }

      // 3) varianti query (hotel <città>, <città> hotel, alberghi, b&b)
      if (pool.size < minNeeded) {
        const variants = buildQueryVariants(topic);
        for (const v of variants) {
          if (pool.size >= minNeeded || calls >= maxCalls) break;
          notes.push(`Variante query: "${v}".`);
          for (const s of await gatherQ(v, "IT", "today 5-y")) pool.add(s);
          if (pool.size < minNeeded) for (const s of await gatherT(v, "IT", "today 5-y")) pool.add(s);
        }
      }

      // Buckets da queries/topics
      const queries = Array.from(pool);
      let all = bucketsFromRelated(pickTopN(queries, 160));

      // 4) PROVENIENZA fallback con GEO_MAP globale (se quasi zero)
      const provSum = all.provenance.reduce((a,b)=> a + (b.value||0), 0);
      if (provSum === 0) {
        // usa geo worldwide per capire da quali paesi arriva interesse
        const gm = await fetchGeoMap(apiKey, topic, "", "today 5-y", cat); // "" = mondo
        if (gm.length > 0) {
          const acc: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
          gm.forEach(row => { acc[countryBucket(row.code || row.name)] += row.value || 0; });
          all.provenance = Object.entries(acc).map(([label,value]) => ({ label, value }));
          notes.push("Provenienza ricostruita da mappa geografica (GEO_MAP).");
        }
      }

      related = {
        channels:   (noFlags || wantCh)   ? all.channels   : [],
        provenance: (noFlags || wantProv) ? all.provenance : [],
        los:        (noFlags || wantLos)  ? all.los        : [],
      };

      if (
        related.channels.every(x=>x.value===0) &&
        related.provenance.every(x=>x.value===0) &&
        related.los.every(x=>x.value===0)
      ) {
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
