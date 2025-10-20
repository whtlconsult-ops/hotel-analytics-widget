// app/api/rates/monthly/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

/** ==============================
 *  CONFIG
 *  ============================== */
const AMA_TOKEN_URL = "https://test.api.amadeus.com/v1/security/oauth2/token";
const AMA_OFFERS_URL = "https://test.api.amadeus.com/v3/shopping/hotel-offers";

// Env vars: imposta su Vercel
const AMA_KEY = process.env.AMADEUS_KEY || process.env.AMADEUS_CLIENT_ID;
const AMA_SECRET = process.env.AMADEUS_SECRET || process.env.AMADEUS_CLIENT_SECRET;

// Cache token in memoria (processo)
let tokenCache: { access_token: string; expires_at: number } | null = null;

/** ==============================
 *  UTILS
 *  ============================== */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const arr = nums.slice().sort((a, b) => a - b);
  const i = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[i] : Math.round((arr[i - 1] + arr[i]) / 2);
}

async function getAmadeusToken(): Promise<string> {
  if (!AMA_KEY || !AMA_SECRET) {
    throw new Error("AMadeus credentials missing (AMADUES_KEY/SECRET).");
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now + 15_000) {
    return tokenCache.access_token;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", AMA_KEY);
  body.set("client_secret", AMA_SECRET);

  const r = await fetch(AMA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Amadeus token error: ${r.status} ${txt}`);
  }

  const j = await r.json();
  const ttl = Number(j.expires_in) || 1800; // 30 min
  tokenCache = {
    access_token: String(j.access_token),
    expires_at: Date.now() + (ttl * 1000),
  };

  return tokenCache.access_token;
}

/**
 * Chiede i prezzi per una data check-in.
 * - Se hotelId è presente → query diretta su 1 hotel
 * - Altrimenti ricerca area con lat/lng (raggio 25km)
 */
async function fetchDayPrice(
  token: string,
  {
    lat, lng, checkIn, nights,
    hotelId,
  }: {
    lat?: number; lng?: number; checkIn: string; nights: number; hotelId?: string;
  }
): Promise<{ prices: number[]; status: number; rawCount: number }> {

  const url = new URL(AMA_OFFERS_URL);

  if (hotelId) {
    url.searchParams.set("hotelIds", hotelId);
  } else {
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("radius", "25");       // raggio ampio per aumentare hit-rate
    url.searchParams.set("radiusUnit", "KM");
  }

  url.searchParams.set("adults", "2");
  url.searchParams.set("roomQuantity", "1");
  url.searchParams.set("checkInDate", checkIn);
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("paymentPolicy", "NONE");
  url.searchParams.set("includeClosed", "true");
  url.searchParams.set("bestRateOnly", "true");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!r.ok) {
    return { prices: [], status: r.status, rawCount: 0 };
  }

  const j = await r.json().catch(() => ({}));
  const data = Array.isArray(j?.data) ? j.data : [];
  const prices: number[] = [];

  for (const item of data) {
    const offers = Array.isArray(item?.offers) ? item.offers : [];
    for (const ofr of offers) {
      const p = ofr?.price;
      const tot =
        parseNum(p?.total) ??
        parseNum(p?.variations?.average?.total) ??
        parseNum(p?.variations?.changes?.[0]?.total);

      if (tot != null) {
        const perNight = Math.round(tot / Math.max(1, nights));
        prices.push(perNight);
      }
    }
  }

  return { prices, status: 200, rawCount: data.length };
}

/** ==============================
 *  ROUTE HANDLER
 *  ============================== */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const lat = parseNum(searchParams.get("lat"));
    const lng = parseNum(searchParams.get("lng"));
    const hotelId = searchParams.get("hotelId") || undefined;

    const year = Number(searchParams.get("year")) || new Date().getFullYear();
    const debug = searchParams.get("debug") === "1";

    if (!hotelId && !(Number.isFinite(lat as number) && Number.isFinite(lng as number))) {
      return NextResponse.json(
        { ok: false, error: "Provide either hotelId OR lat & lng." },
        { status: 400 }
      );
    }

    const token = await getAmadeusToken();

    const monthly: number[] = new Array(12).fill(0);
    const debugRows: any[] = [];

    for (let m = 1; m <= 12; m++) {
      // due date di campionamento per mese
      const d1 = `${year}-${pad2(m)}-10`;
      const d2 = `${year}-${pad2(m)}-20`;

      const a = await fetchDayPrice(token, { lat: lat ?? undefined, lng: lng ?? undefined, checkIn: d1, nights: 1, hotelId });
      const b = await fetchDayPrice(token, { lat: lat ?? undefined, lng: lng ?? undefined, checkIn: d2, nights: 1, hotelId });

      const merged = [...a.prices, ...b.prices];
      monthly[m - 1] = median(merged);

      if (debug) {
        debugRows.push({
          month: m,
          sampleDays: [d1, d2],
          httpStatus: [a.status, b.status],
          bucketsFound: [a.rawCount, b.rawCount],
          priceSamples: merged.length,
          value: monthly[m - 1],
        });
      }
    }

    return NextResponse.json(
      { ok: true, monthly, debug: debug ? debugRows : undefined },
      { status: 200 }
    );

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
