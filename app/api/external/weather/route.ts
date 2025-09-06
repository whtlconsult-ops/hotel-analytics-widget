// app/api/external/weather/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = searchParams.get("monthISO") || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !monthISO) {
      return NextResponse.json({ ok: false, error: "Missing lat/lng/monthISO" }, { status: 400 });
    }

    // calcola inizio/fine mese
    const d = new Date(monthISO);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    // open-meteo con weathercode incluso
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&start_date=${startStr}&end_date=${endStr}` +
      `&timezone=auto&daily=temperature_2m_mean,precipitation_sum,weathercode`;

    const r = await fetch(url, { next: { revalidate: 60 * 60 } }); // cache 1h
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `OpenMeteo HTTP ${r.status}` }, { status: 502 });
    }
    const weather = await r.json();
    return NextResponse.json({ ok: true, weather });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
