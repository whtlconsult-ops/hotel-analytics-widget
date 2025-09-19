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
  const channels: Record<string, number> = { booking: 0, airbnb: 0, diretto: 0, expedia: 0, altro: 0 };
  q.forEach(s => {
    if (/\bbooking(\.com)?\b/.test(s)) channels.booking++;
    else if (/\bair\s*bnb|airbnb\b/.test(s)) channels.airbnb++;
    else if (/\bexpedia|hotels\.com|orbitz|vrbo|ebookers\b/.test(s)) channels.expedia++;
    else if (/(diretto|sito\s*ufficiale|prenota\s*dal|telefono|call\s*center)/.test(s)) channels.diretto++;
    else channels.altro++;
  });
  const prov: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach(s => {
    if (/(italia|rome|roma|milan|milano|florence|firenze|napoli|naples|venice|venezia|turin|torino|bologna)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|frankfurt|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|marseille|lyon|français|francese)/.test(s)) prov.francia++;
    else if (/(usa|united states|new york|los angeles|miami|chicago|boston)/.test(s)) prov.usa++;
    else if (/(uk|united kingdom|london|british|inghilterra|manchester)/.test(s)) prov.uk++;
    else prov.altro++;
  });
  const los: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach(s => {
    if (/(^|\W)(1|una)\s*notte|weekend\b/.test(s)) los["1 notte"]++;
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

/** ----- SerpAPI wrappers (cache 6h) ----- */
const serpFetch = (u: string) =>
  fetch(u, { cache: "force-cache", next: { revalidate: 21600 } }) // 6h
    .then(r => r.json()).catch(()=> ({}));

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

/** Query variants */
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

/** Blend regione + nazionale per serie più stabili */
function blendSeries(a: {date:string;score:number}[], b: {date:string;score:number}[], wa=0.6, wb=0.4) {
  const m = new Map<string, number>();
  a.forEach(p => m.set(p.date, (m.get(p.date)||0) + wa*(p.score||0)));
  b.forEach(p => m.set(p.date, (m.get(p.date)||0) + wb*(p.score||0)));
  return Array.from(m.entries()).map(([date,score])=>({date, score: Math.round(score)})).sort((x,y)=> x.date.localeCompare(y.date));
}

/** --------- ROUTE --------- */
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

    const cat   = url.searchParams.get("cat")  || "203"; // Travel
    // supporto range personalizzato: ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const from  = url.searchParams.get("from");
    const to    = url.searchParams.get("to");
    const dateQ = url.searchParams.get("date") || (from && to ? `${from} ${to}` : "today 12-m");

    const geoRegion = await guessGeoFromLatLng(lat, lng);
    const notes: string[] = [];

    /* ----- A) Serie con macro-area mix + fallback ----- */
    let series: { date: string; score: number }[] = [];
    let usage: any;
    if (parts.includes("trend")) {
      // Regione
      let tRegion = await fetchTrends(apiKey, topic, geoRegion, dateQ, cat);
      // Nazionale
      let tNat    = await fetchTrends(apiKey, topic, "IT", dateQ, cat);

      // Se regione debole, aumenta peso nazionale
      const nzRegion = nonZeroCount(tRegion.series);
      const nzNat    = nonZeroCount(tNat.series);
      let wa = 0.65, wb = 0.35;
      if (nzRegion < 3 && nzNat >= 3) { wa = 0.3; wb = 0.7; notes.push("Serie regionale debole → pesata su nazionale."); }
      if (nzRegion === 0 && nzNat === 0 && dateQ !== "today 5-y") {
        notes.push("Serie ancora debole → periodo today 5-y.");
        tRegion = await fetchTrends(apiKey, topic, geoRegion, "today 5-y", cat);
        tNat    = await fetchTrends(apiKey, topic, "IT",       "today 5-y", cat);
      }

      series = blendSeries(tRegion.series, tNat.series, wa, wb);
      usage  = tRegion.usage || tNat.usage;
      if (nonZeroCount(series) === 0) {
        return NextResponse.json(
          { ok: false, error: "Nessuna serie disponibile per il topic/periodo selezionato.", hint: "Prova con 'hotel <città>'." },
          { status: 200 }
        );
      }
    }

    /* ----- B) Related: fallback + topics + varianti + geoMap per Provenienza ----- */
    let related: { channels: any[]; provenance: any[]; los: any[] } | undefined;

    if (parts.includes("related")) {
      const minNeeded = 30;
      const maxCalls  = 8;
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

      // Topic originale, regione → nazionale → 5y
      let pool = new Set<string>(await gatherQ(topic, geoRegion, dateQ));
      if (pool.size < minNeeded) { notes.push("Related poveri su geo regionale → nazionale."); for (const s of await gatherQ(topic, "IT", dateQ)) pool.add(s); }
      if (pool.size < minNeeded && !/5-y$/.test(dateQ)) { notes.push("Related ancora poveri → periodo today 5-y."); for (const s of await gatherQ(topic, "IT", "today 5-y")) pool.add(s); }

      // Aggiungi TOPICS
      if (pool.size < minNeeded) { notes.push("Aggiunti related TOPICS."); for (const s of await gatherT(topic, "IT", "today 5-y")) pool.add(s); }

      // Varianti query
      if (pool.size < minNeeded) {
        const variants = buildQueryVariants(topic);
        for (const v of variants) {
          if (pool.size >= minNeeded || calls >= maxCalls) break;
          notes.push(`Variante query: "${v}".`);
          for (const s of await gatherQ(v, "IT", "today 5-y")) pool.add(s);
          if (pool.size < minNeeded) for (const s of await gatherT(v, "IT", "today 5-y")) pool.add(s);
        }
      }

      let all = bucketsFromRelated(pickTopN(Array.from(pool), 160));

      // Provenienza fallback con GEO_MAP mondiale se vuoto
      const provSum = all.provenance.reduce((a,b)=> a + (b.value||0), 0);
      if (provSum === 0) {
        const gm = await fetchGeoMap(apiKey, topic, "", "today 5-y", cat);
        if (gm.length > 0) {
          const acc: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
          gm.forEach(row => {
            const s = (row.code || row.name || "").toLowerCase();
            if (s==="it"||/ital/.test(s)||/rome|roma|florence|firenze|milan|milano|venice|venezia/.test(s)) acc.italia += row.value||0;
            else if (s==="de"||/german|deutsch|berlin|munich|frankfurt/.test(s)) acc.germania += row.value||0;
            else if (s==="fr"||/france|franc|paris|lyon|marseille/.test(s)) acc.francia += row.value||0;
            else if (s==="us"||s==="usa"||/united states|new york|los angeles|miami|boston|chicago/.test(s)) acc.usa += row.value||0;
            else if (s==="gb"||s==="uk"||/united kingdom|london|british|inghilterra|manchester/.test(s)) acc.uk += row.value||0;
            else acc.altro += row.value||0;
          });
          all.provenance = Object.entries(acc).map(([label,value])=>({label,value}));
          notes.push("Provenienza ricostruita da GEO_MAP.");
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
      ) notes.push("Related non disponibili (campioni ridotti).");
    }

    return NextResponse.json(
      { ok: true, topic, geo: geoRegion, dateRange: dateQ, cat, series, related, usage, note: notes.length ? notes.join(" ") : undefined },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
