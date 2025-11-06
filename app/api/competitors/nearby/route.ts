export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// Haversine per distanza in km
function distKm(a: {lat:number,lng:number}, b:{lat:number,lng:number}) {
  const R = 6371;
  const toRad = (x:number)=> x*Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
  const aa = s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
}

type Item = {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  link?: string;
  rating?: number;
  reviews?: number;
  distance_km: number;
  prices_demo?: { low?: number; mid?: number; high?: number; note: string };
};

async function fetchJSON(u: string, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), ms);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { "User-Agent": "HotelTradeWidget/1.0" }, cache: "no-store" });
    const j = await r.json().catch(()=> ({}));
    return { ok: r.ok, status: r.status, data: j };
  } catch (e:any) {
    return { ok: false, status: 0, data: { error: String(e?.message||e) } };
  } finally {
    clearTimeout(t);
  }
}

function estimatePricesDemo(rating?: number) {
  // Stima semplice per dare un'idea fasce—sempre etichettata demo.
  const anchor = rating && rating >= 4.6 ? 150 : rating && rating >= 4.3 ? 130 : 110;
  return {
    low: Math.max(70, Math.round(anchor - 25)),
    mid: Math.round(anchor),
    high: Math.round(anchor + 40),
    note: "Prezzi stimati [demo] basati su rating e area."
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  const category = (url.searchParams.get("category") || "agriturismo").trim();
  const place = (url.searchParams.get("place") || url.searchParams.get("loc") || "").trim();
  const latQ = url.searchParams.get("lat");
  const lngQ = url.searchParams.get("lng");
  const radiusKm = Math.min(60, Math.max(1, Number(url.searchParams.get("radius_km") || 30)));
  const limit = Math.min(20, Math.max(3, Number(url.searchParams.get("limit") || 12)));

  if (!apiKey) {
    // Fallback demo assoluto
    const center = { lat: 39.6908, lng: 8.4869 }; // circa Torre dei Corsari (demo)
    const items: Item[] = Array.from({length:6}).map((_,i)=>({
      name: `Agriturismo Demo ${i+1}`,
      lat: center.lat + (Math.random()-0.5)*0.1,
      lng: center.lng + (Math.random()-0.5)*0.1,
      distance_km: Math.round(Math.random()*radiusKm*10)/10,
      rating: 4.2 + Math.random()*0.6,
      reviews: 30 + Math.floor(Math.random()*120),
      prices_demo: estimatePricesDemo(4.3)
    }));
    return NextResponse.json({ ok:true, meta:{ mode:"demo", reason:"SERPAPI_KEY mancante" }, center, radius_km: radiusKm, category, items });
  }

  // 1) Determina centro
  let center: {lat:number, lng:number} | null = null;
  if (latQ && lngQ) {
    center = { lat: Number(latQ), lng: Number(lngQ) };
  } else if (place) {
    // geocoding via Google Maps (SerpAPI)
    const u = `https://serpapi.com/search.json?engine=google_maps&type=search&hl=it&gl=it&q=${encodeURIComponent(place)}&api_key=${apiKey}`;
    const g = await fetchJSON(u);
    const hit = Array.isArray(g.data?.local_results) ? g.data.local_results[0] : null;
    const gps = hit?.gps_coordinates;
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      center = { lat: Number(gps.latitude), lng: Number(gps.longitude) };
    }
  }
  if (!center) {
    // fallback demo centro grosso modo in zona Oristano costa
    center = { lat: 39.6908, lng: 8.4869 };
  }

  // 2) Cerca category vicino a place/center (Google Maps via SerpAPI)
  const q = place ? `${category} ${place}` : `${category}`;
  const u2 = `https://serpapi.com/search.json?engine=google_maps&type=search&hl=it&gl=it&q=${encodeURIComponent(q)}&api_key=${apiKey}`;
  const s = await fetchJSON(u2);
  let results: any[] = Array.isArray(s.data?.local_results) ? s.data.local_results : [];
  // filtra per distanza
  const items: Item[] = results
    .map((r:any) => {
      const gps = r?.gps_coordinates || {};
      const p = { lat: Number(gps.latitude), lng: Number(gps.longitude) };
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
      const d = distKm(center!, p);
      return {
        name: String(r?.title || r?.name || "Senza nome"),
        lat: p.lat,
        lng: p.lng,
        address: r?.address || r?.full_address,
        link: r?.link,
        rating: Number(r?.rating) || undefined,
        reviews: Number(String(r?.reviews || "").replace(/[^\d]/g,"")) || undefined,
        distance_km: Math.round(d*10)/10,
      } as Item;
    })
    .filter(Boolean)
    .filter((it:Item)=> it.distance_km <= radiusKm)
    .sort((a:Item,b:Item)=> a.distance_km - b.distance_km)
    .slice(0, limit);

  let mode: "live" | "demo" = "live";

  // Se vuoto, crea demo decente
  if (!items.length) {
    mode = "demo";
    for (let i=0;i<6;i++) {
      const d = Math.round((3 + Math.random() * (radiusKm-3))*10)/10;
      items.push({
        name: `Agriturismo Demo ${i+1}`,
        lat: center.lat + (Math.random()-0.5)*0.12,
        lng: center.lng + (Math.random()-0.5)*0.12,
        distance_km: d,
        rating: 4.1 + Math.random()*0.7,
        reviews: 25 + Math.floor(Math.random()*150),
      });
    }
  }

  // Stima prezzi demo (sempre marcata demo — non abbiamo tariffe ufficiali qui)
  const enriched = items.map(it => ({
    ...it,
    prices_demo: estimatePricesDemo(it.rating)
  }));

  return NextResponse.json({
    ok: true,
    meta: { mode, ts: new Date().toISOString(), category },
    center,
    radius_km: radiusKm,
    items: enriched
  });
}
