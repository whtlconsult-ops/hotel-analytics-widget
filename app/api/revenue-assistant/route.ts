export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type RAUserRole = "user" | "assistant";
type HistoryItem = { role: RAUserRole; content: string };

// --- Ping diagnostico (GET) ---
export async function GET() {
  return NextResponse.json({ ok: true, ping: "revenue-assistant: alive" });
}

// ---------- Helpers ----------
function clampHistory(h: HistoryItem[], maxPairs = 3): HistoryItem[] {
  const filtered = (Array.isArray(h) ? h : []).filter(
    (x) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string"
  );
  return filtered.slice(-maxPairs * 2);
}
function originFromReq(req: Request): string {
  try { return new URL(req.url).origin; } catch { return ""; }
}
function firstNonEmpty(...vals: Array<any>) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}
function pick(...vals: any[]) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

// Intent reputazione/concorrenza (leggero)
function detectReputationIntent(text: string) {
  const t = (text || "").toLowerCase();
  const kw = ["reputazione","brand reputation","rating","punteggio","recensioni","posizionamento","concorrenza","competitor"];
  const hit = kw.some(k => t.includes(k));
  if (!hit) return null;

  let name = "";
  let loc  = "";

  const m1 = t.match(/si chiama\s*[:\-]?\s*["“”]?([^"\n,]+)["“”]?/i);
  if (m1) name = m1[1].trim();
  if (!name) {
    const m2 = t.match(/struttura\s+([^,\.]+?)(?:\s+di\s+|,|\.)/i);
    if (m2) name = m2[1].trim();
  }
  const m3 = t.match(/\b(?:di|a)\s+([a-zàèéìòù\s'\-]{2,})\b/i);
  if (m3) loc = m3[1].trim();

  return { name: name || text, loc };
}

// Intent "indagine concorrenza"
function detectCompetitorsIntent(text: string) {
  const t = (text || "").toLowerCase();

  const hasComp =
    t.includes("concorrenza") ||
    t.includes("competitor") ||
    t.includes("indagine") ||
    t.includes("marketing") ||
    t.includes("raggio") ||
    t.includes("prezzi") ||
    t.includes("servizi");

  if (!hasComp) return null;

  // categoria
  let category = "agriturismo";
  if (t.includes("hotel")) category = "hotel";
  if (t.includes("agritur")) category = "agriturismo";
  if (t.includes("residence")) category = "residence";
  if (t.includes("b&b") || t.includes("bb")) category = "bed and breakfast";

  // raggio
  let radius_km = 30;
  const mR = t.match(/(\d{1,2})\s*km/);
  if (mR) radius_km = Math.min(60, Math.max(1, parseInt(mR[1],10)));

  // place/località (grezzo ma efficace: dopo 'a ' o 'di ' prendiamo una frase significativa)
  let place = "";
  const mP = t.match(/\b(?:a|di|in|zona)\s+([a-zàèéìòù'\-\s]{3,})(?:\.|,|$)/i);
  if (mP) place = mP[1].trim();

  return { category, radius_km, place };
}

// Lookup reputazione (API interna) con URL assoluto
async function lookupReputation(origin: string, q: string, loc?: string) {
  if (!origin) return null;
  const u = new URL("/api/reputation/lookup", origin);
  u.searchParams.set("q", q);
  if (loc) u.searchParams.set("loc", loc);
  try {
    const r = await fetch(u.toString(), { cache: "no-store" });
    const j = await r.json();
    if (j?.ok) return j;
  } catch {}
  return null;
}

// ---------- OpenAI ----------
type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

async function callChat(
  apiKey: string,
  model: string,
  messages: ChatMsg[]
): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1200, messages })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `chat/completions HTTP ${r.status}`);
  return firstNonEmpty(
    j?.choices?.[0]?.message?.content,
    j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  );
}

async function callResponses(
  apiKey: string,
  model: string,
  messages: ChatMsg[]
): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: messages, temperature: 0.2, max_output_tokens: 1200 })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `responses HTTP ${r.status}`);

  const t1 = typeof j?.output_text === "string" ? j.output_text : "";
  const t2 = Array.isArray(j?.output)
    ? j.output.map((p: any) => {
        if (typeof p?.text === "string") return p.text;
        if (Array.isArray(p?.content)) {
          return p.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n");
        }
        return "";
      }).filter(Boolean).join("\n\n")
    : "";
  return firstNonEmpty(t1, t2);
}

async function callOpenAIwithFallbacks(
  apiKey: string,
  models: string[],
  messages: ChatMsg[]
): Promise<string> {
  let lastErr = "";
  for (const m of models) {
    try { return await callChat(apiKey, m, messages); }
    catch (e: any) { lastErr = `chat ${m}: ${e?.message || e}`; }
    try { return await callResponses(apiKey, m, messages); }
    catch (e: any) { lastErr = `responses ${m}: ${e?.message || e}`; }
  }
  throw new Error(lastErr || "Nessuna via utile verso OpenAI");
}

