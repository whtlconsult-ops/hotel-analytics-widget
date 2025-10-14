export const runtime = "nodejs";
import { NextResponse } from "next/server";

const BASE = "https://api.geoapify.com/v2/places";

/* niente for-of su Set per compat con ES5 */
function dedupStrings(arr: string[]) {
  const out: string[] = [];
  for (let i=0;i<arr.length;i++) {
    const v = arr[i];
    if (v && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const key = process.env.GEOAPIFY_KEY;
    if (!key) return NextResponse.json({ ok:false, error:"GEOAPIFY_KEY mancante" }, { status:500 });

    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const radiusKm = Math.max(1, Math.min(25, Number(searchParams.get("radiusKm") || "5"))); // 1..25
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return NextResponse.json({ ok:false, error:"lat/lng mancanti" }, { status:400 });

    // categorie alloggi
    const cats = [
      "accommodation.hotel","accommodation.motel","accommodation.hostel","accommodation.apartment",
      "accommodation.guest_house","accommodation.bed_and_breakfast","accommodation.camping"
    ].join(",");

    const u = `${BASE}?categories=${encodeURIComponent(cats)}&filter=circle:${lng},${lat},${radiusKm*1000}&bias=proximity:${lng},${lat}&limit=30&apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(u, { cache:"force-cache", next:{ revalidate: 21600 }});
    const j = await r.json();

    const items = Array.isArray(j?.features) ? j.features.map((f:any) => {
      const p = f?.properties || {};
      const name = p.name || p.address_line1 || p.formatted || "";
      return {
        title: name,
        address: p.formatted || "",
        lat: Number(p.lat), lng: Number(p.lon),
        website: p.website || (p.datasource && p.datasource.raw && p.datasource.raw.website) || undefined,
        category: Array.isArray(p.categories) ? p.categories[0] : undefined
      };
    }).filter((x:any)=> x.title && Number.isFinite(x.lat) && Number.isFinite(x.lng)) : [];

    // dedup per titolo
    const seen: string[] = [];
    const cleaned = [];
    for (let i=0;i<items.length;i++) {
      const k = items[i].title.toLowerCase().trim();
      if (seen.indexOf(k) !== -1) continue;
      seen.push(k);
      cleaned.push(items[i]);
    }

    return NextResponse.json({ ok:true, items: cleaned.slice(0, 20) }, { status:200 });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status:500 });
  }
}
