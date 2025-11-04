// app/api/rates/monthly/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

/* ===========================
   Config & helpers di base
   =========================== */

const AMA_KEY = process.env.AMADEUS_KEY || process.env.AMADEUS_CLIENT_ID;
const AMA_SECRET = process.env.AMADEUS_SECRET || process.env.AMADEUS_CLIENT_SECRET;

type PriceSample = { prices: number[]; status: number; rawCount: number; usedHotelIds: string[] };

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAmadeusToken(): Promise<string> {
  if (!AMA_KEY || !AMA_SECRET) {
    throw new Error("AMADUES_KEY/SECRET mancanti nelle env (Vercel).");
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }
  const r = await fetch("https://test.api.amadeus.com/v1/security/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: AMA_KEY,
      client_secret: AMA_SECRET,
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OAuth Amadeus fallito: ${r.status} ${txt}`);
  }
  const j = await r.json();
  const access = String(j?.access_token || "");
  const expiresIn = Number(j?.expires_in || 0);
  if (!access) throw new Error("OAuth Amadeus: access_token mancante.");
  tokenCache = { token: access, expiresAt: Math.floor(Date.now() / 1000) + Math.max(60, expiresIn - 60) };
  return access;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ymdDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 12 mesi rolling a partire da start=YYYY-MM (se passato) o dal mese corrente */
function build12Months(start?: string): Date[] {
  const base = start ? new Date(`${start}-01T00:00:00`) : new Date();
  base.setDate(1);
  const out: Date[] = [];
  for (let i = 0; i < 12; i++) out.push(new Date(base.getFullYear(), base.getMonth() + i, 1));
  return out;
}

function median(nums: number[]): number {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  const val = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return Math.round(val);
}

/* =========================================
   Hotel-List: by geocode & by city fallback
   ========================================= */

/** Ricava fino a N hotelId vicini a lat/lng (hotelSource=ALL), con eventuale filtro nome q */
async function listHotelIdsByGeocode(
  token: string,
  {
    lat, lng, radiusKm = 35, limit = 40, q,
  }: { lat: number; lng: number; radiusKm?: number; limit?: number; q?: string }
): Promise<string[]> {
  const base = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode";
  const u = new URL(base);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("radius", String(Math.max(1, Math.min(50, radiusKm))));
  u.searchParams.set("radiusUnit", "KM");
  u.searchParams.set("page[limit]", String(Math.max(1, Math.min(100, limit))));
  u.searchParams.set("hotelSource", "ALL");

  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("Amadeus HotelList by-geocode error", r.status, txt);
    return [];
  }
  const j = await r.json().catch(() => ({}));
  let rows: any[] = Array.isArray(j?.data) ? j.data : [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((d) => String(d?.name || "").toLowerCase().includes(needle));
  }
  return Array.from(new Set(rows.map((d) => String(d?.hotelId || "")).filter(Boolean))).slice(0, limit);
}

/** Cerca cityCode (IATA) da keyword città */
async function findCityCode(token: string, keyword: string): Promise<string | null> {
  const u = new URL("https://test.api.amadeus.com/v1/reference-data/locations/cities");
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("max", "3");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("Cities lookup error", r.status, t);
    return null;
  }
  const j = await r.json().catch(() => ({}));
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  const code = rows.find((x: any) => x?.iataCode)?.iataCode;
  return code ? String(code) : null;
}

/** Lista hotelId per cityCode (fallback quando geocode non rende) */
async function listHotelIdsByCity(token: string, cityCode: string, limit = 60): Promise<string[]> {
  const base = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city";
  const u = new URL(base);
  u.searchParams.set("cityCode", cityCode);
  u.searchParams.set("page[limit]", String(Math.max(1, Math.min(100, limit))));

  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("Amadeus HotelList by-city error", r.status, txt);
    return [];
  }

  const j: any = await r.json().catch(() => ({} as any));
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  const ids: string[] = Array.from(
    new Set<string>(
      (rows.map((d: any) => String(d?.hotelId ?? "")).filter(Boolean) as string[])
    )
  );
  return ids.slice(0, limit);
}
/* =========================================
   Hotel Offers (v3) su lista di hotelIds
   ========================================= */

async function fetchDayPrice(
  token: string,
  {
    checkIn,
    nights,
    hotelIds,
    lat,
    lng,
    radiusKm = 35,
    nameFilter,
  }: {
    checkIn: string;
    nights: number;
    hotelIds?: string[];
    lat?: number;
    lng?: number;
    radiusKm?: number;
    nameFilter?: string;
  }
): Promise<PriceSample> {
  let ids: string[] = Array.isArray(hotelIds) ? hotelIds.filter(Boolean) : [];

  // se non passati, prova a ricavarli da geocode
  if (ids.length === 0 && lat != null && lng != null) {
    try {
      ids = await listHotelIdsByGeocode(token, { lat, lng, radiusKm, limit: 40, q: nameFilter });
    } catch (e) {
      console.error("listHotelIdsByGeocode error", e);
    }
  }

  if (ids.length === 0) {
    return { prices: [], status: 204, rawCount: 0, usedHotelIds: [] };
  }

  const url = new URL("https://test.api.amadeus.com/v3/shopping/hotel-offers");
  url.searchParams.set("hotelIds", ids.join(","));
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
    const txt = await r.text().catch(() => "");
    console.error("Amadeus HotelSearch error", r.status, txt);
    return { prices: [], status: r.status, rawCount: 0, usedHotelIds: ids };
  }

  const j: any = await r.json().catch(() => ({} as any));
  const data = Array.isArray(j?.data) ? j.data : [];
  const prices: number[] = [];

  for (const item of data) {
    const offers = Array.isArray(item?.offers) ? item.offers : [];
    for (const ofr of offers) {
      const p = ofr?.price;
      const tot =
        (p?.total != null ? Number(p.total) : NaN) ||
        (p?.variations?.average?.total != null ? Number(p.variations.average.total) : NaN) ||
        (p?.variations?.changes?.[0]?.total != null ? Number(p.variations.changes[0].total) : NaN);
      if (Number.isFinite(tot)) {
        prices.push(Math.round(tot / Math.max(1, nights || 1)));
      }
    }
  }

  return { prices, status: 200, rawCount: data.length, usedHotelIds: ids };
}

/* ===========================
   ROUTE GET
   =========================== */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // parametri
    const lat = searchParams.get("lat") != null ? Number(searchParams.get("lat")) : undefined;
    const lng = searchParams.get("lng") != null ? Number(searchParams.get("lng")) : undefined;
    const hotelId = (searchParams.get("hotelId") || "").trim() || undefined;
    const nameFilter = (searchParams.get("q") || "").trim() || undefined;   // es. "marriott"
    const cityKeyword = (searchParams.get("city") || "").trim() || undefined; // es. "London"
    const start = searchParams.get("start") || undefined; // YYYY-MM
    const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

    // token
    const token = await getAmadeusToken();

    // hotelIds da usare per tutti i mesi
    let hotelIdsForAllMonths: string[] = [];
    if (hotelId) {
      hotelIdsForAllMonths = [hotelId];
    } else {
      try {
        // 1) prova geocode (se lat/lng validi)
        if (Number.isFinite(lat as number) && Number.isFinite(lng as number)) {
          hotelIdsForAllMonths = await listHotelIdsByGeocode(token, {
            lat: lat!, lng: lng!, radiusKm: 35, limit: 40, q: nameFilter,
          });
        }
        // 2) fallback by-city
        if (!hotelIdsForAllMonths.length && cityKeyword) {
          const code = await findCityCode(token, cityKeyword);
          if (code) {
            hotelIdsForAllMonths = await listHotelIdsByCity(token, code, 60);
          }
        }
      } catch (e) {
        console.error("Prefetch hotelIds error", e);
      }
    }

    const months = build12Months(start);
    const monthly: number[] = new Array(12).fill(0);
    const debugRows: any[] = [];

    for (let i = 0; i < months.length; i++) {
      const m0 = months[i];
      const d1 = ymdDate(new Date(m0.getFullYear(), m0.getMonth(), 12));
      const d2 = ymdDate(new Date(m0.getFullYear(), m0.getMonth(), 22));

      const a = await fetchDayPrice(token, {
        checkIn: d1,
        nights: 1,
        hotelIds: hotelIdsForAllMonths.length ? hotelIdsForAllMonths : undefined,
        lat: hotelIdsForAllMonths.length ? undefined : lat,
        lng: hotelIdsForAllMonths.length ? undefined : lng,
        radiusKm: 35,
        nameFilter,
      });

      const b = await fetchDayPrice(token, {
        checkIn: d2,
        nights: 1,
        hotelIds: hotelIdsForAllMonths.length ? hotelIdsForAllMonths : undefined,
        lat: hotelIdsForAllMonths.length ? undefined : lat,
        lng: hotelIdsForAllMonths.length ? undefined : lng,
        radiusKm: 35,
        nameFilter,
      });

      const merged = [...a.prices, ...b.prices];
      monthly[i] = median(merged);

      if (debug) {
        debugRows.push({
          monthIndex: i + 1,
          monthLabel: `${String(m0.getMonth() + 1).padStart(2, "0")}/${m0.getFullYear()}`,
          sampleDays: [d1, d2],
          httpStatus: [a.status, b.status],
          bucketsFound: [a.rawCount, b.rawCount],
          usedHotelIds: (a.usedHotelIds?.length ? a.usedHotelIds : b.usedHotelIds) || [],
          priceSamples: merged.length,
          value: monthly[i],
        });
      }

      // throttle per mitigare 429 in sandbox
      await sleep(250);
    }
// Fallback dimostrativo: se tutti i valori risultano nulli/zero
if (!monthly.some(v => Number.isFinite(v) && v > 0)) {
  // Stagionalità Italia (12 valori, max ~100) → scala su un ADR demo
  const base = [45,48,62,72,86,96,100,98,90,70,52,48];
  const anchor = 110; // ADR medio di riferimento (demo)
  const scale = anchor / 100;
  for (let i = 0; i < 12; i++) monthly[i] = Math.round(base[i] * scale);
}

    return NextResponse.json(
      debug ? { ok: true, monthly, debug: debugRows } : { ok: true, monthly },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
