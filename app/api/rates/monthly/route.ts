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
 * Ricava fino a N hotelId vicini a lat/lng usando Hotel List v1
 * Opzionale: filtra per nome con `q` (case-insensitive).
 */
async function listHotelIdsByGeocode(
  token: string,
  {
    lat, lng, radiusKm = 35, limit = 40, q
  }: { lat: number; lng: number; radiusKm?: number; limit?: number; q?: string }
): Promise<string[]> {
  const base = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode";
  const u = new URL(base);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("radius", String(Math.max(1, Math.min(50, radiusKm))));
  u.searchParams.set("radiusUnit", "KM");
  u.searchParams.set("page[limit]", String(Math.max(1, Math.min(100, limit))));
  u.searchParams.set("hotelSource", "ALL"); // <- prendi anche indipendenti

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("Amadeus HotelList by-geocode error", r.status, txt);
    return [];
  }

  const j = await r.json().catch(() => ({}));
  let rows: any[] = Array.isArray(j?.data) ? j.data : [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(d => String(d?.name || "").toLowerCase().includes(needle));
  }
  return Array.from(new Set(rows.map(d => String(d?.hotelId || "")).filter(Boolean))).slice(0, limit);
}
// --- sostituisce fetchDayPrice ---
// Accetta una lista di hotelIds. Se manca, la ricava da lat/lng via Hotel List.
async function fetchDayPrice(
  token: string,
  {
    checkIn, nights,
    hotelIds,
    lat, lng, radiusKm = 25, nameFilter,
  }: {
    checkIn: string; nights: number;
    hotelIds?: string[];
    lat?: number; lng?: number; radiusKm?: number;
    nameFilter?: string;
  }
): Promise<{ prices: number[]; status: number; rawCount: number; usedHotelIds: string[] }> {

  let ids: string[] = Array.isArray(hotelIds) ? hotelIds.filter(Boolean) : [];

  if (ids.length === 0 && lat != null && lng != null) {
    ids = await listHotelIdsByGeocode(token, {
      lat, lng, radiusKm, limit: 20, q: nameFilter
    });
  }

  if (ids.length === 0) {
    return { prices: [], status: 204, rawCount: 0, usedHotelIds: [] };
  }

  // Hotel Offers v3 richiede hotelIds=... (comma-separated)
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

  const j = await r.json().catch(() => ({}));
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
        prices.push(Math.round(tot / Math.max(1, nights)));
      }
    }
  }

  return { prices, status: 200, rawCount: data.length, usedHotelIds: ids };
}

// Ricava cityCode (IATA) da keyword città
async function findCityCode(token: string, keyword: string): Promise<string | null> {
  const u = new URL("https://test.api.amadeus.com/v1/reference-data/locations/cities");
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("max", "3");

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    console.error("Cities lookup error", r.status, t);
    return null;
  }
  const j = await r.json().catch(()=> ({}));
  const rows = Array.isArray(j?.data) ? j.data : [];
  const code = rows.find((x:any)=> x?.iataCode)?.iataCode;
  return code ? String(code) : null;
}

// Lista hotelIds per cityCode (fallback quando by-geocode non rende)
async function listHotelIdsByCity(token: string, cityCode: string, limit = 60): Promise<string[]> {
  const base = "https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city";
  const u = new URL(base);
  u.searchParams.set("cityCode", cityCode);
  u.searchParams.set("page[limit]", String(Math.max(1, Math.min(100, limit))));

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("Amadeus HotelList by-city error", r.status, txt);
    return [];
  }

  const j = await r.json().catch(() => ({}));
  const rows = Array.isArray(j?.data) ? j.data : [];
  return Array.from(new Set(rows.map((d:any)=> String(d?.hotelId || "")).filter(Boolean))).slice(0, limit);
}

/** ==============================
 *  ROUTE HANDLER
 *  ============================== */
// --- helpers per mesi futuri ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function ymdDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Ritorna 12 Date corrispondenti al giorno 1 di ciascun mese,
 * a partire da "start" (YYYY-MM) oppure dal mese corrente.
 * Sempre future/rolling.
 */
function build12Months(start?: string): Date[] {
  const base = start ? new Date(`${start}-01T00:00:00`) : new Date();
  base.setDate(1); // normalizza
  const out: Date[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(new Date(base.getFullYear(), base.getMonth() + i, 1));
  }
  return out;
}
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

