
// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const debug = url.searchParams.get("debug") === "1";
  if (!qRaw) return NextResponse.json({ ok: false, error: "q mancante" }, { status: 400 });

  const key = process.env.SERPAPI_KEY;
  if (!key) return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });

  const topic = /hotel/i.test(qRaw) ? qRaw : `${qRaw} hotel`;
  const geo = "IT";               // ← niente Nominatim qui
  const dateRange = "today 3-m";  // default

  try {
    const p = new URLSearchParams({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: topic,
      geo,
      date: dateRange,
      api_key: key,
    });
    const r = await fetch(`https://serpapi.com/search.json?${p.toString()}`, { cache: "no-store" });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }

    if (!r.ok) {
      return NextResponse.json({ ok: false, status: r.status, body: json, debug: { topic, geo, dateRange } }, { status: 502 });
    }

    const series = parseTimeseries(json);
    if (series.length === 0) {
      return NextResponse.json({ ok: false, error: "Serie vuota", debug: json?.search_metadata || json?.search_parameters || null }, { status: 200 });
    }

    const trend = series.map(s => ({
      dateLabel: s.date.slice(8,10) + " " + new Date(s.date).toLocaleString("it-IT", { month: "short" }),
      value: s.score
    }));

    return NextResponse.json({
      ok: true,
      topic, geo, dateRange,
      trend,
      usage: json?.search_metadata || json?.search_parameters || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "STEP3", error: String(e?.message || e), debug: { topic, geo, dateRange } }, { status: 500 });
  }
}

