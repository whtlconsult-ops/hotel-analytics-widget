export const runtime = "nodejs";
export const revalidate = 21600; // 6h

import { NextResponse } from "next/server";

type SourceBlock = {
  rating?: number;
  reviews?: number;
  snippets?: string[];
  place_id?: string;
  link?: string;
};

function pickBestName(q: string, loc?: string) {
  const s = (q || "").replace(/\s+/g, " ").trim();
  if (!loc) return s;
  if (s.toLowerCase().includes(loc.toLowerCase())) return s;
  return `${s} ${loc}`;
}
function toNumber(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("Timeout")), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: ctrl.signal, headers: { "User-Agent": "HotelTradeWidget/1.0" } });
  } finally {
    clearTimeout(t);
  }
}

function normalizeMaps(json: any): SourceBlock | null {
  try {
    const arr = Array.isArray(json?.local_results) ? json.local_results : [];
    if (!arr.length) return null;
    const best = arr[0];
    const rating = toNumber(best?.rating);
    const reviews = toNumber(String(best?.reviews || "").replace(/[^\d]/g, ""));
    const place_id = best?.place_id || best?.data_id || undefined;
    const link = best?.link || undefined;
    return { rating, reviews, place_id, link };
  } catch { return null; }
}

function normalizeHotels(json: any): SourceBlock | null {
  try {
    const arr = Array.isArray(json?.properties) ? json.properties : (Array.isArray(json?.results) ? json.results : []);
    if (!arr.length) return null;
    const best = arr[0];
    const rating = toNumber(best?.overall_rating || best?.rating);
    const reviews = toNumber(best?.reviews || best?.review_count);
    const link = best?.link || best?.hotel_link || undefined;
    return { rating, reviews, link };
  } catch { return null; }
}

function compileReputation(google?: SourceBlock | null, hotels?: SourceBlock | null) {
  const sources: Record<string, SourceBlock> = {};
  if (google) sources.google = google;
  if (hotels) sources.hotels = hotels;

  // Weighted average: Google 0.6, Hotels 0.4
  const parts: Array<{ w: number; r: number }> = [];
  if (google?.rating) parts.push({ w: 0.6, r: google.rating });
  if (hotels?.rating) parts.push({ w: 0.4, r: hotels.rating });

  let reputation_index: number | undefined = undefined;
  if (parts.length) {
    const num = parts.reduce((a,b)=> a + b.w*b.r, 0);
    const den = parts.reduce((a,b)=> a + b.w, 0);
    reputation_index = Math.round((num / den) * 20); // scala 0–100
  }

  const reviews_total = (google?.reviews || 0) + (hotels?.reviews || 0) || undefined;

  return { sources, compiled: { reputation_index, reviews_total } };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });

    const q = (url.searchParams.get("q") || "").trim();
    const loc = (url.searchParams.get("loc") || "").trim();
    if (!q) return NextResponse.json({ ok: false, error: "Manca 'q'." }, { status: 400 });

    const query = encodeURIComponent(pickBestName(q, loc));

    // 1) Google Maps (local_results)
    let google: SourceBlock | null = null;
    try {
      const u = `https://serpapi.com/search.json?engine=google_maps&type=search&hl=it&gl=it&q=${query}&api_key=${apiKey}`;
      const r = await fetchWithTimeout(u, 8000);
      const j = await r.json();
      google = normalizeMaps(j);
    } catch {}

    // 2) Google Hotels (best-effort)
    let hotels: SourceBlock | null = null;
    try {
      const u = `https://serpapi.com/search.json?engine=google_hotels&hl=it&gl=it&q=${query}&api_key=${apiKey}`;
      const r = await fetchWithTimeout(u, 8000);
      const j = await r.json();
      hotels = normalizeHotels(j);
    } catch {}

    let mode: "live" | "demo" = "live";
    let compiled = compileReputation(google, hotels);

    // Fallback demo se nessuna fonte valida
    if (!compiled.compiled.reputation_index && !compiled.sources.google && !compiled.sources.hotels) {
      mode = "demo";
      const demo = { rating: 4.3, reviews: 75 };
      compiled = compileReputation(demo, null);
      (compiled as any).sources.demo = demo as any;
    }

    return NextResponse.json({
      ok: true,
      entity: { q, loc },
      ...compiled,
      meta: { ts: new Date().toISOString(), mode }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
