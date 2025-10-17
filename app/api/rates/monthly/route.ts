// /app/api/rates/monthly/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getAmadeusToken } from "../../../../lib/amadeus";

// utils
const parseNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

// una notte sola: calcolo per-night anche da total
async function fetchOffersDay(params: {
  token: string;
  checkIn: string; // YYYY-MM-DD
  nights: number;  // 1
  adults?: number;
  roomQty?: number;
  currency?: string;
  hotelId?: string; // se presente -> hotelIds=...
  lat?: number; lng?: number; radiusKm?: number;
}) {
  const {
    token, checkIn, nights,
    adults = 2, roomQty = 1, currency = "EUR",
    hotelId, lat, lng, radiusKm = 10,
  } = params;

  const u = new URL("https://test.api.amadeus.com/v3/shopping/hotel-offers");
  u.searchParams.set("adults", String(adults));
  u.searchParams.set("roomQuantity", String(roomQty));
  u.searchParams.set("checkInDate", checkIn);
  u.searchParams.set("paymentPolicy", "NONE");
  u.searchParams.set("includeClosed", "false");
  u.searchParams.set("bestRateOnly", "true");
  u.searchParams.set("currency", currency);

  if (hotelId) {
    u.searchParams.set("hotelIds", hotelId);
  } else if (lat != null && lng != null) {
    u.searchParams.set("latitude", String(lat));
    u.searchParams.set("longitude", String(lng));
    u.searchParams.set("radius", String(radiusKm));
    u.searchParams.set("radiusUnit", "KM");
  } else {
    // niente criteri
    return [] as number[];
  }

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!r.ok) return [] as number[];
  const j = await r.json();
  const data = Array.isArray(j?.data) ? j.data : [];
  const out: number[] = [];

  for (const item of data) {
    const offers = Array.isArray(item?.offers) ? item.offers : [];
    for (const ofr of offers) {
      // prendo il prezzo migliore disponibile
      const p = ofr?.price;
      const tot =
        parseNum(p?.total) ??
        parseNum(p?.base) ??
        parseNum(p?.variations?.average?.base) ??
        parseNum(p?.variations?.average?.total) ??
        parseNum(p?.variations?.changes?.[0]?.base) ??
        parseNum(p?.variations?.changes?.[0]?.total);
      if (tot != null) out.push(Math.round(tot / Math.max(1, nights)));
    }
  }
  return out;
}

function ymd(y: number, m: number, d: number) {
  // m: 1..12
  const dt = new Date(Date.UTC(y, m - 1, d));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || new Date().getFullYear());
    const hotelId = searchParams.get("hotelId") || undefined;

    const lat = parseNum(searchParams.get("lat"));
    const lng = parseNum(searchParams.get("lng"));
    const radius = parseNum(searchParams.get("radius")) ?? 10;

    if (!hotelId && (lat == null || lng == null)) {
      return NextResponse.json(
        { ok: false, error: "Richiede hotelId oppure lat/lng" },
        { status: 400 }
      );
    }

    const token = await getAmadeusToken();

    // Due campioni/mese: intorno al 12 e 26 (sandbox risponde meglio su date vicine)
    const pickDays = (y: number, m: number) => {
      return [12, 26].map(d => ymd(y, m, d));
    };

    const monthly: number[] = [];

    for (let m = 1; m <= 12; m++) {
      const days = pickDays(year, m);
      const prices: number[] = [];

      for (const checkIn of days) {
        const got = await fetchOffersDay({
          token,
          checkIn,
          nights: 1,
          hotelId,
          lat: hotelId ? undefined : lat,
          lng: hotelId ? undefined : lng,
          radiusKm: radius,
        });
        prices.push(...got);
      }
      monthly.push(median(prices));
    }

    return NextResponse.json({ ok: true, monthly }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
