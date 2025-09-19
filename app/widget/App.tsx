'use client';

// ===== Block 1/4 =====
import React, { useEffect, useMemo, useState } from 'react';
import {
  format, parseISO, startOfMonth, endOfMonth, addDays
} from 'date-fns';
import { it } from 'date-fns/locale';
import {
  ResponsiveContainer, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, BarChart, Bar
} from 'recharts';

/** ---------- Tipi ---------- */
type Mode = 'zone' | 'competitor';
type RelatedBuckets = {
  channels: { label: string; value: number }[];
  provenance: { label: string; value: number }[];
  los: { label: string; value: number }[];
};
type SerpResp = {
  ok: boolean;
  series: { date: string; score: number }[];
  related?: RelatedBuckets;
  note?: string;
};
type QuotaResp = {
  ok: boolean;
  total_searches_left?: number;
  plan_searches_left?: number;
  this_month_usage?: number;
};

/** ---------- Helpers ---------- */
function daysOfMonthWindow(monthISO: string): Date[] {
  const s = startOfMonth(parseISO(`${monthISO}-01`));
  const e = endOfMonth(parseISO(`${monthISO}-01`));
  const out: Date[] = [];
  let d = s;
  while (d <= e) { out.push(d); d = addDays(d, 1); }
  return out;
}
function daysBetween(fromISO: string, toISO: string): Date[] {
  const s = parseISO(fromISO), e = parseISO(toISO);
  const out: Date[] = [];
  let d = s;
  while (d <= e) { out.push(d); d = addDays(d, 1); }
  return out;
}
function resampleHold(
  weekly: { date: string; score: number }[],
  dates: Date[]
): { dateISO: string; dateLabel: string; value: number }[] {
  if (!Array.isArray(weekly) || weekly.length === 0) {
    return dates.map(d => ({
      dateISO: d.toISOString().slice(0,10),
      dateLabel: format(d, 'd MMM', { locale: it }),
      value: 0
    }));
  }
  const pts = weekly
    .map(p => ({ d: parseISO(p.date), v: Number(p.score) || 0 }))
    .sort((a,b)=> a.d.getTime() - b.d.getTime());
  let idx = 0, last = 0;
  return dates.map(day => {
    while (idx < pts.length && pts[idx].d.getTime() <= day.getTime()) { last = pts[idx].v; idx++; }
    return { dateISO: day.toISOString().slice(0,10), dateLabel: format(day,'d MMM',{locale:it}), value: last };
  });
}
function normalize0to100(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const den = Math.max(1, max - min);
  return values.map(v => Math.round(((v - min) / den) * 100));
}
function adrFromPressure(p: number, mode: Mode): number {
  const baseMin = 80, baseMax = 140;
  const est = baseMin + (p/100) * (baseMax - baseMin);
  return Math.round(mode === 'competitor' ? est * 1.10 : est);
}
function ensureHotelQ(q: string) {
  return /hotel/i.test(q) ? q.trim() : `${q.trim()} hotel`;
}

