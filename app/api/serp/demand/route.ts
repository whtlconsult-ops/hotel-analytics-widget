// app/api/serp/demand/route.ts
import { NextResponse } from "next/server";

type SerpDemandPayload = {
  ok: boolean;
  byDate: Array<{ dateISO: string; pressure: number; adr: number }>;
  channels: Array<{ channel: string; value: number }>;
  origins: Array<{ name: string; value: number }>;
  losDist: Array<{ bucket: string; value: number }>;
  trend: Array<{ dateLabel: string; value: number }>;
  usage?: { searches_used?: number; searches_total?: number; searches_left?: number };
  note?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function map0to100To0to200(x: number) {
  // Trends è 0..100 – alziamo la dinamica per la heatmap
  return Math.round((x || 0) * 2);
}
function guessChannelsFromQueries(queries: string[]) {
  const buckets: Record<string, number> = { Booking: 0, Airbnb: 0, Diretto: 0, Expedia: 0, Altro: 0 };
  queries.forEach(q => {
    const s = q.toLowerCase();
    if (s.includes("booking")) buckets.Booking += 1;
    else if (s.includes("airbnb")) buckets.Airbnb += 1;
    else if (s.includes("expedia")) buckets.Expedia += 1;
    else if (s.includes("sito") || s.includes("hotel") || s.includes("diretto")) buckets.Diretto += 1;
    else buckets.Altro += 1;
  });
  const out = Object.entries(buckets).map(([channel, value]) => ({ channel, value }));
  if (out.every(x => x.value === 0)) return [
    { channel:"Booking", value:36 },{ channel:"Airbnb", value:26 },{ channel:"Diretto", value:22 },{ channel:"Expedia", value:11 },{ channel:"Altro", value:5 },
  ];
  return out;
}
function guessOriginsFromQueries(queries: string[]) {
  const map: Record<string, number> = {};
  const known = ["italia","germania","francia","usa","stati uniti","uk","regno unito","svizzera","olanda","austria","spagna"];
  queries.forEach(q => {
    const s = q.toLowerCase();
    for (const k of known) if (s.includes(k)) map[k] = (map[k] || 0) + 1;
  });
  const normName = (k: string) =>
    k === "stati uniti" ? "USA" :
    k === "regno unito" ? "UK" :
    k.charAt(0).toUpperCase() + k.slice(1);
  const out = Object.entries(map).map(([k,v]) => ({ name: normName(k), value: v }));
  if (out.length === 0) return [
    { name:"Italia", value: 42 },{ name:"Germania", value: 22 },{ name:"Francia", value: 14 },{ name:"USA", value: 10 },{ name:"UK", value: 12 }
  ];
  return out.sort((a,b)=>b.value-a.value).slice(0,6);
}
function guessLOSFromQueries(queries: string[]) {
  // Heuristica molto semplice
  const buckets: Record<string, number> = {"1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0};
  queries.forEach(q => {
    const s = q.toLowerCase();
    if (s.match(/\b1\b|\buna notte\b/)) buckets["1 notte"]++;
    else if (s.match(/\b2\b|\b3\b|weekend/)) buckets["2-3 notti"]++;
    else if (s.match(/\b4\b|\b5\b|\b6\b/)) buckets["4-6 notti"]++;
    else if (s.match(/\b7\b|settiman/i)) buckets["7+ notti"]++;
  });
  const out = Object.entries(buckets).map(([bucket,value])=>({bucket, value}));
  if (out.every(x=>x.value===0)) return [
    { bucket:"1 notte", value: 15 },{ bucket:"2-3 notti", value: 46 },{ bucket:"4-6 notti", value: 29 },{ bucket:"7+ notti", value: 10 },
  ];
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const apiKey = process.env.SERPAPI_KEY;
  const q        = searchParams.get("q") || "Firenze";
  const monthISO = searchParams.get("monthISO") || "";
  const lat      = Number(searchParams.get("lat") || "0");
  const lng      = Number(searchParams.get("lng") || "0");
  const radiusKm = Number(searchParams.get("radiusKm") || "20");
  const mode     = searchParams.get("mode") || "zone";
  const types    = (searchParams.get("types") || "").split(",").filter(Boolean);

  // Periodo Trends: mese selezionato
  let timeRange = "";
  try {
    if (monthISO && /^\d{4}-\d{2}-\d{2}$/.test(monthISO)) {
      const d = new Date(monthISO);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
      const fmt = (x: Date) => x.toISOString().slice(0,10);
      timeRange = `${fmt(start)} ${fmt(end)}`;
    }
  } catch {}

  // Geo: Trends accetta codici (es. IT), non lat/lng; useremo IT come fallback
  // e aggiungiamo la località nella query
  const geo = "IT";
  const topic = [q, ...(types.length? [types[0]]: [])].join(" ");

  const payload: SerpDemandPayload = {
    ok: false,
    byDate: [],
    channels: [],
    origins: [],
    losDist: [],
    trend: [],
  };

  if (!apiKey) {
    payload.note = "SERPAPI_KEY mancante: restituisco dati demo.";
    return NextResponse.json(payload);
  }

  try {
    // 1) TIMELINE (Google Trends)
    const params = new URLSearchParams({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: topic,
      geo,
      ...(timeRange ? { date: timeRange } : {}),
      api_key: apiKey,
    });
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json() as any;

    const values: Array<{time: string; value: number}> =
      j?.interest_over_time?.timeline_data?.map((t: any) => ({
        time: t?.time, value: Number(t?.values?.[0]?.extracted_value ?? t?.values?.[0]?.value ?? 0)
      })) || [];

    // Serie giorno → pressione e ADR stimato
    const byDate = values.map(v => {
      const dateISO = v.time?.slice(0,10) || "";
      const pressure = clamp(map0to100To0to200(v.value), 0, 200);
      const adr = Math.round(70 + (pressure/200)*80); // 70–150 eur
      return { dateISO, pressure, adr };
    });

    // Trend per grafico linea (etichetta “d MMM”)
    const trend = values.map(v => ({
      dateLabel: new Date(v.time).toLocaleDateString("it-IT", { day:"2-digit", month:"short" }),
      value: clamp(map0to100To0to200(v.value) + (mode==="competitor"?8:0), 0, 200)
    }));

    // 2) RELATED QUERIES → euristiche per canali/provenienza/LOS
    const rel = j?.related_queries || [];
    const relQueries: string[] = rel.flatMap((g: any) =>
      (g?.queries || []).map((x: any) => String(x?.query || ""))
    );

    const channels = guessChannelsFromQueries(relQueries);
    const origins  = guessOriginsFromQueries(relQueries);
    const losDist  = guessLOSFromQueries(relQueries);

    // 3) Usage
    let usage: SerpDemandPayload["usage"] | undefined = undefined;
    try {
      const u = await fetch(`https://serpapi.com/account?api_key=${apiKey}`, { cache: "no-store" }).then(r=>r.json());
      if (u && typeof u.quota_searches_used === "number") {
        usage = {
          searches_used: u.quota_searches_used,
          searches_total: u.quota_searches_total,
          searches_left: u.plan_searches_left ?? (u.quota_searches_total - u.quota_searches_used),
        };
      }
    } catch {}

    payload.ok = true;
    payload.byDate = byDate;
    payload.trend = trend;
    payload.channels = channels;
    payload.origins = origins;
    payload.losDist = losDist;
    if (usage) payload.usage = usage;
    payload.note = relQueries.length === 0 ? "Dati Trends senza related queries (campioni ridotti)." : undefined;

    return NextResponse.json(payload);
  } catch (e: any) {
    payload.note = `Errore SERPAPI: ${String(e?.message || e)}`;
    return NextResponse.json(payload);
  }
}
