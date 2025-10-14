export const runtime = "nodejs";
import { NextResponse } from "next/server";

const BASE = "https://api.geoapify.com/v1/geocode/search";

function pick(obj: any, path: string) {
  try {
    return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  } catch { return undefined; }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const key = process.env.GEOAPIFY_KEY;
    if (!key) return NextResponse.json({ ok:false, error:"GEOAPIFY_KEY mancante" }, { status:500 });

    const q = (searchParams.get("q") || "").trim(); // es: "Borgo Dolci Colline, Castiglion Fiorentino"
    if (!q) return NextResponse.json({ ok:false, error:"q mancante" }, { status:400 });

    const u = `${BASE}?text=${encodeURIComponent(q)}&type=amenity&filter=category.accommodation&limit=5&apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(u, { cache:"force-cache", next:{ revalidate: 21600 }});
    const j = await r.json();

    const out = Array.isArray(j?.features) ? j.features.map((f: any) => {
      const props = f?.properties || {};
      return {
        id: props.place_id || props.osm_id || props.datasource?.raw?.osm_id || undefined,
        name: props.name || props.address_line1 || props.formatted || "",
        lat: Number(props.lat), lng: Number(props.lon),
        address: props.formatted || "",
        category: props.categories ? String(props.categories[0]) : undefined,
        website: pick(props, "datasource.raw.website") || props.website || undefined,
      };
    }).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lng)) : [];

    return NextResponse.json({ ok:true, items: out }, { status:200 });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status:500 });
  }
}
