// app/api/serp/demand/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/** Converte un item Trends in ISO yyyy-mm-dd.
 *  Supporta:
 *   - row.time (unix sec)   → giornaliero
 *   - row.timestamp (string | unix sec) → orario
 *   - row.formattedTime (string)        → fallback
 */
function toISODate(row: any): string | null {
  try {
    if (row?.time != null) {
      // unix seconds (giorni)
      const d = new Date(Number(row.time) * 1000);
      return d.toISOString().slice(0, 10);
    }
    if (row?.timestamp != null) {
      // può essere stringa di secondi o già ISO; normalizziamo sempre a Date
      const ts = Number(row.timestamp);
      const d = Number.isFinite(ts) ? new Date(ts * 1000) : new Date(row.timestamp);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    if (row?.formattedTime) {
      const d = new Date(row.formattedTime);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  } catch {/* ignore */}
  return null;
}

/** Estrae i punti 0..100 e (se orari) li aggrega per giorno con media */
function parseTimeseriesDaily(json: any): { date: string; score: number }[] {
  const tl: any[] = json?.interest_over_time?.timeline_data || [];
  if (!Array.isArray(tl) || tl.length === 0) return [];

  // bucket giornaliero
  const byDay = new Map<string, { s: number; n: number }>();

  for (const row of tl) {
    const iso = toISODate(row);
    const raw =
      Array.isArray(row?.values) && row.values[0]?.value != null
        ? Number(row.values[0].value)
        : Number(row?.value ?? row?.score ?? 0);

    if (!iso || !Number.isFinite(raw)) continue;

    const v = Math.max(0, Math.min(100, Math.round(raw)));

    const bucket = byDay.get(iso) || { s: 0, n: 0 };
    bucket.s += v;
    bucket.n += 1;
    byDay.set(iso, bucket);
  }

  // media per giorno + ordinamento crescente
  const out = Array.from(byDay.entries())
    .map(([date, { s, n }]) => ({ date, score: Math.round(s / Math.max(1, n)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return out;
}

type TryParams = { topic: string; geo: string; date: string; cat?: string };

async function tryFetchSeries(key: string, tp: TryParams, debug = false) {
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: tp.topic,
    geo: tp.geo,
    date: tp.date,
    api_key: key,
  });
  if (tp.cat) p.set("cat", tp.cat); // 203 = Hotels & Accommodations

  const url = `https://serpapi.com/search.json?${p.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  let json: any;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }

  const series = parseTimeseriesDaily(json);
  return {
    ok: res.ok,
    series,
    rawMeta: (json?.search_metadata || json?.search_parameters || null),
    lastUrl: url,
    httpStatus: res.status,
    body: debug ? json : undefined,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const debug = url.searchParams.get("debug") === "1";

  if (!qRaw) {
    return NextResponse.json({ ok: false, error: "Parametro 'q' mancante." }, { status: 400 });
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante." }, { status: 500 });
  }

  // Varianti di topic (b&b incluso ma con fallback "hotel")
  const topics = [
    /hotel|albergh/i.test(qRaw) ? qRaw : `${qRaw} hotel`,
    `hotel ${qRaw}`,
    `${qRaw} alberghi`,
    `${qRaw} b&b`,
  ];

  // Periodi: prima 12 mesi (robusta), poi 3 mesi, poi 7 giorni (orario → noi aggreghiamo)
  const dates = ["today 12-m", "today 3-m", "now 7-d"];

  // Geo: partiamo da nazionale IT (stabile)
  const geos = ["IT"];

  // Categoria 203 (Hotels & Accommodations) aiuta la qualità
  const cats = ["203", undefined];

  const attempts: TryParams[] = [];
  for (const topic of topics) {
    for (const geo of geos) {
      for (const date of dates) {
        for (const cat of cats) {
          attempts.push({ topic, geo, date, cat });
        }
      }
    }
  }

  let lastDebug: any = null;

  for (const tp of attempts) {
    try {
      const r = await tryFetchSeries(key, tp, debug);
      lastDebug = r;
      if (r.ok && r.series.length > 0) {
  // Serie per il grafico (etichette "08 set", etc.)
  const trend = r.series.map(s => ({
    dateLabel: s.date.slice(8, 10) + " " + new Date(s.date).toLocaleString("it-IT", { month: "short" }),
    value: s.score,
  }));

  // Serie ISO per il calendario (la userà il frontend)
  const seriesISO = r.series; // [{ date: "YYYY-MM-DD", score: 0..100 }]

  return NextResponse.json({
    ok: true,
    topic: tp.topic,
    geo: tp.geo,
    dateRange: tp.date,
    cat: tp.cat || null,
    trend,
    seriesISO,
    usage: r.rawMeta,
    debug: debug ? { lastUrl: r.lastUrl, httpStatus: r.httpStatus, body: r.body } : undefined,
  });
}
    } catch (e: any) {
      lastDebug = { error: String(e?.message || e), params: tp };
      continue;
    }
  }

  // Nessun risultato utile → ok:false (200) per far scattare i fallback UI, niente 500
  return NextResponse.json({
    ok: false,
    error: "Nessuna serie disponibile per il topic/periodo selezionato (dopo vari tentativi).",
    hint: "Prova a variare la query (es. 'hotel firenze') o un periodo più lungo (today 12-m).",
    debug: debug ? lastDebug : undefined,
  }, { status: 200 });
}
