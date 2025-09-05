// app/api/external/weather/route.ts
import { NextResponse } from "next/server";

/** Cache 6h */
const REVALIDATE_SECONDS = 60 * 60 * 6;

/**
 * Query:
 *  lat, lng -> numeri
 *  monthISO -> "YYYY-MM-01"
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const monthISO = searchParams.get("monthISO") || "";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "lat/lng invalidi" }, { status: 400 });
    }

    // Open-Meteo daily averages for the calendar span
    // Qui prendiamo tutto il mese circa (dal 1 al 28/30/31)
    const y = Number(monthISO.slice(0, 4)) || new Date().getFullYear();
    const m = Number(monthISO.slice(5, 7)) || (new Date().getMonth() + 1);

    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    // fine mese "rough": chiediamo al client le date esatte per aggregare; qui basta il mese
    // Per semplificare, chiediamo l’intero mese e poi lato client map di giorno in giorno.
    const end = `${y}-${String(m).padStart(2, "0")}-28`; // sufficiente, Open-Meteo restituisce anche oltre; lato client allineiamo

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}&daily=temperature_2m_mean,precipitation_sum&timezone=auto`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}` }, { status: 500 });
    }

    const json = await res.json();
    // json.daily = { time:[dates], temperature_2m_mean:[...], precipitation_sum:[...] }
    return NextResponse.json({ ok: true, weather: json });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
