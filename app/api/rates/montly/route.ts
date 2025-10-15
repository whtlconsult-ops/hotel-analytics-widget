export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getAmadeusToken } from "../../../../lib/amadeus";

/* utility minime */
function parseNum(x:any){ const n=Number(x); return Number.isFinite(n)?n:undefined; }
function median(nums:number[]) {
  const a = nums.slice().sort((x,y)=>x-y);
  if (a.length===0) return undefined;
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function ymd(y:number,m:number,d:number){ return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

/* estrae prezzi dall'API offers */
async function fetchDayPrice(token:string, lat:number, lng:number, checkIn:string, nights:number, hotelName?:string){
  const url = new URL("https://test.api.amadeus.com/v3/shopping/hotel-offers");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("radius", "5");
  url.searchParams.set("radiusUnit", "KM");
  url.searchParams.set("adults", "2");
  url.searchParams.set("checkInDate", checkIn);
  url.searchParams.set("roomQuantity", "1");
  url.searchParams.set("paymentPolicy", "NONE");
  url.searchParams.set("includeClosed", "false");
  url.searchParams.set("bestRateOnly", "true");
  url.searchParams.set("currency", "EUR");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;

  const j = await r.json();
  const data = Array.isArray(j?.data) ? j.data : [];
  const prices:number[] = [];
  for (let i=0;i<data.length;i++){
    const h = data[i]?.hotel;
    if (hotelName){
      const n = String(h?.name || "").toLowerCase();
      const needle = hotelName.toLowerCase();
      if (n && !n.includes(needle)) continue;
    }
    const offers = Array.isArray(data[i]?.offers) ? data[i].offers : [];
    for (let k=0;k<offers.length;k++){
      const p = offers[k]?.price;
      const tot = parseNum(p?.total) || parseNum(p?.variations?.average?.total) || parseNum(p?.variations?.changes?.[0]?.total);
      if (tot != null){
        const perNight = Math.round(tot / Math.max(1, nights));
        prices.push(perNight);
      }
    }
  }
  return prices.length ? Math.min(...prices) : null;
}

export async function GET(req: Request){
  try{
    const { searchParams } = new URL(req.url);
    const y = Number(searchParams.get("year") || new Date().getFullYear());
    const nights = Math.max(1, Number(searchParams.get("nights") || "1"));
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    const q   = (searchParams.get("q") || "").trim();  // facoltativo: filtro per nome hotel

    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return NextResponse.json({ ok:false, error:"lat/lng richiesti" }, { status:400 });

    const token = await getAmadeusToken();

    const monthly: number[] = [];
    for (let m=1; m<=12; m++){
      // due campioni/mese → robusto e parco chiamate
      const samples = [10, 20];
      const prices:number[] = [];
      for (let s=0; s<samples.length; s++){
        const d = ymd(y, m, samples[s]);
        const price = await fetchDayPrice(token, lat, lng, d, nights, q || undefined);
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
