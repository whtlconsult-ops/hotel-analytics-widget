// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

// ---- Helpers ----
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

type TryParams = {
  topic: string;
  geo: string;
  date: string;
  cat?: string;
};

async function tryFetchSeries(key: string, tp: TryParams, debug = false) {
  const p = new URLSearchParams({
    engine: "google_trends",
    data_type: "TIMESERIES",
    q: tp.topic,
    geo: tp.geo,
    date: tp.date,
    api_key: key,
  });
  if (tp.cat) p.set("cat", tp.cat); // categoria: Hotels & Accommodations

  const res = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }

  const series = parseTimeseries(json);
  return {
    ok: res.ok,
    series,
    rawMeta: (json?.search_metadata || json?.search_parameters || null),
    lastUrl: `https://serpapi.com/search.json?${p.toString()}`,
    httpStatus: res.status,
    body: debug ? json : undefined,
  };
}

// ---- Handler ----
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const debug = url.searchParams.get("debug") === "1";

  if (!qRaw) {
    return NextResponse.json({ ok: false, error: "Parametro 'q' mancante." }, { status: 400 });
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante." }, { status: 500 });
  }

  // Costruiamo una lista di combinazioni da provare.
  // - topic variants (IT)
  const topics = [
    /hotel/i.test(qRaw) ? qRaw : `${qRaw} hotel`,
    `hotel ${qRaw}`,
    `${qRaw} alberghi`,
    `alberghi ${qRaw}`,
    `${qRaw} b&b`,
  ];

  // - periodi alternativi
  const dates = [
    "today 3-m",
    "today 12-m",
    "now 7-d",
  ];

  // - geo: partiamo da IT (stabile). In un secondo momento potremo aggiungere geo regionali (IT-52 per Toscana, ecc.)
  const geos = ["IT"];

  // - categoria: Hotels & Accommodations (Google Trends cats)
  //   203 = Travel > Hotels & Accommodations (categoria comunemente usata)
  const cats = [ "203", undefined ];

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

  let chosen: TryParams | null = null;
  let lastDebug: any = null;

  for (const tp of attempts) {
    try {
      const r = await tryFetchSeries(key, tp, debug);
      lastDebug = r; // salvo l’ultimo tentativo (per debug)

      if (r.ok && r.series.length > 0) {
        chosen = tp;
        const trend = r.series.map(s => ({
          dateLabel: s.date.slice(8,10) + " " + new Date(s.date).toLocaleString("it-IT", { month: "short" }),
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
          note: (tp.cat ? undefined : "Serie trovata senza categoria. Se intermittente, prova con cat=203."),
        });
      }
    } catch (e: any) {
      // se un tentativo fallisce, proseguiamo col prossimo
      lastDebug = { error: String(e?.message || e), params: tp };
      continue;
    }
  }

  // Se arriviamo qui, nessun tentativo ha prodotto serie.
  return NextResponse.json({
    ok: false,
    error: "Nessuna serie disponibile per il topic/periodo selezionato (dopo vari tentativi).",
    hint: "Prova a variare la query (es. 'hotel firenze') o un periodo più lungo (today 12-m).",
    debug: debug ? lastDebug : undefined,
  }, { status: 200 });
}


