// app/api/serp/demand/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// --- Helpers ---
function parseTimeseries(json: any): { date: string; score: number }[] {
  const tl: any[] = json?.interest_over_time?.timeline_data || [];
  const out: { date: string; score: number }[] = [];
  for (const row of tl) {
    const when = row?.time ? new Date(Number(row.time) * 1000) : null;
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

  const series = parseTimeseries(json);
  return {
    ok: res.ok,
    series,
    rawMeta: (json?.search_metadata || json?.search_parameters || null),
    lastUrl: url,
    httpStatus: res.status,
    body: debug ? json : undefined,
  };
}

// --- Handler ---
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

  // Topic (varie formulazioni)
  const topics = [
    /hotel/i.test(qRaw) ? qRaw : `${qRaw} hotel`,
    `hotel ${qRaw}`,
    `${qRaw} alberghi`,
    `alberghi ${qRaw}`,
    `${qRaw} b&b`,
  ];

  // Periodi alternativi
  const dates = ["today 3-m", "today 12-m", "now 7-d"];

  // Geo: partiamo da IT (stabile); poi estenderemo a IT-xx
  const geos = ["IT"];

  // Categoria: 203 = Travel > Hotels & Accommodations (aiuta Trends a “capire” il contesto)
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
        const trend = r.series.map(s => ({
          dateLabel: s.date.slice(8, 10) + " " + new Date(s.date).toLocaleString("it-IT", { month: "short" }),
          value: s.score,
        }));
        return NextResponse.json({
          ok: true,
          topic: tp.topic,
          geo: tp.geo,
          dateRange: tp.date,
          cat: tp.cat || null,
          trend,
          usage: r.rawMeta,
          debug: debug ? { lastUrl: r.lastUrl, httpStatus: r.httpStatus, body: r.body } : undefined,
          note: tp.cat ? undefined : "Serie trovata senza categoria. Se intermittente, prova con cat=203.",
        });
      }
    } catch (e: any) {
      lastDebug = { error: String(e?.message || e), params: tp };
      continue;
    }
  }

  // Nessun risultato utile, ma NIENTE 500: ritorniamo ok:false (200) per permettere il fallback lato UI
  return NextResponse.json({
    ok: false,
    error: "Nessuna serie disponibile per il topic/periodo selezionato (dopo vari tentativi).",
    hint: "Prova a variare la query (es. 'hotel firenze') o un periodo più lungo (today 12-m).",
    debug: debug ? lastDebug : undefined,
  }, { status: 200 });
}
