export const runtime = "nodejs";
import { NextResponse } from "next/server";

// fetch con cache "soft"
const serpFetch = (u: string) =>
  fetch(u, { cache: "force-cache", next: { revalidate: 21600 } })
    .then(r => r.json())
    .catch(() => ({} as any));

function slug(s: string) {
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    const loc  = (searchParams.get("loc")  || "").trim();

    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;

    // Output standardizzato
    type Item = {
      title: string;
      address?: string;
      rating?: number;
      reviews?: number;
      coords?: { lat: number; lng: number };
      phone?: string;
      url?: string;
    };
    const items: Item[] = [];

    // 1) SERPAPI → Google Maps (se ho quota)
    if (apiKey && (name || loc)) {
      // a) se ho nome+loc → cerca la struttura e i vicini (local_results)
      const q1 = [name, loc].filter(Boolean).join(" ");
      const p1 = new URLSearchParams({
        engine: "google_maps",
        type: "search",
        hl: "it",
        q: q1 || `hotel ${loc}`,
        api_key: apiKey,
      });
      const j1 = await serpFetch(`https://serpapi.com/search.json?${p1.toString()}`);
      const list = Array.isArray(j1?.local_results) ? j1.local_results : [];

      // b) se ho solo loc → query generica "hotel <loc>"
      if (list.length === 0 && loc) {
        const p2 = new URLSearchParams({
          engine: "google_maps",
          type: "search",
          hl: "it",
          q: `hotel ${loc}`,
          api_key: apiKey,
        });
        const j2 = await serpFetch(`https://serpapi.com/search.json?${p2.toString()}`);
        const l2 = Array.isArray(j2?.local_results) ? j2.local_results : [];
        for (const r of l2) {
          items.push({
            title: r?.title || "",
            address: r?.address,
            rating: Number(r?.rating) || undefined,
            reviews: Number(r?.reviews) || Number(r?.user_ratings_total) || undefined,
            coords: r?.gps_coordinates?.latitude && r?.gps_coordinates?.longitude
              ? { lat: Number(r.gps_coordinates.latitude), lng: Number(r.gps_coordinates.longitude) }
              : undefined,
            phone: r?.phone,
            url: r?.link || r?.website,
          });
        }
      } else {
        for (const r of list) {
          items.push({
            title: r?.title || "",
            address: r?.address,
            rating: Number(r?.rating) || undefined,
            reviews: Number(r?.reviews) || Number(r?.user_ratings_total) || undefined,
            coords: r?.gps_coordinates?.latitude && r?.gps_coordinates?.longitude
              ? { lat: Number(r.gps_coordinates.latitude), lng: Number(r.gps_coordinates.longitude) }
              : undefined,
            phone: r?.phone,
            url: r?.link || r?.website,
          });
        }
      }

      // dedup e rimuovi la stessa struttura (se indicata)
      const seen = new Set<string>();
      const ref = slug(name);
      const cleaned: Item[] = [];
      for (const it of items) {
        const key = slug(it.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (ref && key.includes(ref)) continue; // esclude la struttura di riferimento
        cleaned.push(it);
      }
      return NextResponse.json({ ok: true, items: cleaned.slice(0, 12) }, { status: 200 });
    }

    // 2) Fallback Nominatim (OSM) se manca SERP o quota
    if (loc) {
      // geocodifica loc → poi query "hotel" nella stessa area
      const g = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(loc)}&limit=1&addressdetails=1`,
        { headers: { "User-Agent": "HotelTradeAudit/1.0" }, cache: "no-store" }
      ).then(r => r.json()).catch(()=>[]);
      let bbox: string | undefined;
      if (Array.isArray(g) && g[0]?.boundingbox) {
        const b = g[0].boundingbox; // [south, north, west, east]
        bbox = `${b[0]},${b[1]},${b[2]},${b[3]}`;
      }

      const q = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(`hotel ${loc}`)}${bbox?`&bounded=1&viewbox=${bbox}`:""}&limit=20`,
        { headers: { "User-Agent": "HotelTradeAudit/1.0" }, cache: "no-store" }
      ).then(r => r.json()).catch(()=>[]);

      const arr: Item[] = Array.isArray(q) ? q.map((r: any) => ({
        title: r?.display_name?.split(",")[0] || r?.name || "",
        address: r?.display_name,
        coords: (r?.lat && r?.lon) ? { lat: Number(r.lat), lng: Number(r.lon) } : undefined,
      })) : [];
      const seen = new Set<string>();
      const ref = slug(name);
      const cleaned: Item[] = [];
      for (const it of arr) {
        const key = slug(it.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (ref && key.includes(ref)) continue;
        cleaned.push(it);
      }
      return NextResponse.json({ ok: true, items: cleaned.slice(0, 12) }, { status: 200 });
    }

    return NextResponse.json({ ok: true, items: [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
