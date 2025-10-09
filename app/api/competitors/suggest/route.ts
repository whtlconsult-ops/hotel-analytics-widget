export const runtime = "nodejs";
import { NextResponse } from "next/server";

const serpFetch = (u: string) =>
  fetch(u, { cache: "force-cache", next: { revalidate: 21600 } })
    .then(r => r.json()).catch(()=> ({} as any));

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const loc  = (searchParams.get("loc")  || "").trim();
    if (!loc) return NextResponse.json({ ok:false, error:"Missing loc" }, { status:400 });

    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    if (!apiKey) {
      // fallback statico minimo
      const demo = [
        { name:"Hotel Centrale", address:`${loc}`, rating:8.6, category:"Hotel" },
        { name:"Residenza Duomo", address:`${loc}`, rating:8.9, category:"B&B" },
        { name:"Palazzo Storico", address:`${loc}`, rating:8.2, category:"Hotel" },
        { name:"Agriturismo Le Colline", address:`${loc}`, rating:9.1, category:"Agriturismo" },
        { name:"Albergo Riviera", address:`${loc}`, rating:8.0, category:"Hotel" },
      ];
      return NextResponse.json({ ok:true, items: demo }, { status:200 });
    }

    // Google Maps search “lodging near <loc>”
    const p = new URLSearchParams({
      engine: "google_maps", type: "search",
      q: `lodging near ${loc}`, hl: "it", api_key: apiKey,
    });
    const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
    const res = Array.isArray(j?.local_results) ? j.local_results : [];
    const items = res.slice(0, 10).map((r: any) => ({
      name: r?.title || "",
      address: r?.address,
      rating: r?.rating ? Number(r.rating) : undefined,
      category: r?.type || r?.place_type,
      distanceKm: r?.distance_meters ? Number(r.distance_meters)/1000 : undefined,
    })).filter((x:any)=> x.name);

    return NextResponse.json({ ok:true, items: items.slice(0,8) }, { status:200 });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
