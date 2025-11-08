export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const provider = (url.searchParams.get("provider") || "open-meteo").toLowerCase();
    // giorni da restituire: oggi + (days-1). Default 8 => oggi + 7
    const days = clamp(Number(url.searchParams.get("days") || 8), 1, 16);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "lat/lng mancanti" }, { status: 400 });
    }

    // Solo provider supportati esplicitamente
    if (!["open-meteo", "openweather", "ilmeteo"].includes(provider)) {
      return NextResponse.json({ ok: false, error: "provider non supportato" }, { status: 400 });
    }

    // --- Open-Meteo: forecast + current_weather “oggi” ---
    if (provider === "open-meteo") {
      // NB: Open-Meteo non richiede API key
      const u = new URL("https://api.open-meteo.com/v1/forecast");
      u.searchParams.set("latitude", String(lat));
      u.searchParams.set("longitude", String(lng));
      u.searchParams.set("timezone", "auto");
      u.searchParams.set("current_weather", "true");
      // per daily usiamo mean/max/min + precipitazioni e weathercode
      u.searchParams.set(
        "daily",
        "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode"
      );
      // per oggi più accurato potresti anche usare hourly, ma qui bastano i daily + current override
      // opzionale: limitiamo l’intervallo
      const now = new Date();
      const startISO = now.toISOString().slice(0, 10);
      const end = new Date(now);
      end.setDate(end.getDate() + (days - 1));
      const endISO = end.toISOString().slice(0, 10);
      u.searchParams.set("start_date", startISO);
      u.searchParams.set("end_date", endISO);

      const r = await fetch(u.toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));

      const daily = j?.daily;
      if (!daily?.time || !Array.isArray(daily.time)) {
        return NextResponse.json({ ok: true, weather: { daily: {} }, meta: { mode: "open-meteo" } });
      }

      // Override temperatura “oggi” con current_weather.temperature (più veritiera del mean)
      const todayISO = startISO;
      const idxToday = daily.time.indexOf(todayISO);
      if (idxToday >= 0 && j?.current_weather?.temperature != null) {
        const t = Number(j.current_weather.temperature);
        if (!Number.isNaN(t)) {
          // clona l’array prima di mutarlo
          const temps = Array.isArray(daily.temperature_2m_mean)
            ? [...daily.temperature_2m_mean]
            : new Array(daily.time.length).fill(null);
          temps[idxToday] = t;
          daily.temperature_2m_mean = temps;
        }
      }

      return NextResponse.json({
        ok: true,
        weather: { daily },
        meta: {
          mode: "open-meteo",
          ts: new Date().toISOString(),
          source: "open-meteo.com",
        },
      });
    }

    // --- OpenWeather (placeholder) ---
    // Integra qui se/quando aggiungi l’API key:
    //  - chiama One Call 3.0 (current + daily)
    //  - mappa current.temp su “oggi” e daily.temp per i successivi
    if (provider === "openweather") {
      return NextResponse.json({
        ok: true,
        weather: { daily: {} },
        meta: { mode: "openweather-placeholder", note: "Integrare API key per dati live." },
      });
    }

    // --- IlMeteo (placeholder) ---
    // IlMeteo espone API commerciali (apigateway.ilmeteo.it / XML). Quando avrai le credenziali:
    //  - effettua la richiesta qui
    //  - mappa i campi su daily.{temperature_2m_mean,max,min,precipitation_sum,weathercode}
    if (provider === "ilmeteo") {
      return NextResponse.json({
        ok: false,
        error: "IlMeteo non configurato. Aggiungere credenziali e mapping nel route.",
      }, { status: 501 });
    }

    // fallback di sicurezza
    return NextResponse.json({ ok: false, error: "provider non gestito" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
