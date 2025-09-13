// app/api/serp/demand/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

/** Mappa per costruire il topic in base alla tipologia selezionata */
const TYPE_KEYWORD: Record<string, string> = {
  hotel: "hotel",
  agriturismo: "agriturismo",
  "b&b": "b&b",
  casa_vacanza: "casa vacanza",
  villaggio_turistico: "villaggio turistico",
  resort: "resort",
  affittacamere: "affittacamere",
};

/** Parsers SerpAPI → nostra struttura */
function parseTimeseries(json: any): { date: string; score: number }[] {
  const tl: any[] = json?.interest_over_time?.timeline_data || [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const ts = row?.timestamp || row?.time;
    const v =
      Array.isArray(row?.values) && row.values[0]?.value != null
        ? Number(row.values[0].value)
        : Number(row?.value ?? row?.score ?? 0);
    if (ts != null && !Number.isNaN(v)) {
      const d = new Date(Number(ts) * 1000);
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

/** Bucket grezzi dai related queries → Canali / Provenienza / LOS */
function bucketsFromRelated(queries: string[]) {
  const q = queries.map((s) => s.toLowerCase());

  const channels: Record<string, number> = {
    booking: 0,
    airbnb: 0,
    diretto: 0,
    expedia: 0,
    altro: 0,
  };
  q.forEach((s) => {
    if (s.includes("booking")) channels.booking++;
    else if (s.includes("airbnb")) channels.airbnb++;
    else if (s.includes("expedia")) channels.expedia++;
    else if (s.includes("diretto") || s.includes("sito") || s.includes("telefono"))
      channels.diretto++;
    else channels.altro++;
  });

  const prov: Record<string, number> = {
    italia: 0,
    germania: 0,
    francia: 0,
    usa: 0,
    uk: 0,
    altro: 0,
  };
  q.forEach((s) => {
    if (/(italia|rome|milan|florence|napoli|venezia)/.test(s)) prov.italia++;
    else if (/(german|berlin|munich|deutsch)/.test(s)) prov.germania++;
    else if (/(france|paris|francese)/.test(s)) prov.francia++;
    else if (/(usa|new york|los angeles|miami)/.test(s)) prov.usa++;
    else if (/(uk|london|british|inghilterra)/.test(s)) prov.uk++;
    else prov.altro++;
  });

  const los: Record<string, number> = {
    "1 notte": 0,
    "2-3 notti": 0,
    "4-6 notti": 0,
    "7+ notti": 0,
  };
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
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "SERPAPI_KEY mancante su Vercel" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim(); // es. "Firenze"
  const monthISO = (url.searchParams.get("monthISO") || "").trim(); // "YYYY-MM-01" opz.
  const types = (url.searchParams.get("types") || "hotel")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Tipologia principale (prima selezionata)
  const mainType = types[0] || "hotel";
  const typeKeyword = TYPE_KEYWORD[mainType] || "hotel";

  // Topic per Trends (es. "Firenze hotel")
  const topic = `${q} ${typeKeyword}`.trim();

  // Per ottenere dati “utili” al calendario e al grafico mensile: 3 mesi
  const dateRange = "today 3-m";

  // --- 1) TIMESERIES ---
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: topic,
    geo: "IT",
    date: dateRange,
    api_key: key,
    // categoria "Travel" per ridurre rumore
    cat: "203",
  });

  const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, {
    cache: "no-store",
  });
  const body = await r.json();

  const seriesISO = parseTimeseries(body); // [{date, score}]

  // --- 2) RELATED QUERIES (per grafici torta/bar) ---
  let relatedQueries: string[] = [];
  try {
    const rq = new URLSearchParams({
      engine: "google_trends",
      data_type: "RELATED_QUERIES",
      q: topic,
      geo: "IT",
      date: dateRange,
      api_key: key,
      cat: "203",
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
    // ignora
  }

  const buckets =
    relatedQueries.length > 0
      ? bucketsFromRelated(pickTopN(relatedQueries, 100))
      : null;

  // Serie per il grafico linea: trasformiamo in etichette "d MMM"
  const trend = seriesISO.map((s) => {
    const d = new Date(s.date);
    const label = d
      .toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
      .replace(".", "");
    return { dateLabel: label, value: s.score };
  });

  return NextResponse.json(
    {
      ok: seriesISO.length > 0,
      topic,
      geo: "IT",
      dateRange,
      cat: "203",
      trend,
      seriesISO, // <- per il calendario/ADR
      // grafici
      channels: buckets
        ? [
            { channel: "Booking", value: buckets.channels.find((x) => x.label === "booking")?.value || 0 },
            { channel: "Airbnb", value: buckets.channels.find((x) => x.label === "airbnb")?.value || 0 },
            { channel: "Diretto", value: buckets.channels.find((x) => x.label === "diretto")?.value || 0 },
            { channel: "Expedia", value: buckets.channels.find((x) => x.label === "expedia")?.value || 0 },
            { channel: "Altro", value: buckets.channels.find((x) => x.label === "altro")?.value || 0 },
          ]
        : [],
      origins: buckets
        ? [
            { name: "Italia", value: buckets.provenance.find((x) => x.label === "italia")?.value || 0 },
            { name: "Germania", value: buckets.provenance.find((x) => x.label === "germania")?.value || 0 },
            { name: "Francia", value: buckets.provenance.find((x) => x.label === "francia")?.value || 0 },
            { name: "USA", value: buckets.provenance.find((x) => x.label === "usa")?.value || 0 },
            { name: "UK", value: buckets.provenance.find((x) => x.label === "uk")?.value || 0 },
          ]
        : [],
      losDist: buckets
        ? buckets.los.map(({ label, value }) => ({ bucket: label, value }))
        : [],
      note:
        relatedQueries.length === 0
          ? "Dati Trends senza related queries (campioni ridotti)."
          : undefined,
      usage: body?.search_metadata || null,
    },
    { status: 200 }
  );
}
