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
  const tl: any[] = Array.isArray(json?.interest_over_time?.timeline_data)
    ? json.interest_over_time.timeline_data
    : [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const ts = row?.timestamp ? Number(row.timestamp) * 1000 : null;
    const v = Array.isArray(row?.values) ? Number(row.values[0]?.value ?? 0) : 0;
    if (ts != null) {
      out.push({ date: new Date(ts).toISOString().slice(0, 10), score: Math.max(0, Math.min(100, Math.round(v))) });
    }
  }
  return out;
}

function pickTopN(list: string[], n: number) {
  return list
    .filter(Boolean)
    .map((s) => s.trim())
    .filter((s, i, a) => s.length > 1 && a.indexOf(s) === i)
    .slice(0, n);
}

function bucketsFromRelated(queries: string[]) {
  const q = queries.map((s) => s.toLowerCase());

  const channels: Record<string, number> = { booking: 0, airbnb: 0, diretto: 0, expedia: 0, altro: 0 };
  q.forEach((s) => {
    if (s.includes("booking")) channels.booking++;
    else if (s.includes("airbnb")) channels.airbnb++;
    else if (s.includes("expedia")) channels.expedia++;
    else if (/(diretto|sito|telefono)/.test(s)) channels.diretto++;
    else channels.altro++;
  });

  const prov: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach((s) => {
    if (/(italia|rome|roma|milan|milano|florence|firenze|napoli|naples)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese|français)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });

  const los: Record<string, number> = { "1 notte": 0, "2-3 notti": 0, "4-6 notti": 0, "7+ notti": 0 };
  q.forEach((s) => {
    if (/(^|\W)(1|una)\s*notte|weekend/.test(s)) los["1 notte"]++;
    else if (/(^|\W)(2|3).*(nott[ei])/.test(s)) los["2-3 notti"]++;
    else if (/(^|\W)(4|5|6).*(nott[ei])/.test(s)) los["4-6 notti"]++;
    else if (/(^|\W)(7|settimana|14|due settimane)/.test(s)) los["7+ notti"]++;
  });

  const toArr = (o: Record<string, number>) => Object.entries(o).map(([label, value]) => ({ label, value }));
  return { channels: toArr(channels), provenance: toArr(prov), los: toArr(los) };
}

/** Estrazione robusta delle related queries dal payload SerpAPI */
function extractRelatedQueries(j2: any): string[] {
  const rq = j2?.related_queries;
  if (!rq) return [];

  // Caso legacy: array di gruppi
  if (Array.isArray(rq)) {
    return rq
      .flatMap((g: any) => (g?.queries || g?.top || g?.rising || []))
      .map((x: any) => String(x?.query || ""))
      .filter(Boolean);
  }

  // Caso canonico / oggetto: { top:[], rising:[], ... }
  if (typeof rq === "object") {
    const buckets: any[] = [];
    if (Array.isArray((rq as any).top)) buckets.push(...(rq as any).top);
    if (Array.isArray((rq as any).rising)) buckets.push(...(rq as any).rising);
    // Fallback: includi eventuali altre chiavi array
    Object.values(rq).forEach((v: any) => {
      if (Array.isArray(v)) buckets.push(...v);
    });
    return buckets.map((x: any) => String(x?.query || "")).filter(Boolean);
  }

  return [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });
    }

    const topic = (url.searchParams.get("q") || "").trim();
    if (!topic) return NextResponse.json({ ok: false, error: "Manca 'q'." }, { status: 400 });

    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const parts = (url.searchParams.get("parts") || "trend")
      .split(",")
      .map((s) => s.trim().toLowerCase());

    // flag per calcolare solo i bucket richiesti (retro-compatibili: se mancano → tutti)
    const wantCh = url.searchParams.get("ch") === "1";
    const wantProv = url.searchParams.get("prov") === "1";
    const wantLos = url.searchParams.get("los") === "1";
    const noFlags =
      url.searchParams.get("ch") === null &&
      url.searchParams.get("prov") === null &&
      url.searchParams.get("los") === null;

    const cat = url.searchParams.get("cat") || "203"; // 203 = Travel
    const date = url.searchParams.get("date") || "today 12-m";

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
      const j = await r.json().catch(() => ({}));
      trendSeries = parseTimeseries(j);
      usage = j?.search_metadata; // indicativo
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
      const j2 = await r2.json().catch(() => ({}));

      const relatedQueries = extractRelatedQueries(j2);
      if (relatedQueries.length > 0) {
        const all = bucketsFromRelated(pickTopN(relatedQueries, 120));
        related = {
          channels:   (noFlags || wantCh)   ? all.channels   : [],
          provenance: (noFlags || wantProv) ? all.provenance : [],
          los:        (noFlags || wantLos)  ? all.los        : [],
        };
      } else {
        note = "Dati Trends senza related queries (campioni ridotti).";
        related = { channels: [], provenance: [], los: [] };
      }
    }

    if (parts.includes("trend") && trendSeries.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nessuna serie disponibile per il topic/periodo selezionato.", hint: "Prova con 'hotel <città>' e periodo 'today 12-m'." },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, topic, geo, dateRange: date, cat, series: trendSeries, related, usage, note },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
