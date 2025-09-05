export default function App(){
  const [notices, setNotices] = useState<string[]>([]);
  const [mode, setMode] = useState<"zone"|"competitor">("zone");
  const [query, setQuery] = useState("Castiglion Fiorentino");
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState("2025-08-01");
  const [types, setTypes] = useState<string[]>(["agriturismo","b&b","hotel"]);

  const [dataSource, setDataSource] = useState<"none"|"csv"|"gsheet">("none");
  const [csvUrl, setCsvUrl] = useState("");
  const [gsId, setGsId] = useState("");
  const [gsSheet, setGsSheet] = useState("Sheet1");
  const [gsGid, setGsGid] = useState("");
  const [strictSheet, setStrictSheet] = useState(true);

  const [rawRows, setRawRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // === NUOVO: stati APPLICATI (si aggiornano solo cliccando "Genera Analisi")
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO);
  const [aTypes, setATypes] = useState<string[]>(types);
  const [aMode, setAMode] = useState<"zone"|"competitor">(mode);

  // C'è differenza tra bozza (UI) e applicato (analisi)?
  const hasChanges = useMemo(() => (
    aQuery !== query ||
    aRadius !== radius ||
    aMonthISO !== monthISO ||
    aMode !== mode ||
    aTypes.join(",") !== types.join(",")
  ), [aQuery, query, aRadius, radius, aMonthISO, monthISO, aMode, mode, aTypes, types]);

  // === Validazione: stats/issue
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [dataIssues, setDataIssues] = useState<ValidationIssue[]>([]);
  const [showIssueDetails, setShowIssueDetails] = useState(false);

  // Normalizzazione — ORA usa gli *applicati*
  const normalized: Normalized = useMemo(()=>{
    const warnings: string[] = [];
    const center = geocode(aQuery, warnings);
    const safeR = safeRadius(aRadius, warnings);
    const safeT = safeTypes(aTypes, warnings);
    if(!center){
      return { warnings, safeMonthISO: "", safeDays: [], center: null, safeR, safeT, isBlocked: true };
    }
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings);
    const safeDays = safeDaysOfMonth(safeMonthISO, warnings);
    return { warnings, safeMonthISO, safeDays, center, safeR, safeT, isBlocked: false };
  }, [aMonthISO, aQuery, aRadius, aTypes]);

  const warningsKey = useMemo(()=> normalized.warnings.join("|"), [normalized.warnings]);
  useEffect(()=>{ setNotices(prev => (prev.join("|") === warningsKey ? prev : normalized.warnings)); }, [warningsKey, normalized.warnings]);

  // URL builder (rigida vs non rigida)
  function buildGSheetsCsvUrl(sheetId: string, sheetName: string, gid: string, strict: boolean){
    const id = (sheetId||"").trim();
    if(!id) return { url: "", error: "" };

    if(strict){
      if(!gid || !gid.trim()){
        return { url: "", error: "Modalità rigida attiva: inserisci il GID del foglio (#gid=...)."};
      }
      return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid.trim())}`, error: "" };
    }

    const name = encodeURIComponent(sheetName||"Sheet1");
    return { url: `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${name}`, error: "" };
  }

  async function fetchCsv(url: string, signal?: AbortSignal): Promise<string>{
    const res = await fetch(url, { signal });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  // Caricamento dati (CSV / Google Sheet)
  useEffect(()=>{
    setLoadError(null);
    setRawRows([]);
    setDataStats(null);
    setDataIssues([]);
    if(dataSource === "none") return;

    const warnings: string[] = [];
    const controller = new AbortController();
    const run = async ()=>{
      try{
        setLoading(true);

        let url = "";
        if(dataSource === "csv"){
          url = csvUrl.trim();
        } else {
          const built = buildGSheetsCsvUrl(gsId, gsSheet, gsGid, strictSheet);
          if(built.error){
            setLoadError(built.error);
            setNotices(prev=> Array.from(new Set([...prev, built.error])));
            return;
          }
          url = built.url;
          if(!strictSheet){
            const w = "Modalità non rigida: Google potrebbe ignorare il nome foglio e restituire il primo foglio. Per selezione certa usa il GID.";
            setNotices(prev=> Array.from(new Set([...prev, w])));
          }
        }
        if(!url){ setLoadError("Sorgente dati mancante: specifica URL CSV o Google Sheet"); return; }

        const text = await fetchCsv(url, controller.signal);
        const parsed = parseCsv(text);
        const { valid, issues, stats } = normalizeRowsWithValidation(parsed, warnings);
        setRawRows(valid);
        setDataStats(stats);
        setDataIssues(issues);
        if(warnings.length>0) setNotices(prev=> Array.from(new Set([...prev, ...warnings])));
      }catch(e:any){
        setLoadError(String(e?.message || e));
      }finally{
        setLoading(false);
      }
    };
    run();
    return ()=> controller.abort();
  }, [dataSource, csvUrl, gsId, gsSheet, gsGid, strictSheet]);

  // Mese scelto (da applicati)
  const monthDate = useMemo(()=> {
    if(normalized.isBlocked || !normalized.safeMonthISO) return new Date();
    try { return parseISO(normalized.safeMonthISO); } catch { return new Date(); }
  }, [normalized.safeMonthISO, normalized.isBlocked]);

  // Dati calendario + ADR medio competitor — usa aMode
  const calendarData = useMemo(()=> {
    if(normalized.isBlocked) return [];
    if(rawRows.length>0){
      const byDate = new Map<string, {date: Date; adrVals:number[]; pressVals:number[]}>();
      for(const d of normalized.safeDays){
        byDate.set(d.toDateString(), { date: d, adrVals: [], pressVals: [] });
      }
      rawRows.forEach(r=>{
        if(!r.date) return;
        const key = r.date.toDateString();
        const slot = byDate.get(key);
        if(slot){
          if(Number.isFinite(r.adr)) slot.adrVals.push(r.adr);
          const press = Number.isFinite(r.occ) ? (60 + r.occ) : (Number.isFinite(r.adr) ? 60 + r.adr/2 : 60);
          slot.pressVals.push(press);
        }
      });
      return Array.from(byDate.values()).map(v=> ({
        date: v.date,
        pressure: v.pressVals.length? Math.round(v.pressVals.reduce((a,b)=>a+b,0)/v.pressVals.length) : pressureFor(v.date),
        adr: v.adrVals.length? Math.round(v.adrVals.reduce((a,b)=>a+b,0)/v.adrVals.length) : adrFromCompetitors(v.date, aMode)
      }));
    }
    return normalized.safeDays.map(d=>({ date:d, pressure: pressureFor(d), adr: adrFromCompetitors(d, aMode) }));
  }, [normalized.safeDays, normalized.isBlocked, aMode, rawRows]);

  // Grafici: Provenienza / LOS / Canali
  const provenance = useMemo(()=> rawRows.length>0 ? (
    Object.entries(rawRows.reduce((acc:Record<string,number>, r)=> { const k=r.provenance||"Altro"; acc[k]=(acc[k]||0)+1; return acc; }, {}))
      .map(([name,value])=>({name,value}))
  ) : [
    { name:"Italia", value: 42 },
    { name:"Germania", value: 22 },
    { name:"Francia", value: 14 },
    { name:"USA", value: 10 },
    { name:"UK", value: 12 },
  ], [rawRows]);

  const los = useMemo(()=> rawRows.length>0 ? (()=> {
    const buckets: Record<string, number> = {"1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0};
    rawRows.forEach(r=>{
      const v = Number.isFinite(r.los)? r.los : 0;
      if(v<=1) buckets["1 notte"]++;
      else if(v<=3) buckets["2-3 notti"]++;
      else if(v<=6) buckets["4-6 notti"]++;
      else buckets["7+ notti"]++;
    });
    return Object.entries(buckets).map(([bucket,value])=>({bucket, value}));
  })() : [
    { bucket:"1 notte", value: 15 },
    { bucket:"2-3 notti", value: 46 },
    { bucket:"4-6 notti", value: 29 },
    { bucket:"7+ notti", value: 10 },
  ], [rawRows]);

  const channels = useMemo(() => (
    rawRows.length > 0
      ? Object
          .entries(
            rawRows.reduce((acc: Record<string, number>, r) => {
              const k = r.channel || "Altro";
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {})
          )
          .map(([channel, value]) => ({ channel, value }))
      : [
          { channel: "Booking", value: 36 },
          { channel: "Airbnb", value: 26 },
          { channel: "Diretto", value: 22 },
          { channel: "Expedia", value: 11 },
          { channel: "Altro", value: 5 },
        ]
  ), [rawRows]);

  const demand = useMemo(()=> (
    normalized.isBlocked ? [] : (rawRows.length>0
      ? calendarData.map(d=> ({ date: format(d.date, "d MMM", {locale:it}), value: d.pressure }))
      : normalized.safeDays.map(d=> ({ date: format(d, "d MMM", {locale:it}), value: pressureFor(d) + rand(-10,10) }))
    )
  ), [normalized.safeDays, normalized.isBlocked, calendarData, rawRows]);

  /* =========== UI =========== */

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Widget Analisi Domanda – Hospitality</h1>
            <p className="text-sm text-slate-600">UI pulita: layout arioso, controlli chiari, grafici leggibili.</p>
          </div>
          <button
            className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            onClick={()=> location.reload()}
            title="Reset"
          >
            <span className="inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/> Reset</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* SIDEBAR CONTROLLI */}
        <aside className="space-y-6">
          {/* Sorgente dati */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="text-sm font-semibold">Sorgente Dati</div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-sm text-slate-700">Tipo</label>
              <select className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-full" value={dataSource} onChange={(e)=> setDataSource(e.target.value as any)}>
                <option value="none">Nessuna (demo)</option>
                <option value="csv">CSV URL</option>
                <option value="gsheet">Google Sheet</option>
              </select>
            </div>

            {dataSource === "csv" && (
              <div className="flex items-center gap-2">
                <label className="w-28 text-sm text-slate-700">CSV URL</label>
                <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={csvUrl} onChange={e=> setCsvUrl(e.target.value)} placeholder="https://.../out:csv&sheet=Foglio1" />
              </div>
            )}

            {dataSource === "gsheet" && (
              <>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet ID</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsId} onChange={e=> setGsId(e.target.value)} placeholder="1AbC…" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Nome foglio</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsSheet} onChange={e=> setGsSheet(e.target.value)} placeholder="Foglio1 / Sheet1" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet GID</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsGid} onChange={e=> setGsGid(e.target.value)} placeholder="es. 0 (#gid=...)" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Modalità</label>
                  <div className="flex items-center gap-2">
                    <input id="strict" type="checkbox" checked={strictSheet} onChange={(e)=> setStrictSheet(e.currentTarget.checked)} />
                    <label htmlFor="strict" className="text-sm">Rigida (consigliata)</label>
                  </div>
                </div>
              </>
            )}

            {loading && <div className="text-xs text-slate-600">Caricamento dati…</div>}
            {loadError && <div className="text-xs text-rose-600">Errore sorgente: {loadError}</div>}
            {rawRows.length>0 && <div className="text-xs text-emerald-700">Dati caricati: {rawRows.length} righe</div>}
          </section>

          {/* Località / Raggio / Mese / Tipologie */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Località</label>
              <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Città o indirizzo"/>
            </div>
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Raggio</label>
              <select className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-40" value={String(radius)} onChange={(e)=> setRadius(parseInt(e.target.value))}>
                {RADIUS_OPTIONS.map(r=> <option key={r} value={r}>{r} km</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Mese</label>
              <input type="month" value={normalized.safeMonthISO ? normalized.safeMonthISO.slice(0,7) : ""} onChange={e=> setMonthISO(`${e.target.value||""}-01`)} className="w-48 h-9 rounded-xl border border-slate-300 px-2 text-sm"/>
            </div>

            {/* Tipologie: una per riga */}
            <div className="flex items-start gap-3">
              <label className="w-28 mt-1 text-sm text-slate-700">Tipologie</label>
              <div className="flex-1 space-y-2">
                {STRUCTURE_TYPES.map(t => (
                  <label
                    key={t}
                    className="flex items-center gap-3 text-sm border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      className="h-4 w-4"
                      type="checkbox"
                      checked={types.includes(t)}
                      onChange={(ev) => {
                        const c = ev.currentTarget.checked;
                        setTypes(prev => c ? Array.from(new Set([...prev, t])) : prev.filter(x => x !== t));
                      }}
                    />
                    <span className="font-medium">{typeLabels[t]}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Modalità + Pulsante su riga propria */}
            <div className="grid grid-cols-1 gap-3 mt-2">
              <div className="flex items-center gap-3">
                <label className="w-28 text-sm text-slate-700">Modalità</label>
                <div className="inline-flex rounded-xl border overflow-hidden">
                  <button className={`px-3 py-1 text-sm ${mode==="zone"?"bg-slate-900 text-white":"bg-white text-slate-900"}`} onClick={()=> setMode("zone")}>Zona</button>
                  <button className={`px-3 py-1 text-sm ${mode==="competitor"?"bg-slate-900 text-white":"bg-white text-slate-900"}`} onClick={()=> setMode("competitor")}>Competitor</button>
                </div>
              </div>
              <div>
                <button
                  className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-slate-900 text-white border-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={normalized.isBlocked || !hasChanges}
                  title={
                    normalized.isBlocked
                      ? "Inserisci la località per procedere"
                      : (hasChanges ? "Applica i filtri" : "Nessuna modifica da applicare")
                  }
                  onClick={() => {
                    setAQuery(query);
                    setARadius(radius);
                    setAMonthISO(monthISO);
                    setATypes(types);
                    setAMode(mode);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2"/>
                  {hasChanges ? "Genera Analisi" : "Aggiornato"}
                </button>
              </div>
            </div>
          </section>

          {/* Avvisi */}
          {notices.length>0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-900">Avvisi</div>
              <ul className="list-disc ml-5 text-sm text-amber-900">
                {notices.map((n,i)=> <li key={i}>{n}</li>)}
              </ul>
            </section>
          )}

          {/* Qualità dati (NUOVA CARD) */}
          {dataStats && (
            <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
              <div className="text-sm font-semibold">Qualità dati (Google Sheet)</div>

              <div className="text-xs text-slate-600">
                Totale righe: <b>{dataStats.total}</b> ·{" "}
                Valide: <b className="text-emerald-700">{dataStats.valid}</b> ·{" "}
                Scartate: <b className={dataStats.discarded ? "text-rose-700" : "text-slate-700"}>{dataStats.discarded}</b>
              </div>

              {Object.keys(dataStats.issuesByField).length>0 && (
                <div className="text-xs">
                  <div className="font-medium mb-1">Problemi rilevati (per campo)</div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(dataStats.issuesByField).map(([field,count])=> (
                      <li key={field} className="flex justify-between">
                        <span className="text-slate-600">{field}</span>
                        <span className="font-semibold">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {dataIssues.length>0 && (
                <div>
                  <button
                    type="button"
                    className="text-xs underline text-slate-700"
                    onClick={()=> setShowIssueDetails(s=>!s)}
                  >
                    {showIssueDetails ? "Nascondi dettagli" : "Mostra esempi (prime 10 righe problematiche)"}
                  </button>

                  {showIssueDetails && (
                    <div className="mt-2 max-h-40 overflow-auto rounded-lg border bg-slate-50 p-2">
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="text-left px-1">riga</th>
                            <th className="text-left px-1">campo</th>
                            <th className="text-left px-1">motivo</th>
                            <th className="text-left px-1">valore</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataIssues.slice(0,10).map((iss, i)=> (
                            <tr key={i} className="border-t">
                              <td className="px-1">{iss.row}</td>
                              <td className="px-1">{iss.field}</td>
                              <td className="px-1">{iss.reason}</td>
                              <td className="px-1 truncate">{iss.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </aside>

        {/* MAIN */}
        <main className="space-y-6">
          {/* MAPPA – riga intera */}
          <div className="bg-white rounded-2xl border shadow-sm p-0">
            <div className="h-72 md:h-[400px] lg:h-[480px] overflow-hidden rounded-2xl">
              {normalized.center ? (
                <LocationMap
                  center={[normalized.center.lat, normalized.center.lng]}
                  radius={normalized.safeR*1000}
                  label={aQuery || "Località"}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">
                  Inserisci una località valida per visualizzare la mappa e generare l'analisi
                </div>
              )}
            </div>
          </div>

          {/* CALENDARIO – riga intera */}
          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <div className="text-lg font-semibold mb-3">
              Calendario Domanda + ADR – {format(monthDate, "LLLL yyyy", { locale: it })}
            </div>
            {normalized.isBlocked ? (
              <div className="text-sm text-slate-500">
                Nessuna analisi disponibile: inserisci una località valida.
              </div>
            ) : (
              <CalendarHeatmap monthDate={monthDate} data={calendarData} />
            )}
          </div>

          {/* Grafici — riga 1: 2 card larghe */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Provenienza (Pie) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
              {Array.isArray(provenance) && provenance.length>0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <PieChart margin={{ bottom: 24 }}>
                    <Pie
                      data={provenance}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={THEME.chart.pie.innerRadius}
                      outerRadius={THEME.chart.pie.outerRadius}
                      paddingAngle={THEME.chart.pie.paddingAngle}
                      cornerRadius={THEME.chart.pie.cornerRadius}
                      labelLine={false}
                      label={({ percent }) => `${Math.round((percent || 0) * 100)}%`}
                    >
                      {provenance.map((_, i) => (
                        <Cell
                          key={i}
                          fill={solidColor(i)}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <RTooltip
                      formatter={(val: any, name: any, props: any) => {
                        const total = (provenance || []).reduce((a, b) => a + (b.value as number), 0);
                        const pct = total ? Math.round((props?.value / total) * 100) : 0;
                        return [`${props?.value} (${pct}%)`, name];
                      }}
                    />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ color: "#111827", fontWeight: 500 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-slate-500">Nessun dato</div>}
            </div>

            {/* LOS (Bar) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
              {Array.isArray(los) && los.length>0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={los} margin={THEME.chart.bar.margin}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{fontSize: THEME.chart.bar.tickSize}} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value">
                      {los.map((_,i)=> (
                        <Cell key={i} fill={THEME.palette.barBlue[i % THEME.palette.barBlue.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-slate-500">Nessun dato</div>}
            </div>
          </div>

          {/* Canali di Vendita — riga intera */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {Array.isArray(channels) && channels.length>0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={channels} margin={THEME.chart.barWide.margin}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" interval={0} tick={{fontSize: THEME.chart.barWide.tickSize}} height={36} />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value">
                    {channels.map((_,i)=> (
                      <Cell key={i} fill={THEME.palette.barOrange[i % THEME.palette.barOrange.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="text-xs text-slate-500">Nessun dato</div>}
          </div>

          {/* Curva domanda (Line) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Andamento Domanda – {format(monthDate, "LLLL yyyy", {locale: it})}</div>
            {normalized.isBlocked ? (
              <div className="text-sm text-slate-500">In attesa di località valida…</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={demand}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{fontSize: 12}} interval={3}/>
                  <YAxis />
                  <RTooltip />
                  <Line type="monotone" dataKey="value" stroke={THEME.chart.line.stroke} strokeWidth={THEME.chart.line.strokeWidth} dot={{r:THEME.chart.line.dotRadius}} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
