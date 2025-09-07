// app/api/external/weather/route.ts
import { NextRequest, NextResponse } from "next/server";

function parseMonthISO(monthISO: string) {
  // monthISO atteso tipo "2025-09-01"
  const d = new Date(monthISO);
  if (Number.isNaN(d.getTime())) throw new Error("Bad monthISO");
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export const revalidate = 3600; // cache 1h su Vercel

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = searchParams.get("monthISO") || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "Missing lat/lng" }, { status: 400 });
    }
    if (!monthISO) {
      return NextResponse.json({ ok: false, error: "Missing monthISO" }, { status: 400 });
    }

    const { start, end } = parseMonthISO(monthISO);

    // Open-Meteo: daily con temperature medie, precipitazioni e weather_code
    // NB: forecast supporta intervalli passati e futuri, ma i dati futuri sono
    // limitati (~16 giorni). Otterrai comunque solo i giorni disponibili.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_mean,precipitation_sum,weather_code&start_date=${start}&end_date=${end}&timezone=Europe%2FRome`;

    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();

    // Ci aspettiamo una struttura con data.daily.time[], temperature_2m_mean[], precipitation_sum[], weather_code[]
    if (!data?.daily?.time) {
      return NextResponse.json({ ok: false, error: "No daily data" }, { status: 200 });
    }

    return NextResponse.json({ ok: true, weather: { daily: data.daily } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
// app/api/external/holidays/route.ts
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 86400; // 24h

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const country = (searchParams.get("country") || "IT").toUpperCase();

    if (!Number.isFinite(year)) {
      return NextResponse.json({ ok: false, error: "Missing year" }, { status: 400 });
    }

    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Upstream ${res.status}` }, { status: 502 });
    }
    const arr = await res.json();

    // riduciamo ai campi usati dal widget
    const holidays = (Array.isArray(arr) ? arr : []).map((h: any) => ({
      date: h.date,             // "YYYY-MM-DD"
      localName: h.localName,   // es. "Ferragosto"
      name: h.name,
    }));

    return NextResponse.json({ ok: true, holidays });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