// ---------- Route principale ----------
export async function POST(req: Request) {
  try {
    const preferred = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const candidates = [preferred, "gpt-4.1", "gpt-4o-mini", "gpt-4o"];
    const apiKey = process.env.OPENAI_API_KEY;

    // Body + querystring: accetta molti alias
    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch {}

    const question: string = pick(
      body.question, body.q, body.prompt, body.text, body.input, body.message,
      url.searchParams.get("question"), url.searchParams.get("q"), url.searchParams.get("text")
    );
    const context: string = pick(body.context, url.searchParams.get("context"));

    // history: supporta anche 'previous' (vecchio client)
    const rawHist = Array.isArray(body?.history)
      ? body.history
      : Array.isArray(body?.previous)
      ? body.previous
      : [];

    const history: HistoryItem[] = (rawHist as any[])
      .map((t: any): HistoryItem => ({
        role: (t?.role === "assistant" ? "assistant" : "user") as RAUserRole,
        content: String(t?.content ?? t?.text ?? t?.message ?? "")
      }))
      .filter((t) => !!t.content);

    if (!question) {
      const text = "Dimmi cosa vuoi sapere (es. 'Brand reputation di <struttura> a <località>').";
      return NextResponse.json({ ok: true, text, message: text, answer: text });
    }

    const hist = clampHistory(history, 3);
    const origin = originFromReq(req);

    // Enrichment reputazione se pertinente
    let lookup: any = null;
    const intent = detectReputationIntent(question);
    if (intent) lookup = await lookupReputation(origin, intent.name, intent.loc);

    // Enrichment competitors (indagine marketing)
    let competitors: any = null;
    const comp = detectCompetitorsIntent(question);
    if (comp) {
      const u = new URL("/api/competitors/nearby", origin);
      if (comp.place) u.searchParams.set("place", comp.place);
      u.searchParams.set("category", comp.category);
      u.searchParams.set("radius_km", String(comp.radius_km));
      const rComp = await fetch(u.toString(), { cache: "no-store" });
      try { const j = await rComp.json(); if (j?.ok) competitors = j; } catch {}
    }

   // System prompt — persona “Revy”
const systemText =
  "Ti chiami Revy. Sei un consulente alberghiero empatico e concreto. " +
  "Dai risposte chiare, pratiche e amichevoli, come parleresti a un cliente. " +
  "Se ricevi JSON con dati (reputation o competitors), apri con una fotografia della situazione (1-2 righe), " +
  "poi fornisci una tabella leggibile e, sotto, 3-5 insight pratici. " +
  "Se i dati sono [demo], dichiaralo sempre. " +
  "Quando fornisci numeri, non chiedere altri dati se non indispensabili. " +
  "Chiudi con una breve to-do list. " +
  "Evita frasi generiche tipo 'vai a cercare'; proponi micro-azioni operative.";
    if (lookup) blocks.push(`[DatiReputation]\n${JSON.stringify(lookup)}\n[/DatiReputation]`);
    if (competitors) blocks.push(`[DatiCompetitors]\n${JSON.stringify(competitors)}\n[/DatiCompetitors]`);
    const evidence = blocks.length ? ("\n\n" + blocks.join("\n\n") + "\n") : "";

    const messages: ChatMsg[] = [
      { role: "system", content: systemText },
      ...hist,
      {
        role: "user",
        content: `${question}${context ? `\n\n[Contesto]\n${context}\n[/Contesto]` : ""}${evidence}`,
      },
    ];

    // Se manca l'API key: risposta demo (mai vuota)
    if (!apiKey) {
      const text =
        "Modalità demo: manca OPENAI_API_KEY. Inserisci la chiave in .env.local e riavvia. " +
        "Intanto ecco una traccia operativa.";
      return NextResponse.json({
        ok: true,
        text,
        message: text,
        answer: text,
        used: { lookupMode: lookup?.meta?.mode || (lookup ? "live" : "none"), sources: Object.keys(lookup?.sources || {}), modelTried: [] }
      });
    }

    // OpenAI con fallback multipli
    let text = "";
    try {
      text = await callOpenAIwithFallbacks(apiKey, candidates, messages);
    } catch (e: any) {
      const msg = String(e?.message || e);
      text = [
        "Modalità demo: non sono riuscito a contattare il modello in questo momento.",
        `Dettagli tecnici: ${msg}`,
        "",
        "Ecco comunque una risposta operativa breve:",
        "- Se cerchi la brand reputation di una struttura, indica *nome + località*.",
        "- Se disponibile userò Google/Hotels; altrimenti suggerisco una checklist (review, UGC, SEO locale, OTA mix)."
      ].join("\n");
    }

    if (!text || !text.trim()) {
      text = "Non ho ricevuto testo utile dal modello. Prova a ripetere la richiesta.";
    }

    return NextResponse.json({
      ok: true,
      text,
      message: text,
      answer: text,
      used: {
        lookupMode: lookup?.meta?.mode || (lookup ? "live" : "none"),
        sources: Object.keys(lookup?.sources || {}),
        modelTried: candidates
      }
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const text = [
      "Modalità demo: errore inatteso nel route.",
      `Dettagli tecnici: ${msg}`,
      "",
      "Prova a ripetere la richiesta o verifica le variabili d'ambiente."
    ].join("\n");
    return NextResponse.json({
      ok: true,
      text,
      message: text,
      answer: text,
      used: { lookupMode: "none", sources: [], modelTried: [] }
    });
  }
}
