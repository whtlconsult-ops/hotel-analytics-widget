export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat") || "45.985");  // Bellagio
    const lng = Number(url.searchParams.get("lng") || "9.257");
    const radiusKm = Math.min(30, Math.max(2, Number(url.searchParams.get("radius_km") || "12")));
    const checkIn  = (url.searchParams.get("check_in") || new Date().toISOString().slice(0,10));
    const nights   = Math.min(7, Math.max(1, Number(url.searchParams.get("nights") || "1")));

    const key    = process.env.AMADEUS_API_KEY;
    const secret = process.env.AMADEUS_API_SECRET;
    const env    = (process.env.AMADEUS_ENV || "test").toLowerCase();
    const base   = env === "prod" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";

    if (!key || !secret) {
      return NextResponse.json({ ok:false, error:"Manca AMADEUS_API_KEY o AMADEUS_API_SECRET" }, { status:400 });
    }

    // token
    const tkRes = await fetch(`${base}/v1/security/oauth2/token`, {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:"client_credentials",
        client_id:key,
        client_secret:secret
      })
    });
    const tk = await tkRes.json().catch(()=> ({}));
    const token = tk?.access_token;
    if (!token) {
      return NextResponse.json({ ok:false, step:"token", status: tkRes.status, body: tk }, { status:502 });
    }

    // check-out
    const ci = new Date(checkIn);
    const co = new Date(ci); co.setDate(co.getDate() + nights);
    const coISO = `${co.getFullYear()}-${String(co.getMonth()+1).padStart(2,"0")}-${String(co.getDate()).padStart(2,"0")}`;

    // offers
    const u = new URL(`${base}/v3/shopping/hotel-offers`);
    u.searchParams.set("latitude", String(lat));
    u.searchParams.set("longitude", String(lng));
    u.searchParams.set("radius", String(radiusKm));
    u.searchParams.set("radiusUnit", "KM");
    u.searchParams.set("checkInDate", checkIn);
    u.searchParams.set("checkOutDate", coISO);
    u.searchParams.set("adults", "2");
    u.searchParams.set("currencyCode", "EUR");

    const offRes = await fetch(u.toString(), { headers:{ Authorization:`Bearer ${token}` }, cache:"no-store" });
    const off = await offRes.json().catch(()=> ({}));
    const arr = Array.isArray(off?.data) ? off.data : [];

    const mins: number[] = [];
    for (const it of arr) {
      const offers = Array.isArray(it?.offers) ? it.offers : [];
      let min = Infinity;
      for (const o of offers) {
        const price = Number(o?.price?.total || o?.price?.base);
        if (Number.isFinite(price)) min = Math.min(min, price);
      }
      if (isFinite(min)) mins.push(min);
    }

    const med = mins.length
      ? (()=>{ const s=[...mins].sort((a,b)=>a-b); const i=Math.floor(s.length/2); return s.length%2 ? s[i] : (s[i-1]+s[i])/2; })()
      : 0;

    return NextResponse.json({
      ok: true,
      env,
      query: { lat, lng, radiusKm, checkIn, nights },
      stats: { hotels_with_offers: mins.length, median_min_price: med },
      sample: mins.slice(0, 10)
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 });
  }
}
