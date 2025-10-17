// app/api/rates/monthly/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

/**
 * Questo endpoint calcola un ADR mensile (12 valori) usando Amadeus.
 * 1) Ricava hotelIds vicini con /v1/reference-data/locations/hotels/by-geocode
 * 2) Chiede i prezzi con /v3/shopping/hotel-offers?hotelIds=...
 * 3) Per ogni mese campiona 4 giorni [6,12,18,24] e usa mediana "rifilata"
 *
 * Query:
 *  lat,lng (obbl.)  — coordinate
 *  year (opz.)      — default anno corrente
 *  radius (opz.)    — KM (default 8)
 *  q (opz.)         — filtra i risultati per nome hotel (case-insensitive)
 */

type Monthly = number[];

const AMADEUS_BASE = "https://test.api.amadeus.com";

// --- util ---
const parseNum = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const trimmedMedian = (arr: number[]): number => {
  const a = arr.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  if (a.length >= 4) { a.shift(); a.pop(); } // taglio outlier min/max
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

const pickDays = () => [6, 12, 18, 24];

// piccolo cache in-process del token (25m)
let cachedToken: { value: string; exp: number } | null = null;
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.exp > now + 15_000) return cachedToken.value;

  const id = process.env.AMADEUS_KEY || process.env.AMADEUS_ID || "";
  const secret = process.env.AMADEUS_SECRET || "";
  if (!id || !secret) throw new Error("Amadeus credentials missing");

  const r = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }).toString(),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Auth failed (${r.status})`);
  const j = await r.json();
  const tok = String(j?.access_token || "");
  const ttl = Number(j?.expires_in || 1800) * 1000;
  if (!tok) throw new Error("access_token missing");
  cachedToken = { value: tok, exp: Date.now() + Math.max(60_000, ttl) };
  return tok;
}

/** 1) Lista hotelIds da lat/lng */
async function listHotelIdsByGeocode(token: string, lat: number, lng: number, radiusKm: number): Promise<string[]> {
  const u = new URL(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-geocode`);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("radius", String(radiusKm));
  u.searchParams.set("radiusUnit", "KM");
  u.searchParams.set("page[limit]", "20"); // limiti sandbox

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return [];
  const j = await r.json();
  const data = Array.isArray(j?.data) ? j.data : [];
  const ids = data
    .map((h: any) => String(h?.hotelId || "").trim())
    .filter(Boolean);

  // deduplica
  return Array.from(new Set(ids));
}

/** 2) Prezzi per un set di hotelIds in una data */
async function pricesForDate(
  token: string,
  hotelIds: string[],
  checkInDate: string,
  nights = 1,
  onlyName?: string
): Promise<number[]> {
  if (!hotelIds.length) return [];

  // Amadeus accetta fino a ~20 hotelIds per richiesta; chunk se necessario
  const chunked: string[][] = [];
  for (let i = 0; i < hotelIds.length; i += 20) chunked.push(hotelIds.slice(i, i + 20));

  const allPrices: number[] = [];
  for (const ids of chunked) {
    const u = new URL(`${AMADEUS_BASE}/v3/shopping/hotel-offers`);
    u.searchParams.set("hotelIds", ids.join(","));
    u.searchParams.set("adults", "2");
    u.searchParams.set("checkInDate", checkInDate);
    u.searchParams.set("roomQuantity", "1");
    u.searchParams.set("paymentPolicy", "NONE");
    u.searchParams.set("includeClosed", "false");
    u.searchParams.set("bestRateOnly", "true");
    u.searchParams.set("currency", "EUR");

    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) continue;

    const j = await r.json();
    const rows = Array.isArray(j?.data) ? j.data : [];
    for (const row of rows) {
      const hname = String(row?.hotel?.name || "");
      if (onlyName && hname && !hname.toLowerCase().includes(onlyName.toLowerCase())) continue;

      const offers = Array.isArray(row?.offers) ? row.offers : [];
      for (const ofr of offers) {
        const p = ofr?.price;
        const tot =
          parseNum(p?.total) ??
          parseNum(p?.base) ??
          parseNum(p?.variations?.average?.total) ??
          parseNum(p?.variations?.average?.base) ??
          parseNum(p?.variations?.changes?.[0]?.total);
        if (tot != null) {
          const perNight = Math.round(tot / Math.max(1, nights));
          allPrices.push(perNight);
        }
      }
    }
  }
  return allPrices;
}

/** Format YYYY-MM-DD */
const ymd = (y: number, m1to12: number, d: number) =>
  `${y}-${String(m1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "Missing lat/lng" }, { status: 400 });
    }
    const year = Number(searchParams.get("year")) || new Date().getFullYear();
    const radius = Number(searchParams.get("radius")) || 8;
    const qName = (searchParams.get("q") || "").trim() || undefined;

    const token = await getToken();
    // 1) hotelIds vicini
    let ids = await listHotelIdsByGeocode(token, lat, lng, radius);
    // se non troviamo nulla, allarghiamo
    if (ids.length < 5) {
      const r2 = Math.min(25, Math.max(radius + 5, 12));
      const more = await listHotelIdsByGeocode(token, lat, lng, r2);
      ids = Array.from(new Set([...ids, ...more]));
    }
    // se ancora niente, usciamo con zeri
    if (!ids.length) {
      return NextResponse.json({ ok: true, monthly: new Array(12).fill(0) as Monthly });
    }

    const monthly: Monthly = new Array(12).fill(0);
    const days = pickDays();

    // sequenziale (il sandbox non ama la concorrenza)
    for (let m = 1; m <= 12; m++) {
      const bucket: number[] = [];
      for (const d of days) {
        const dt = ymd(year, m, d);
        const prices = await pricesForDate(token, ids, dt, 1, qName);
        if (prices.length) bucket.push(trimmedMedian(prices));
      }
      monthly[m - 1] = bucket.length ? trimmedMedian(bucket) : 0;
    }

    return NextResponse.json({ ok: true, monthly });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
