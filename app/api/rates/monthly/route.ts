export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAmadeusToken } from "../../../../lib/amadeus";

function parseNum(x:any){ const n=Number(x); return Number.isFinite(n)?n:undefined; }
function median(nums:number[]) {
  const a = nums.slice().sort((x,y)=>x-y);
  if (a.length===0) return undefined;
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function ymd(y:number,m:number,d:number){ return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

async function fetchDayPrice(
  token: string,
  lat: number,
  lng: number,
  checkIn: string,
  nights: number,
  hotelName?: string
) {
  const url = new URL("https://test.api.amadeus.com/v3/shopping/hotel-offers");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("radius", "5");              // 1° tentativo: 5 km
  url.searchParams.set("radiusUnit", "KM");
  url.searchParams.set("adults", "2");
  url.searchParams.set("checkInDate", checkIn);

  // LOS reale → check-out
  const inD = new Date(checkIn + "T00:00:00Z");
  const outD = new Date(inD.getTime() + Math.max(1, nights) * 86400000);
  const checkOut = `${outD.getUTCFullYear()}-${String(outD.getUTCMonth()+1).padStart(2,"0")}-${String(outD.getUTCDate()).padStart(2,"0")}`;
  url.searchParams.set("checkOutDate", checkOut);

  url.searchParams.set("roomQuantity", "1");
  url.searchParams.set("paymentPolicy", "NONE");
  url.searchParams.set("includeClosed", "false");
  url.searchParams.set("bestRateOnly", "true");
  url.searchParams.set("currency", "EUR");

  // helper che estrae prezzi da una response
  const extractPrices = async (u: URL) => {
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!r.ok) return [] as number[];
    const j = await r.json();
    const data = Array.isArray(j?.data) ? j.data : [];
    const prices: number[] = [];
    for (const item of data) {
      const h = item?.hotel;
      if (hotelName) {
        const n = String(h?.name || "").toLowerCase();
        const needle = hotelName.toLowerCase();
        // match SOFT: almeno una parola del nome deve comparire
        const okSoft = needle.split(/\s+/).some(w => w && n.includes(w));
        if (n && !okSoft) continue;
      }
      const offers = Array.isArray(item?.offers) ? item.offers : [];
      for (const ofr of offers) {
        const p = ofr?.price;
        const tot =
          parseNum(p?.total) ??
          parseNum(p?.variations?.average?.total) ??
          parseNum(p?.variations?.changes?.[0]?.total);
        if (tot != null) {
          const perNight = Math.round(tot / Math.max(1, nights));
          prices.push(perNight);
        }
      }
    }
    return prices;
  };

  // 1° tentativo: raggio 5 km
  let prices = await extractPrices(url);
  if (prices.length) return Math.min(...prices);

  // 2° tentativo: raggio 10 km
  url.searchParams.set("radius", "10");
  prices = await extractPrices(url);
  if (prices.length) return Math.min(...prices);

  // 3° tentativo: raggio 15 km
  url.searchParams.set("radius", "15");
  prices = await extractPrices(url);
  if (prices.length) return Math.min(...prices);

  // 4° tentativo: shift +1 giorno (alcuni giorni non hanno offerte)
  const inD2 = new Date(inD.getTime() + 86400000);
  const checkIn2 = `${inD2.getUTCFullYear()}-${String(inD2.getUTCMonth()+1).padStart(2,"0")}-${String(inD2.getUTCDate()).padStart(2,"0")}`;
  url.searchParams.set("checkInDate", checkIn2);
  const outD2 = new Date(inD2.getTime() + Math.max(1, nights) * 86400000);
  const checkOut2 = `${outD2.getUTCFullYear()}-${String(outD2.getUTCMonth()+1).padStart(2,"0")}-${String(outD2.getUTCDate()).padStart(2,"0")}`;
  url.searchParams.set("checkOutDate", checkOut2);

  prices = await extractPrices(url);
  return prices.length ? Math.min(...prices) : null;
}

export async function GET(req: Request){
  try{
    const { searchParams } = new URL(req.url);
    const y = Number(searchParams.get("year") || new Date().getFullYear());
    const nights = Math.max(1, Number(searchParams.get("nights") || "1"));
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const q   = (searchParams.get("q") || "").trim();  // facoltativo: filtro nome hotel

    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return NextResponse.json({ ok:false, error:"lat/lng richiesti" }, { status:400 });

    const token = await getAmadeusToken();

    const monthly: number[] = [];
    for (let m = 1; m <= 12; m++) {
  // 4 campioni/mese → più chance di avere tariffe
  const samples = [7, 14, 21, 28];
  const prices: number[] = [];
  for (const day of samples) {
    const d = ymd(y, m, day);
    // niente filtro nome hotel per default → aggregazione area più robusta
    const price = await fetchDayPrice(token, lat, lng, d, nights, /*hotelName*/ undefined);
    if (price != null) prices.push(price);
  }
  const med = median(prices);
  monthly.push(med != null ? Math.round(med) : 0);
}
    return NextResponse.json({ ok:true, currency:"EUR", monthly }, { status:200 });
  }catch(e:any){
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
