// app/api/external/geocode/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  if (!q) return NextResponse.json({ ok:false, error:"missing q" }, { status: 400 });

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "HospitalityWidget/1.0" }, cache: "no-store" });
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return NextResponse.json({ ok:false, results: [] });
    const results = arr.map((x:any)=> ({
      lat: Number(x.lat), lng: Number(x.lon),
      name: x.display_name,
    }));
    return NextResponse.json({ ok:true, results });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status: 500 });
  }
}