/** ---------- Map placeholder (per non dipendere da altri file) ---------- */
function MapBox({ lat, lng, radiusKm, onPick }: {
  lat: number; lng: number; radiusKm: number;
  onPick?: (p: { lat: number; lng: number; label?: string }) => void;
}) {
  return (
    <div
      className="w-full h-full rounded-xl border grid place-items-center text-xs text-slate-600 select-none"
      title="Mappa (placeholder). Clic per confermare il punto corrente."
      onClick={() => onPick?.({ lat, lng })}
    >
      <div>🗺️ Mappa (placeholder)</div>
      <div>Lat: {lat.toFixed(4)} — Lng: {lng.toFixed(4)} — Raggio: {radiusKm} km</div>
    </div>
  );
}
// ===== Block 2/4 =====
export default function AppWidget() {
  /** ---- Stato base “classico” ---- */
  const [query, setQuery] = useState<string>('Firenze, Toscana, Italia');
  const [center, setCenter] = useState<{lat:number; lng:number}>({ lat: 43.7696, lng: 11.2558 });
  const [radiusKm, setRadiusKm] = useState<number>(20);

  const [monthISO, setMonthISO] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [mode, setMode] = useState<Mode>('zone');

  // Tipologie (multi-select persistente)
  const ALL_TYPES = ['hotel','bb','agriturismo','resort','appartamenti'] as const;
  const LABELS: Record<(typeof ALL_TYPES)[number], string> = {
    hotel:'Hotel', bb:'B&B', agriturismo:'Agriturismi', resort:'Resort', appartamenti:'Appartamenti'
  };
  const [types, setTypes] = useState<(typeof ALL_TYPES)[number][]>(['hotel']);
  const [typesOpen, setTypesOpen] = useState(false);
  const [typesTemp, setTypesTemp] = useState<(typeof ALL_TYPES)[number][]>(['hotel']);

  // Toggle grafici
  const [wantTrend, setWantTrend] = useState(true);
  const [wantCh, setWantCh] = useState(false);
  const [wantProv, setWantProv] = useState(false);
  const [wantLos, setWantLos] = useState(false);

  // Range avanzato (solo grafici) – opzionale
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  // Dati
  const [seriesRaw, setSeriesRaw] = useState<SerpResp['series']>([]);
  const [related, setRelated] = useState<RelatedBuckets | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [quota, setQuota] = useState<QuotaResp | null>(null);
  const [loading, setLoading] = useState(false);

  /** ---- Init da URL (compat semplice) ---- */
  useEffect(() => {
    const sp = new URLSearchParams(globalThis?.location?.search || '');
    const q = sp.get('q'); if (q) setQuery(q);
    const r = Number(sp.get('r') || 20); setRadiusKm([10,20,30].includes(r)?r:20);
    const m = sp.get('m'); if (m) setMonthISO(m);
    const md = sp.get('mode'); if (md==='zone'||md==='competitor') setMode(md as Mode);

    setWantTrend(sp.get('trend') !== '0');
    setWantCh(sp.get('ch') === '1');
    setWantProv(sp.get('prov') === '1');
    setWantLos(sp.get('los') === '1');

    const t = (sp.get('t') || 'hotel').split(',').map(s=>s.trim()).filter(Boolean);
    const valid = t.filter((x): x is (typeof ALL_TYPES)[number] => (ALL_TYPES as readonly string[]).includes(x));
    setTypes(valid.length ? valid : ['hotel']); setTypesTemp(valid.length ? valid : ['hotel']);

    const f = sp.get('from')||''; const to = sp.get('to')||'';
    if (f && to) { setRangeEnabled(true); setRangeFrom(f); setRangeTo(to); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistUrl() {
    const url = new URL(globalThis?.location?.href || '');
    const p = url.searchParams;
    p.set('q', query); p.set('r', String(radiusKm)); p.set('m', monthISO);
    p.set('mode', mode);
    p.set('trend', wantTrend ? '1' : '0');
    p.set('ch', wantCh ? '1' : '0');
    p.set('prov', wantProv ? '1' : '0');
    p.set('los', wantLos ? '1' : '0');
    p.set('t', types.join(','));
    if (rangeEnabled && rangeFrom && rangeTo) { p.set('from', rangeFrom); p.set('to', rangeTo); } else { p.delete('from'); p.delete('to'); }
    try { history.replaceState({}, '', `${url.pathname}?${p.toString()}`); } catch {}
  }

  function resetAll() {
    setQuery('Firenze, Toscana, Italia');
    setCenter({lat:43.7696, lng:11.2558});
    setRadiusKm(20);
    setMonthISO(format(new Date(),'yyyy-MM'));
    setMode('zone');
    setTypes(['hotel']); setTypesTemp(['hotel']); setTypesOpen(false);
    setWantTrend(true); setWantCh(false); setWantProv(false); setWantLos(false);
    setRangeEnabled(false); setRangeFrom(''); setRangeTo('');
    setSeriesRaw([]); setRelated(undefined); setNote(undefined);
    persistUrl();
  }
// ===== Block 3/4 =====
  /** ---- QUOTA ---- */
  async function fetchQuota() {
    try { const r = await fetch('/api/serp/quota',{cache:'no-store'}); const j = await r.json(); setQuota(j); } catch {}
  }

  /** ---- SERP (date=from to + flags) ---- */
  async function fetchSerp() {
    setLoading(true);
    try {
      // mese selezionato → date “from to”
      const from = format(startOfMonth(parseISO(`${monthISO}-01`)), 'yyyy-MM-dd');
      const to   = format(endOfMonth(parseISO(`${monthISO}-01`)),   'yyyy-MM-dd');

      const parts: string[] = [];
      if (wantTrend) parts.push('trend');
      if (wantCh || wantProv || wantLos) parts.push('related');

      const u = new URLSearchParams();
      u.set('q', ensureHotelQ(query));
      u.set('lat', String(center.lat));
      u.set('lng', String(center.lng));
      u.set('parts', parts.join(',') || 'trend');
      u.set('cat', '203');
      u.set('date', `${from} ${to}`);
      if (wantCh)   u.set('ch','1');
      if (wantProv) u.set('prov','1');
      if (wantLos)  u.set('los','1');

      const r = await fetch(`/api/serp/demand?${u.toString()}`, { cache:'no-store' });
      const j: SerpResp = await r.json();

      if (!j.ok) {
        setSeriesRaw([]); setRelated(undefined);
        setNote(j.note || 'Nessun dato disponibile per i parametri selezionati.');
      } else {
        setSeriesRaw(Array.isArray(j.series) ? j.series : []);
        setRelated(j.related); setNote(j.note);
      }
    } catch {
      setSeriesRaw([]); setRelated(undefined); setNote('Errore nel recupero dati.');
    } finally {
      setLoading(false); persistUrl(); fetchQuota();
    }
  }
  useEffect(() => { fetchSerp(); /* mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ---- Derivate: calendario mese dai Trends reali ---- */
  const monthDays = useMemo(() => daysOfMonthWindow(monthISO), [monthISO]);
  const serpTrendMonth = useMemo(() => resampleHold(seriesRaw, monthDays), [seriesRaw, monthDays]);
  const calendarPressure = useMemo(() => normalize0to100(serpTrendMonth.map(p => p.value||0)), [serpTrendMonth]);
  const calendarData = useMemo(() => monthDays.map((d,i)=>({
    dateISO: d.toISOString().slice(0,10),
    day: format(d,'d',{locale:it}),
    pressure: calendarPressure[i] || 0,
    adr: adrFromPressure(calendarPressure[i] || 0, mode),
  })), [monthDays, calendarPressure, mode]);

  /** ---- Derivate: range scrollabile (se attivo) + ADR stimato ---- */
  const rangeDays = useMemo(() => {
    if (rangeEnabled && rangeFrom && rangeTo) return daysBetween(rangeFrom, rangeTo);
    return daysBetween(
      format(startOfMonth(parseISO(`${monthISO}-01`)),'yyyy-MM-dd'),
      format(endOfMonth(parseISO(`${monthISO}-01`)),'yyyy-MM-dd')
    );
  }, [rangeEnabled, rangeFrom, rangeTo, monthISO]);

  const serpTrendRangeDaily = useMemo(() => resampleHold(seriesRaw, rangeDays), [seriesRaw, rangeDays]);
  const trendWithADR = useMemo(() => {
    const norm = normalize0to100(serpTrendRangeDaily.map(p => p.value||0));
    return serpTrendRangeDaily.map((p,i)=> ({ ...p, adrEst: adrFromPressure(norm[i]||0, mode) }));
  }, [serpTrendRangeDaily, mode]);

  /** ---- Quota badge ---- */
  const quotaBadge = useMemo(() => {
    if (!quota?.ok) return '—/—';
    const left = quota.total_searches_left ?? quota.plan_searches_left ?? undefined;
    const used = quota.this_month_usage ?? undefined;
    if (left == null || used == null) return '—/—';
    return `${used}/${used + left} (left ${left})`;
  }, [quota]);

  const disabledGenerate = loading || !query.trim();
// ===== Block 4/4 =====
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="text-sm px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            SerpAPI quota: {quotaBadge}
          </div>
          <div className="flex-1" />
          <div className="text-[12px] text-slate-500">{note || ''}</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SINISTRA: mappa grande + andamento mese + calendario */}
        <section className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-2xl border shadow-sm p-3">
            <div className="text-sm font-semibold mb-2">Mappa & Zona (raggio {radiusKm} km)</div>
            <div className="h-[360px]">
              <MapBox
                lat={center.lat}
                lng={center.lng}
                radiusKm={radiusKm}
                onPick={(p) => {
                  setCenter({lat:p.lat, lng:p.lng});
                  if (!/hotel/i.test(query)) setQuery(`${query} hotel`);
                }}
              />
            </div>
          </div>

          {/* Andamento domanda — mese */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">
              Andamento domanda — {format(parseISO(`${monthISO}-01`),'MMMM yyyy',{locale:it})}
            </div>
            {serpTrendMonth.every(p => (p.value||0)===0) ? (
              <div className="h-56 grid place-items-center text-sm text-slate-500">Dati insufficienti per il mese selezionato.</div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={serpTrendMonth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dateLabel" interval={Math.ceil(serpTrendMonth.length/12)} />
                    <YAxis />
                    <RTooltip />
                    <defs>
                      <linearGradient id="gradM" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1e3a8a" />
                        <stop offset="100%" stopColor="#1e3a8a" />
                      </linearGradient>
                      <linearGradient id="fillM" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" fill="url(#fillM)" stroke="url(#gradM)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Calendario — pressione Trends + ADR stimato */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">
              Calendario domanda — {format(parseISO(`${monthISO}-01`),'MMMM yyyy',{locale:it})}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarData.map(d => {
                const bg = `hsl(12, 90%, ${90 - Math.round((d.pressure||0)*0.5)}%)`;
                return (
                  <div key={d.dateISO} className="rounded-lg p-2 border text-center" style={{ background: bg }}>
                    <div className="text-xs font-semibold">{d.day}</div>
                    <div className="text-[10px]">ADR ~ {d.adr}€</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Range scrollabile + ADR overlay (se attivo) */}
          {(rangeEnabled && rangeFrom && rangeTo) && (
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">
                Andamento (range) — {rangeFrom} → {rangeTo}
              </div>
              {trendWithADR.every(p => (p.value||0)===0) ? (
                <div className="h-56 grid place-items-center text-sm text-slate-500">Nessun segnale per il periodo selezionato.</div>
              ) : (
                <div className="overflow-x-auto">
                  <div style={{ minWidth: `${Math.max(trendWithADR.length*14, 720)}px` }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={trendWithADR}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dateLabel" interval={Math.ceil(trendWithADR.length/14)} />
                        <YAxis yAxisId="demand" />
                        <YAxis yAxisId="adr" orientation="right" />
                        <RTooltip />
                        <defs>
                          <linearGradient id="gradR" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1e3a8a" />
                            <stop offset="100%" stopColor="#1e3a8a" />
                          </linearGradient>
                          <linearGradient id="fillR" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <Area yAxisId="demand" type="monotone" dataKey="value" fill="url(#fillR)" stroke="url(#gradR)" />
                        <Line yAxisId="adr" type="monotone" dataKey="adrEst" stroke="#ef4444" strokeWidth={1.6} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div className="mt-2 text-[11px] text-slate-500">ADR stimato. Per ADR reale collega OTA/CSV/Sheet.</div>
            </div>
          )}
        </section>

        {/* DESTRA: controlli classici */}
        <aside className="lg:col-span-4 space-y-4">
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="text-sm font-semibold">Località & Parametri</div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Es. Firenze, Toscana"
              className="w-full h-10 px-3 rounded-xl border border-slate-300"
            />
            <div className="grid grid-cols-2 gap-2 items-center">
              <label className="text-xs text-slate-600">Raggio (km)</label>
              <select
                value={radiusKm}
                onChange={e => setRadiusKm(Number(e.target.value))}
                className="h-9 px-2 rounded-xl border border-slate-300"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
              <label className="text-xs text-slate-600">Mese calendario</label>
              <input
                type="month"
                value={monthISO}
                onChange={e => setMonthISO(e.currentTarget.value)}
                className="h-9 px-2 rounded-xl border border-slate-300"
              />
            </div>
          </section>

          {/* Tipologie multi-select persistente */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
            <div className="text-sm font-semibold">Tipologie</div>
            <button
              onClick={() => setTypesOpen(v => !v)}
              className="h-9 px-3 rounded-xl border bg-slate-50 hover:bg-slate-100 text-sm"
            >
              {types.map(t => LABELS[t]).join(', ') || 'Seleziona…'}
            </button>
            {typesOpen && (
              <div className="p-3 border rounded-xl space-y-2">
                {ALL_TYPES.map(t => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={typesTemp.includes(t)}
                      onChange={e => {
                        if (e.currentTarget.checked) setTypesTemp([...typesTemp, t]);
                        else setTypesTemp(typesTemp.filter(x => x !== t));
                      }}
                    />
                    {LABELS[t]}
                  </label>
                ))}
                <div className="flex gap-2 pt-2">
                  <button
                    className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs"
                    onClick={() => { setTypes(typesTemp); setTypesOpen(false); }}
                  >Applica</button>
                  <button
                    className="h-8 px-3 rounded-lg bg-slate-200 text-xs"
                    onClick={() => { setTypesTemp(types); setTypesOpen(false); }}
                  >Annulla</button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-500">Persistono finché non premi “Applica”. Default: Hotel.</p>
          </section>

          {/* Modalità a pulsanti + nota */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
            <div className="text-sm font-semibold">Modalità</div>
            <div className="flex gap-2">
              <button
                className={`h-9 px-3 rounded-xl text-sm border ${mode==='zone'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                onClick={() => setMode('zone')}
              >Zona</button>
              <button
                className={`h-9 px-3 rounded-xl text-sm border ${mode==='competitor'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                onClick={() => setMode('competitor')}
              >Competitor</button>
            </div>
            <div className="text-[11px] text-slate-500 leading-snug">
              <div><b>Zona</b>: baseline della domanda dell’area.</div>
              <div><b>Competitor</b>: stessa curva ma ADR più “aggressivo”.</div>
            </div>
          </section>

          {/* Selettori API */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
            <div className="text-sm font-semibold">Selettori API (risparmio quota)</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wantTrend} onChange={e=>setWantTrend(e.currentTarget.checked)} />
              Andamento domanda (Trends)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wantCh} onChange={e=>setWantCh(e.currentTarget.checked)} />
              Canali di vendita
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wantProv} onChange={e=>setWantProv(e.currentTarget.checked)} />
              Provenienza clienti
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={wantLos} onChange={e=>setWantLos(e.currentTarget.checked)} />
              Durata soggiorno (LOS)
            </label>
          </section>

          {/* Avanzate: periodo personalizzato (solo grafici) */}
          <details className="bg-white rounded-2xl border shadow-sm p-4" open={false}>
            <summary className="cursor-pointer text-sm font-semibold">Avanzate: periodo personalizzato (solo grafici)</summary>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rangeEnabled} onChange={e=>setRangeEnabled(e.currentTarget.checked)} />
                Abilita intervallo
              </label>
              {rangeEnabled && (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-xs text-slate-600">Da</span>
                    <input type="date" className="h-9 rounded-xl border px-2 text-sm"
                      value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-xs text-slate-600">A</span>
                    <input type="date" className="h-9 rounded-xl border px-2 text-sm"
                      value={rangeTo} onChange={e=>setRangeTo(e.target.value)} />
                  </div>
                  <p className="text-[11px] text-slate-500">Il calendario resta mensile; i grafici sotto useranno questo intervallo.</p>
                </div>
              )}
            </div>
          </details>

          {/* CTA */}
          <div className="flex gap-2">
            <button
              onClick={fetchSerp}
              disabled={disabledGenerate}
              className={`flex-1 h-11 rounded-2xl text-white text-sm font-semibold ${disabledGenerate?'bg-slate-300':'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {loading ? 'Elaboro…' : 'Genera Analisi'}
            </button>
            <button onClick={resetAll} className="h-11 px-4 rounded-2xl text-sm border bg-white">
              Reset
            </button>
          </div>

          {/* Grafici segmenti */}
          {(wantCh || wantProv || wantLos) && (
            <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
              <div className="text-sm font-semibold">Segmenti (euristici)</div>
              <div className="grid md:grid-cols-3 gap-4">
                {wantCh && (
                  <div>
                    <div className="text-xs font-semibold mb-1">Canali di vendita</div>
                    {!related?.channels?.length ? (
                      <div className="h-40 grid place-items-center text-sm text-slate-500">N/D</div>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={related.channels}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis allowDecimals={false} />
                            <RTooltip />
                            <Bar dataKey="value" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
                {wantProv && (
                  <div>
                    <div className="text-xs font-semibold mb-1">Provenienza clienti</div>
                    {!related?.provenance?.length ? (
                      <div className="h-40 grid place-items-center text-sm text-slate-500">N/D</div>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={related.provenance}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis allowDecimals={false} />
                            <RTooltip />
                            <Bar dataKey="value" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
                {wantLos && (
                  <div>
                    <div className="text-xs font-semibold mb-1">Durata soggiorno (LOS)</div>
                    {!related?.los?.length ? (
                      <div className="h-40 grid place-items-center text-sm text-slate-500">N/D</div>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={related.los}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" />
                            <YAxis allowDecimals={false} />
                            <RTooltip />
                            <Bar dataKey="value" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Dati indicativi da Google Trends (related). Usa i toggle per risparmiare quota.</p>
            </section>
          )}
        </aside>
      </main>

      <footer className="py-6 text-center text-[11px] text-slate-500">
        Domanda da Google Trends via SerpAPI — layout classico ripristinato.
      </footer>
    </div>
  );
}