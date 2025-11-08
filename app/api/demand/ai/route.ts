export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type DayRow = { date: string; adr: number; pressure: number; confidence: number; interpolated?: boolean };
type Competitor = { name: string; rating?: number; reviews?: number; distance_km?: number; price_snippet?: number };

function toISODate(y:number,m:number,d:number){return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function clamp01(x:number){return Math.max(0, Math.min(1, x));}
function mean(xs:number[]){return xs.length? xs.reduce((a,b)=>a+b,0)/xs.length : 0;}
function median(xs:number[]){ if(!xs.length) return 0; const s=[...xs].sort((a,b)=>a-b); const i=Math.floor(s.length/2); return s.length%2? s[i] : (s[i-1]+s[i])/2; }

async function fetchJSON(u:string, ms=12000){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), ms);
  try { const r = await fetch(u, {signal:ctrl.signal, cache:"no-store"}); const j = await r.json().catch(()=>({}));
        return { ok:r.ok, status:r.status, data:j }; }
  catch(e:any){ return { ok:false, status:0, data:{ error:String(e?.message||e)} }; }
  finally{ clearTimeout(t); }
}

// --- SerpAPI web snippets (no scraping OTA pages) ---
async function serpWebSnippets(q:string){
  const key = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  if(!key) return { ok:false, items:[], mode:"demo", reason:"SERPAPI_KEY missing" };
  const u = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&hl=it&gl=it&num=10&api_key=${key}`;
  const r = await fetchJSON(u, 12000);
  const items = Array.isArray(r.data?.organic_results) ? r.data.organic_results : [];
  // Estrai prezzi dai snippet (best-effort)
  const parsed = items.slice(0,10).map((it:any)=>{
    const snip = [it?.snippet, it?.about_this_result?.source?.description].filter(Boolean).join(" ");
    const m = snip.match(/€\s?(\d{2,3})/); // best effort
    const price = m ? Number(m[1]) : undefined;
    return { title: it?.title, link: it?.link, price_from_snippet: price };
  });
  return { ok:true, items: parsed, mode:"live" };
}

// --- Google demand (riusa la tua route esistente) ---
async function fetchGoogleDemand(origin:string, loc:string, lat:string, lng:string){
  const p = new URLSearchParams({ q: loc, lat, lng, date:"today 12-m", cat:"203", parts:"trend" });
  p.set("fast","1");
  const r = await fetchJSON(`${origin}/api/serp/demand?`+p.toString(), 12000);
  const pts = Array.isArray(r.data?.trend?.points) ? r.data.trend.points : [];
  // normalizza 0–1
  const vals = pts.map((x:any)=> Number(x?.value)||0);
  const max = Math.max(1, ...vals);
  const norm = vals.map(v=> v/max);
  return { ok:r.ok, values: norm, raw: pts };
}

// --- Competitors nearby (PAR7) ---
async function fetchCompetitors(origin:string, place:string, radiusKm:number){
  const p = new URLSearchParams({ place, radius_km:String(radiusKm), category:"agriturismo" });
  const r = await fetchJSON(`${origin}/api/competitors/nearby?`+p.toString(), 12000);
  const items = Array.isArray(r.data?.items) ? r.data.items : [];
  return { ok: r.ok, items, mode: r.data?.meta?.mode || "demo" };
}

// --- Amadeus (TODO: collega la tua chiamata reale) ---
async function fetchAmadeusSummary(/*lat:number,lng:number, month:string*/){
  // TODO: qui aggancia le tue chiamate ad Amadeus (offers per date) e calcola:
  //  - availability_ratio per giorno
  //  - adr_median per giorno
  // Per ora demo stabile:
  return { ok:true, days:[] as Array<{date:string, adr_median:number, availability_ratio:number}>, mode:"demo" };
}

// --- AI synthesizer (Revy) ---
async function synthesizeWithAI(payload:any){
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if(!apiKey) {
    // fallback demo
    return { ok:true, mode:"demo", days:[], top_competitors:[] as Competitor[], source_weights:{ google:0.3, amadeus:0.4, ai_web:0.3 } };
  }
  const system =
    "Sei Revy, sintetizza in SOLO JSON. Campi richiesti: days[{date, adr, pressure, confidence}], " +
    "top_competitors[{name, rating, reviews, distance_km, price_snippet}], source_weights{google,amadeus,ai_web}. " +
    "Usa i dati forniti; stima adr/pressure per il mese. confidence 0–1. Niente testo fuori dal JSON.";
  const messages = [
    { role:"system", content: system },
    { role:"user", content: JSON.stringify(payload) }
  ];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${apiKey}`, "Content-Type":"application/json" },
    body: JSON.stringify({ model, temperature:0.2, max_tokens:1200, messages })
  });
  const j = await r.json().catch(()=> ({}));
  const text = j?.choices?.[0]?.message?.content || "";
  try {
    const parsed = JSON.parse(text);
    return { ok:true, mode:"live", ...parsed };
  } catch {
    // Se il modello ha aggiunto testo, prova a estrarre JSON “best effort”
    const m = text.match(/\{[\s\S]*\}$/);
    if (m) { try { return { ok:true, mode:"live", ...JSON.parse(m[0]) }; } catch {} }
    return { ok:false, mode:"live", error:"AI parse failed", raw:text };
  }
}

