// app/api/external/reverse-geocode/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  if (!lat || !lng) return NextResponse.json({ ok:false, error:"missing lat/lng" }, { status: 400 });

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=12&addressdetails=1`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "HospitalityWidget/1.0" }, cache: "no-store" });
    const j = await r.json();
    const name = j?.display_name || `${lat},${lng}`;
    return NextResponse.json({ ok:true, name });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status: 500 });
  }
}
