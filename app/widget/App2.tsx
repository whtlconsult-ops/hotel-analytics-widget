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

const COLORS = ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#22c55e","#06b6d4"];

export default function App2(){
  const search = useSearchParams();
  const q = search.get("q") || "Firenze";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [origins,  setOrigins]  = useState<OriginRow[]>([]);
  const [los,      setLOS]      = useState<LOSRow[]>([]);
  const [notes,    setNotes]    = useState<string[]>([]);

  useEffect(()=> {
    (async ()=>{
      try {
        const params = new URLSearchParams({ q, parts:"related", ch:"1", prov:"1", los:"1", date:"today 12-m", cat:"203" });
        const r = await fetch(`/api/serp/demand?${params.toString()}`);
        const j = await r.json();
        if (!j?.ok || !j.related) { setNotes(p=>[...p,"Nessun related disponibile"]); return; }
        const rel = j.related;
        setChannels([
          { channel:"Booking", value: rel.channels.find((x:any)=>x.label==="booking")?.value || 0 },
          { channel:"Airbnb",  value: rel.channels.find((x:any)=>x.label==="airbnb")?.value || 0 },
          { channel:"Diretto", value: rel.channels.find((x:any)=>x.label==="diretto")?.value || 0 },
          { channel:"Expedia", value: rel.channels.find((x:any)=>x.label==="expedia")?.value || 0 },
          { channel:"Altro",   value: rel.channels.find((x:any)=>x.label==="altro")?.value || 0 },
        ]);
        setOrigins([
          { name:"Italia",   value: rel.provenance.find((x:any)=>x.label==="italia")?.value || 0 },
          { name:"Germania", value: rel.provenance.find((x:any)=>x.label==="germania")?.value || 0 },
          { name:"Francia",  value: rel.provenance.find((x:any)=>x.label==="francia")?.value || 0 },
          { name:"USA",      value: rel.provenance.find((x:any)=>x.label==="usa")?.value || 0 },
          { name:"UK",       value: rel.provenance.find((x:any)=>x.label==="uk")?.value || 0 },
        ]);
        setLOS([
          { bucket:"1 notte",   value: rel.los.find((x:any)=>x.label==="1 notte")?.value || 0 },
          { bucket:"2-3 notti", value: rel.los.find((x:any)=>x.label==="2-3 notti")?.value || 0 },
          { bucket:"4-6 notti", value: rel.los.find((x:any)=>x.label==="4-6 notti")?.value || 0 },
          { bucket:"7+ notti",  value: rel.los.find((x:any)=>x.label==="7+ notti")?.value || 0 },
        ]);
      } catch (e:any) {
        setNotes(p=>[...p, String(e?.message||e)]);
      }
    })();
  }, [q]);

  const backHref = useMemo(()=>{
    const p = new URLSearchParams(search as any);
    const qs = p.toString();
    return (typeof window !== "undefined" ? location.pathname : "/").replace(/\/grafica\/?$/,"") + (qs ? `?${qs}` : "");
  }, [search]);

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
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
          {origins.length===0 || origins.every(x=>(x.value||0)===0) ? (
            <div className="h-56 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Pie data={origins} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} cornerRadius={6}>
                  {origins.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} stroke="#fff" strokeWidth={2}/>)}
                </Pie>
                <RTooltip />
                <Legend verticalAlign="bottom" iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* LOS */}
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
          {los.length===0 || los.every(x=>(x.value||0)===0) ? (
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

        {/* Canali */}
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
          {channels.length===0 || channels.every(x=>(x.value||0)===0) ? (
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
      </div>
    </div>
  );
}
