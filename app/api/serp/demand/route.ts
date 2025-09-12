// app/api/serp/demand/route.ts
import { NextResponse } from "next/server";

/**
 * INPUT (GET):
 *  - q: string               // tema/chiave (es: "hotel firenze")
 *  - lat, lng: number        // per dedurre la regione IT (geo)
 *  - date: string (opz.)     // es. "today 3-m", "now 7-d" — default "today 3-m"
 *
 * OUTPUT:
 *  {
 *    ok: boolean,
 *    topic: string,
 *    geo: string,            // "IT" o "IT-52" ecc
 *    dateRange: string,
 *    series: { date: string, score: number }[],
 *    related?: {
 *      channels: { label: string, value: number }[],
 *      provenance: { label: string, value: number }[],
 *      los: { label: string, value: number }[],
 *    },
 *    usage?: any,            // echo SerpAPI usage quando disponibile
 *    note?: string
 *  }
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
  } catch {
    // ignore
  }
  return "IT";
}

function parseTimeseries(json: any): { date: string; score: number }[] {
  // SerpAPI trends: interest_over_time.timeline_data[].time / formattedTime / values[0].value
  const tl: any[] =
    json?.interest_over_time?.timeline_data ||
    json?.timeseries ||
    [];
  const out: { date: string; score: number }[] = [];
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
      // YYYY-MM-DD
      const d = new Date(when);
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: iso, score: Math.max(0, Math.min(100, Math.round(v))) });
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

// mapping molto semplice da related queries → bucket fittizi utili a grafici
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

  // provenienza (greedy, euristica)
  const prov: Record<string, number> = { italia: 0, germania: 0, francia: 0, usa: 0, uk: 0, altro: 0 };
  q.forEach((s) => {
    if (/(italia|rome|milan|florence|napoli)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });

  // LOS (parole chiave tipiche)
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = (url.searchParams.get("q") || "").trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const dateRange = (url.searchParams.get("date") || "today 3-m").trim(); // default

  if (!topic) {
    return NextResponse.json(
      { ok: false, error: "Missing 'q' (query topic)." },
      { status: 400 }
    );
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing SERPAPI_KEY env." },
      { status: 500 }
    );
  }

  const geo = await guessGeoFromLatLng(lat, lng);

  // --- 1) TIMESERIES ---
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: topic,
    geo,
    date: dateRange,
    api_key: apiKey,
  });
  const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, {
    cache: "no-store",
  });
  const j = await r.json();

  const series = parseTimeseries(j);
  let relatedQueries: string[] =
    j?.related_queries?.flatMap((g: any) =>
      (g?.queries || []).map((x: any) => String(x?.query || ""))
    ) || [];

  // --- 2) fallback RELATED_QUERIES se vuote ---
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
      const r2 = await fetch(
        `https://serpapi.com/search.json?${rq.toString()}`,
        { cache: "no-store" }
      );
      const j2 = await r2.json();
      relatedQueries =
        j2?.related_queries?.flatMap((g: any) =>
          (g?.queries || []).map((x: any) => String(x?.query || ""))
        ) || [];
    } catch {
      // ignore
    }
  }

  // Bucketizzazione euristica (se qualcosa c'è)
  const related =
    relatedQueries.length > 0
      ? bucketsFromRelated(pickTopN(relatedQueries, 100))
      : undefined;

  const payload: any = {
    ok: true,
    topic,
    geo,
    dateRange,
    series,
    related,
    usage: j?.search_metadata || j?.search_parameters || undefined,
  };

  if (series.length === 0) {
    payload.ok = false;
    payload.error = "Nessuna serie disponibile per il topic/periodo selezionato.";
  } else if (!related) {
    payload.note = "Dati Trends senza related queries (campioni ridotti).";
  }

  return NextResponse.json(payload, { status: 200 });
}
