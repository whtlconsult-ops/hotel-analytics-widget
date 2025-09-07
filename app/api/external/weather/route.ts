// app/api/external/weather/route.ts
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 10800; // 3h cache lato server

function isoRangeForMonth(monthISO: string) {
  const d = new Date(monthISO);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const toISO = (x: Date) =>
    `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { start: toISO(from), end: toISO(to) };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = searchParams.get("monthISO") || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !monthISO) {
      return NextResponse.json(
        { ok: false, error: "Missing lat/lng/monthISO" },
        { status: 400 }
      );
    }

    const { start, end } = isoRangeForMonth(monthISO);

    // Open-Meteo: meteo giornaliero + codice condizioni
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_mean,precipitation_sum,weather_code` +
      `&timezone=auto&start_date=${start}&end_date=${end}`;

    const upstream = await fetch(url, { next: { revalidate } });

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `Upstream ${upstream.status}` },
        { status: 502 }
      );
    }

    const weather = await upstream.json();
    return NextResponse.json({ ok: true, weather });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
