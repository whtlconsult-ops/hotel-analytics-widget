"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

type ChannelRow = { channel: string; value: number };
type OriginRow  = { name: string; value: number };
type LOSRow     = { bucket: string; value: number };

const COLORS = ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#22c55e","#06b6d4","#f43f5e"];

// --- Fallback dimostrativo "plausibile" per Related --- //
type ChannelRow = { channel: string; value: number };
type OriginRow  = { name: string; value: number };
type LOSRow     = { bucket: string; value: number };

function monthIndexFromParam(m?: string | null): number {
  // accetta "YYYY-MM" o "YYYY-MM-DD" → 0..11 (0=Gennaio)
  if (!m) return new Date().getMonth();
  const s = String(m);
  const mm = s.length >= 7 ? Number(s.slice(5,7)) - 1 : new Date().getMonth();
  return Number.isFinite(mm) ? Math.min(11, Math.max(0, mm)) : new Date().getMonth();
}

function classifyCity(city: string) {
  const s = city.toLowerCase();
  const urban = ["roma","rome","milano","milan","firenze","florence","venezia","venice","napoli","naples","bologna","torino","turin","verona","genova","pisa","siena"];
  const sea   = ["rimini","riccione","viareggio","taormina","alghero","cagliari","olbia","gallipoli","sorrento","positano","ostuni"];
  const mountain = ["madonna di campiglio","cortina","cortina d'ampezzo","bormio","livigno","ortisei","selva","val gardena","canazei","alpe di siusi","brunico","folgarida","courmayeur"];
  if (urban.some(x => s.includes(x))) return "urban";
  if (sea.some(x => s.includes(x))) return "sea";
  if (mountain.some(x => s.includes(x))) return "mountain";
  return "generic";
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function lerp(a:number,b:number,t:number){ return a+(b-a)*t; }

// Canali base per tipologia
function baseChannelsForType(types: string[]): Record<string, number> {
  const has = (t: string) => types.some(x => (x||"").toLowerCase().includes(t));
  // default hotel
  let booking=45, diretto=25, expedia=15, airbnb=10, altro=5;
  if (has("b&b") || has("bnb") || has("appart")) { booking=30; diretto=20; expedia=5; airbnb=40; altro=5; }
  if (has("agritur")) { booking=20; diretto=45; expedia=5; airbnb=20; altro=10; }
  return { booking, diretto, expedia, airbnb, altro };
}

// Aggiusta per contesto città e mese
function adjustChannels(ctx: "urban"|"sea"|"mountain"|"generic", mIdx:number, ch: Record<string,number>) {
  const summer = (mIdx>=5 && mIdx<=8) ? 1 : 0; // giu-lug-ago-set
  if (ctx==="sea") {
    ch.expedia = lerp(ch.expedia, ch.expedia+8, summer);
    ch.airbnb  = lerp(ch.airbnb,  ch.airbnb +6, summer);
  }
  if (ctx==="mountain") {
    const winter = (mIdx===0 || mIdx===1 || mIdx===11) ? 1 : 0; // dic-gen-feb
    ch.booking = lerp(ch.booking, ch.booking+6, winter);
    ch.diretto = lerp(ch.diretto, ch.diretto+4, winter);
  }
  if (ctx==="urban") {
    ch.diretto = lerp(ch.diretto, ch.diretto+6, clamp01(1-summer)*0.6);
  }
  // normalizza a 100
  const tot = ch.booking+ch.diretto+ch.expedia+ch.airbnb+ch.altro;
  Object.keys(ch).forEach(k => (ch as any)[k] = Math.round((ch as any)[k]*100/tot));
  return ch;
}

// Provenienza base + stagionalità (estate più UK/USA/DE/FR; inverno più Italia)
function syntheticOrigins(city:string, mIdx:number): OriginRow[] {
  let it=45, de=12, fr=10, uk=15, us=18;
  const ctx = classifyCity(city);
  if (ctx==="sea" || ctx==="mountain") { it = 52; de=14; fr=10; uk=12; us=12; }
  if (mIdx>=5 && mIdx<=8) { // estate
    it -= 6; uk += 4; us += 4; de += 2;
  } else if (mIdx===11 || mIdx===0) { // festività inverno
    it += 4; de += 1; fr += 1;
  }
  let altro = Math.max(0, 100 - (it+de+fr+uk+us));
  return [
    { name: "Italia",  value: it },
    { name: "Germania",value: de },
    { name: "Francia", value: fr },
    { name: "UK",      value: uk },
    { name: "USA",     value: us },
    { name: "Altro",   value: altro },
  ];
}

// LOS: città molte 1-2 notti; mare/montagna più soggiorni lunghi in stagione
function syntheticLOS(city:string, mIdx:number): LOSRow[] {
  const ctx = classifyCity(city);
  let n1=40, n23=35, n46=15, n7=10; // base urbana
  if (ctx==="sea") {
    if (mIdx>=5 && mIdx<=8) { n1=18; n23=32; n46=30; n7=20; }
  }
  if (ctx==="mountain") {
    if (mIdx===11 || mIdx===0 || mIdx===1) { n1=22; n23=30; n46=28; n7=20; }
  }
  const tot = n1+n23+n46+n7;
  return [
    { bucket: "1 notte",    value: Math.round(n1*100/tot) },
    { bucket: "2-3 notti",  value: Math.round(n23*100/tot) },
    { bucket: "4-6 notti",  value: Math.round(n46*100/tot) },
    { bucket: "7+ notti",   value: Math.round(n7*100/tot) },
  ];
}

function syntheticChannels(types: string[]|null|undefined, city:string, mIdx:number): ChannelRow[] {
  const base = baseChannelsForType(types || []);
  const adj  = adjustChannels(classifyCity(city), mIdx, base);
  return [
    { channel: "Booking.com", value: adj.booking },
    { channel: "Diretto",     value: adj.diretto },
    { channel: "Expedia",     value: adj.expedia },
    { channel: "Airbnb",      value: adj.airbnb },
    { channel: "Altro",       value: adj.altro },
  ];
}

export default function App2(){
  const search = useSearchParams();

const q = search.get("q") || "Firenze";
const hasCh   = search.has("ch");
const hasProv = search.has("prov");
const hasLos  = search.has("los");
const noneSelected = !hasCh && !hasProv && !hasLos;

const ch   = noneSelected ? true : search.get("ch") === "1";
const prov = noneSelected ? true : search.get("prov") === "1";
const losF = noneSelected ? true : search.get("los") === "1";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [origins,  setOrigins]  = useState<OriginRow[]>([]);
  const [los,      setLOS]      = useState<LOSRow[]>([]);
  const [notes,    setNotes]    = useState<string[]>([]);

  useEffect(() => {
  (async () => {
    try {
      const params = new URLSearchParams({
        q, parts: "related", date: "today 12-m", cat: "203",
        ch: ch ? "1" : "0", prov: prov ? "1" : "0", los: losF ? "1" : "0",
      });
      let usedFallback = false;
      let rel: any = null;

      try {
        const r = await fetch(`/api/serp/demand?${params.toString()}`);
        const j = await r.json();
        if (j?.ok && j.related) {
          rel = j.related;
        }
      } catch { /* ignore */ }

      const mIdx = monthIndexFromParam(search.get("m"));
      const types = (search.get("t") || "").split(",").filter(Boolean);

      // Se SERP assente o arrays vuoti → fallback sintetico
      if (!rel || (
        (!Array.isArray(rel.channels)   || rel.channels.every((x:any)=> (x.value||0)===0)) &&
        (!Array.isArray(rel.provenance) || rel.provenance.every((x:any)=> (x.value||0)===0)) &&
        (!Array.isArray(rel.los)        || rel.los.every((x:any)=> (x.value||0)===0))
      )) {
        usedFallback = true;
        if (ch)   setChannels(syntheticChannels(types, q, mIdx));
        if (prov) setOrigins(syntheticOrigins(q, mIdx));
        if (losF) setLOS(syntheticLOS(q, mIdx));
      } else {
        if (ch && Array.isArray(rel.channels)) {
          setChannels(rel.channels.map((x:any)=>({ channel: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()), value: Number(x.value)||0 })));
        }
        if (prov && Array.isArray(rel.provenance)) {
          setOrigins(rel.provenance.map((x:any)=>({ name: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()), value: Number(x.value)||0 })));
        }
        if (losF && Array.isArray(rel.los)) {
          setLOS(rel.los.map((x:any)=>({ bucket: x.label, value: Number(x.value)||0 })));
        }
      }

      if (usedFallback) {
        setNotes(p=> Array.from(new Set([...p, "Dati dimostrativi (SERP non disponibile)."])));
      }
    } catch (e:any) {
      setNotes(p=> Array.from(new Set([...p, String(e?.message||e)])));
    }
  })();
}, [q, ch, prov, losF, search]);

  const [backHref, setBackHref] = useState<string>("/");
useEffect(() => {
  const qs = typeof window !== "undefined" ? window.location.search : "";
  setBackHref("/" + (qs || ""));
}, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Grafica – Dati correlati</h1>
          <a href={backHref} className="px-3 py-2 text-sm rounded-lg bg-white border hover:bg-slate-50">⬅ Torna all’Analisi</a>
        </div>

        {notes.length>0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-900">
            {notes.join(" · ")}
          </div>
        )}

        {/* Provenienza */}
        {prov && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
            {origins.length === 0 || origins.every(x => (x.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie data={origins} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} cornerRadius={6} labelLine={false}
                    label={({ percent }) => `${Math.round((percent || 0) * 100)}%`}>
                    {origins.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} stroke="#fff" strokeWidth={2}/>)}
                  </Pie>
                  <RTooltip />
                  <Legend verticalAlign="bottom" iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* LOS */}
        {losF && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
            {los.length === 0 || los.every(x => (x.value || 0) === 0) ? (
              <div className="h-48 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={los} margin={{ top: 16, right: 16, left: 8, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8,8,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Canali */}
        {ch && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {channels.length === 0 || channels.every(x => (x.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={channels} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" interval={0} height={40} />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8,8,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
