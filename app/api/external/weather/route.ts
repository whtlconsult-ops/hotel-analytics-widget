// app/api/external/weather/route.ts
import { NextResponse } from "next/server";

// Utility per formattare yyyy-mm-dd
function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = searchParams.get("monthISO") || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "Missing or invalid lat/lng" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(monthISO || "")) {
      return NextResponse.json({ ok: false, error: "Missing or invalid monthISO (YYYY-MM-01)" }, { status: 400 });
    }

    // Finestra del mese richiesto
    const mDate = new Date(monthISO);
    const mStart = startOfMonth(mDate);
    const mEnd = endOfMonth(mDate);

    // Finestra forecast affidabile con Open-Meteo
    const today = new Date();
    const forecastStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // oggi
    const forecastEnd = new Date(today);
    forecastEnd.setDate(forecastEnd.getDate() + 16); // Open-Meteo tipicamente 16 giorni

    // Intersezione tra mese richiesto e finestra forecast:
    const start = new Date(Math.max(mStart.getTime(), forecastStart.getTime()));
    const end = new Date(Math.min(mEnd.getTime(), forecastEnd.getTime()));

    // Se non c'è intersezione, torniamo struttura vuota (UI mostrerà solo ciò che ha)
    if (start > end) {
      return NextResponse.json({
        ok: true,
        weather: {
          daily: { time: [], temperature_2m_mean: [], precipitation_sum: [], weather_code: [] },
        },
        note: "Requested month is outside forecast window",
      });
    }

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      timezone: "Europe/Rome",
      start_date: toISO(start),
      end_date: toISO(end),
      daily: ["temperature_2m_mean", "precipitation_sum", "weather_code"].join(","),
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    const res = await fetch(url, { next: { revalidate: 60 * 30 } }); // cache 30 minuti
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Open-Meteo HTTP ${res.status}` }, { status: 502 });
    }
    const data = await res.json();

    // Normalizziamo la forma attesa dalla UI:
    const daily = data?.daily || {};
    const out = {
      time: Array.isArray(daily.time) ? daily.time : [],
      temperature_2m_mean: Array.isArray(daily.temperature_2m_mean) ? daily.temperature_2m_mean : [],
      precipitation_sum: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum : [],
      weather_code: Array.isArray(daily.weather_code) ? daily.weather_code : [], // 👈 importante per le icone
    };

    return NextResponse.json({ ok: true, weather: { daily: out } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