// opzionale: filtro nome (es. q=marriott)
const nameFilter = (searchParams.get("q") || "").trim() || undefined;
// opzionale: nome città esplicito (es. city=London)
const cityKeyword = (searchParams.get("city") || "").trim() || undefined;

let hotelIdsForAllMonths: string[] = [];
if (hotelId) {
  hotelIdsForAllMonths = [hotelId];
} else {
  try {
    const token2 = await getAmadeusToken();
    // 1) tenta by-geocode
    if (Number.isFinite(lat as number) && Number.isFinite(lng as number)) {
      hotelIdsForAllMonths = await listHotelIdsByGeocode(token2, {
        lat: lat!, lng: lng!, radiusKm: 35, limit: 40, q: nameFilter
      });
    }

    // 2) fallback by-city (se geocode vuoto)
    if (!hotelIdsForAllMonths.length && (cityKeyword || Number.isFinite(lat as number))) {
      let code: string | null = null;
      if (cityKeyword) {
        code = await findCityCode(token2, cityKeyword);
      } else {
        // se non hai passato city=, prova con keyword generica comune (es. "London", "Rome")
        // Integrazione minima: puoi derivarla lato client e passarla qui.
        code = await findCityCode(token2, "London"); // <- cambia se vuoi testare rapido
      }
      if (code) {
        hotelIdsForAllMonths = await listHotelIdsByCity(token2, code, 60);
      }
    }
  } catch (e) {
    console.error("Prefetch hotelIds error", e);
  }
}
    // mesi rolling (o start=YYYY-MM via query)
const start = searchParams.get("start") || undefined;
const months = build12Months(start);

// opzionale: filtro per nome (quando l’utente analizza una struttura specifica)
const nameFilter = (searchParams.get("q") || "").trim() || undefined;

// Se arriva un hotelId singolo → usalo; altrimenti prepara ids da geocode
hotelIdsForAllMonths = [];
if (hotelId) {
  hotelIdsForAllMonths = [hotelId];
} else if (Number.isFinite(lat as number) && Number.isFinite(lng as number)) {
  try {
    const ids = await listHotelIdsByGeocode(await getAmadeusToken(), {
      lat: lat!, lng: lng!, radiusKm: 25, limit: 20, q: nameFilter
    });
    hotelIdsForAllMonths = ids;
  } catch (e) {
    console.error("HotelList prefetch error", e);
  }
}

if (!hotelIdsForAllMonths.length && !hotelId) {
  // non blocchiamo la risposta, ma segnaliamo che non abbiamo hotel
  if (debug) {
    console.warn("Nessun hotelId trovato nell’area indicata.");
  }
}

for (let i = 0; i < months.length; i++) {
  const m0 = months[i];

  // date di campionamento nel mese (12 e 22)
  const d1 = ymdDate(new Date(m0.getFullYear(), m0.getMonth(), 12));
  const d2 = ymdDate(new Date(m0.getFullYear(), m0.getMonth(), 22));

  const a = await fetchDayPrice(token, {
  checkIn: d1, nights: 1,
  hotelIds: hotelIdsForAllMonths.length ? hotelIdsForAllMonths : undefined,
  lat: hotelIdsForAllMonths.length ? undefined : (lat ?? undefined),
  lng: hotelIdsForAllMonths.length ? undefined : (lng ?? undefined),
  radiusKm: 35,
  nameFilter
});

const b = await fetchDayPrice(token, {
  checkIn: d2, nights: 1,
  hotelIds: hotelIdsForAllMonths.length ? hotelIdsForAllMonths : undefined,
  lat: hotelIdsForAllMonths.length ? undefined : (lat ?? undefined),
  lng: hotelIdsForAllMonths.length ? undefined : (lng ?? undefined),
  radiusKm: 35,
  nameFilter
});

  const merged = [...a.prices, ...b.prices];
  monthly[i] = median(merged);

  if (debug) {
    debugRows.push({
      monthIndex: i + 1,
      monthLabel: `${String(m0.getMonth() + 1).padStart(2,"0")}/${m0.getFullYear()}`,
      sampleDays: [d1, d2],
      httpStatus: [a.status, b.status],
      bucketsFound: [a.rawCount, b.rawCount],
      priceSamples: merged.length,
      value: monthly[i],
    });
  }

  // piccolo throttle per evitare 429
  await sleep(250);
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