export async function GET(req: Request){
  try{
    const url = new URL(req.url);
    const origin = url.origin;
    const place  = (url.searchParams.get("place") || url.searchParams.get("location") || "").trim();
    const radius = Number(url.searchParams.get("radius_km") || 30);
    const month  = (url.searchParams.get("month") || "").trim(); // es. 2025-07
    const lat    = url.searchParams.get("lat") || "";
    const lng    = url.searchParams.get("lng") || "";

    if(!place && (!lat || !lng)) {
      return NextResponse.json({ ok:false, error:"Serve place oppure lat+lng." }, { status:400 });
    }

    // 1) signals
    const [serp, comps, ama] = await Promise.all([
      fetchGoogleDemand(origin, place || "", lat || "0", lng || "0"),
      fetchCompetitors(origin, place || `${lat},${lng}`, radius),
      fetchAmadeusSummary(/* TODO lat,lng,month */)
    ]);

    // 2) ai-web snippets (no scraping)
    const q = `site:booking.com OR site:expedia.it OR site:airbnb.it ${place} prezzo camera notte`;
    const snippets = await serpWebSnippets(q);

    // 3) payload per AI synth
    const payload = {
      month,
      place,
      radius_km: radius,
      google: { values: serp.values, raw_points: serp.raw?.slice?.(0,60) ?? [] },
      competitors: { items: comps.items },
      amadeus: ama,
      web_snippets: snippets,
      notes: "Genera days[] per tutte le date del mese richiesto; se alcuni segnali mancano, stima ma marca confidence più bassa."
    };

    const ai = await synthesizeWithAI(payload);

    // 4) fallback se AI non torna dati days
    let days: DayRow[] = Array.isArray(ai?.days) ? ai.days : [];
    if (!days.length) {
      // genera una curva demo coerente
      const today = new Date();
      const [y,m] = month && /^\d{4}-\d{2}$/.test(month) ? month.split("-").map(Number) : [today.getFullYear(), today.getMonth()+1];
      const end = new Date(y, m, 0).getDate();
      const baseAdr = median(comps.items.map((x:any)=> x?.prices_demo?.mid).filter(Boolean)) || 120;
      const base = Array.from({length:end}).map((_,i)=>{
        const date = toISODate(y,m,i+1);
        const bump = Math.sin((i/end)*Math.PI); // picco a metà mese, demo
        const adr = Math.round(baseAdr*(0.85 + 0.4*bump));
        const pressure = Math.round(100*clamp01(0.4 + 0.5*bump));
        const confidence = snippets.ok ? 0.65 : 0.5;
        return { date, adr, pressure, confidence, interpolated:true };
      });
      days = base;
    }

    return NextResponse.json({
      ok:true,
      mode: ai?.mode || snippets.mode || "partial",
      days,
      top_competitors: ai?.top_competitors || [],
      source_weights: ai?.source_weights || { google:0.3, amadeus:0.4, ai_web:0.3 },
      meta: { ts: new Date().toISOString() }
    });
  } catch(e:any){
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 });
  }
}
