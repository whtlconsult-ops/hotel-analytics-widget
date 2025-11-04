export const runtime = "nodejs";
import { NextResponse } from "next/server";

type HistoryItem = { role: "user" | "assistant"; content: string };

function clampHistory(h: HistoryItem[], maxPairs = 3): HistoryItem[] {
  const filtered = (Array.isArray(h) ? h : []).filter(x => x && x.role && typeof x.content === "string");
  return filtered.slice(-maxPairs*2);
}

async function fetchLookup(q: string, loc?: string) {
  try {
    const u = `/api/reputation/lookup?q=${encodeURIComponent(q)}${loc ? `&loc=${encodeURIComponent(loc)}` : ""}`;
    const r = await fetch(u, { cache: "no-store" });
    const j = await r.json();
    if (j?.ok) return j;
  } catch {}
  return null;
}

// very light intent detector
function detectReputationIntent(text: string) {
  const t = (text || "").toLowerCase();
  const kw = ["reputation", "reputazione", "brand", "brand reputation", "rating", "punteggio", "recensioni", "posizionamento"];
  const hit = kw.some(k => t.includes(k));
  if (!hit) return null;
  let name = "";
  const m1 = t.match(/si chiama\s*[:\-]?\s*["“”]?([^"\n,]+)["“”]?/i);
  if (m1) name = m1[1].trim();
  if (!name) {
    const m2 = t.match(/struttura\s+([^,\.]+?)(?:\s+di\s+|,|\.)/i);
    if (m2) name = m2[1].trim();
  }
  let loc = "";
  const m3 = t.match(/\b(di|a)\s+([a-zàèéìòù\s']{2,})\b/i);
  if (m3) loc = m3[2].trim();
  return { name: name || text, loc };
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "OPENAI_API_KEY mancante" }, { status: 500 });

    const body = await req.json().catch(()=> ({}));
    const question: string = (body?.question || body?.q || body?.prompt || "").toString();
    const context: string = (body?.context || "").toString();
    const history: HistoryItem[] = Array.isArray(body?.history) ? body.history : [];
    if (!question) return NextResponse.json({ ok: false, error: "Manca 'question'." }, { status: 400 });

    const hist = clampHistory(history, 3);

    // ----- enrichment se l'intent è reputazione -----
    let lookup: any = null;
    const intent = detectReputationIntent(question);
    if (intent) lookup = await fetchLookup(intent.name, intent.loc);

    const system = [
      "Se ti fornisco dati strutturati (JSON) su rating/recensioni, usali per rispondere con numeri e cita la fonte.",
      "Se i dati sono in modalità demo, dichiaralo con [demo] e suggerisci prossimi passi concisi.",
      "Non chiedere dati già disponibili. Sii operativo e sintetico.",
      "Apri con un verdetto (Reputation solida/buona/critica) quando hai indice o rating."
    ].join(" ");

    const evidence = lookup ? `\n\n[DatiReputation]\n${JSON.stringify(lookup)}\n[/DatiReputation]\n` : "";

    const messages = [
      { role: "system", content: system },
      ...hist,
      { role: "user", content: `${question}${context ? `\n\n[Contesto]\n${context}\n[/Contesto]` : ""}${evidence}` }
    ];

    const payload = {
      model: "gpt-4o-mini", // sostituisci con il tuo modello
      temperature: 0.2,
      messages
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || "Non sono riuscito a generare una risposta utile.";

    return NextResponse.json({
      ok: true,
      text,
      used: { lookupMode: lookup?.meta?.mode || (lookup ? "live" : "none"), sources: Object.keys(lookup?.sources || {}) },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
