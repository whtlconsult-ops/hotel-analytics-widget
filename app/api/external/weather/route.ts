// app/api/external/weather/route.ts
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 60 * 60; // cache 1h

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function clampForecastWindow(monthISO: string) {
  const month = new Date(monthISO); // yyyy-mm-01
  if (Number.isNaN(month.getTime())) return null;

  const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const endOfMonth   = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const today = new Date();
  // ATTENZIONE: molti endpoint accettano solo +15 giorni (inclusivo)
  const plus15 = new Date(today);
  plus15.setDate(today.getDate() + 15);

  // Finestra effettiva richiedibile: [max(today, startOfMonth) , min(endOfMonth, plus15)]
  const start = today > startOfMonth ? today : startOfMonth;
  const end   = plus15 < endOfMonth ? plus15 : endOfMonth;

  if (end < start) return { start: null, end: null };

  // normalizza a mezzanotte per evitare off-by-one UTC
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  return { start, end };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = String(searchParams.get("monthISO") || "");

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !monthISO) {
      return NextResponse.json({ ok: false, error: "Missing lat/lng/monthISO" }, { status: 400 });
    }

    const window = clampForecastWindow(monthISO);
    if (!window) {
      return NextResponse.json({ ok: false, error: "Bad monthISO" }, { status: 400 });
    }

    // Mese fuori dalla finestra forecast: rispondi ok ma senza dati (UI gestisce graceful)
    if (!window.start || !window.end) {
      return NextResponse.json({
        ok: true,
        weather: { daily: { time: [], temperature_2m_mean: [], precipitation_sum: [], weathercode: [] } }
      });
    }

    const start_date = toISO(window.start);
    const end_date   = toISO(window.end);

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("daily", "temperature_2m_mean,precipitation_sum,weathercode");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", start_date);
    url.searchParams.set("end_date", end_date);

    const r = await fetch(url.toString(), { next: { revalidate } });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Upstream ${r.status}: ${txt || "forecast error"}` },
        { status: 502 }
      );
    }
    const json = await r.json();

    return NextResponse.json({ ok: true, weather: { daily: json?.daily ?? {} } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
