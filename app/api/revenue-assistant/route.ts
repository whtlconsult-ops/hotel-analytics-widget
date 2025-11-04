export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type HistoryItem = { role: "user" | "assistant"; content: string };

// --- Ping GET (diagnostica rapida) ---
export async function GET() {
  return NextResponse.json({ ok: true, ping: "revenue-assistant: alive" });
}

// --- Helpers ---
function clampHistory(h: HistoryItem[], maxPairs = 3): HistoryItem[] {
  const filtered = (Array.isArray(h) ? h : []).filter(
    (x) => x && x.role && typeof x.content === "string"
  );
  return filtered.slice(-maxPairs * 2);
}

function originFromReq(req: Request): string {
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

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

// intent leggero: reputazione/posizionamento/concorrenza
function detectReputationIntent(text: string) {
  const t = (text || "").toLowerCase();
  const kw = [
    "reputazione",
    "brand reputation",
    "rating",
    "punteggio",
    "recensioni",
    "posizionamento",
    "concorrenza",
    "competitor",
  ];
  const hit = kw.some((k) => t.includes(k));
  if (!hit) return null;

  let name = "";
  let loc = "";

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

function firstNonEmpty(...vals: Array<any>) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

// ---- OpenAI calls ----
async function callChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1200,
      messages,
    }),
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
  messages: Array<{ role: string; content: string }>
) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: messages,
      temperature: 0.2,
      max_output_tokens: 1200,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `responses HTTP ${r.status}`);

  const t1 = typeof j?.output_text === "string" ? j.output_text : "";
  const t2 = Array.isArray(j?.output)
    ? j.output
        .map((p: any) => {
          if (typeof p?.text === "string") return p.text;
          if (Array.isArray(p?.content)) {
            return p.content
              .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
              .join("\n");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n\n")
    : "";
  return firstNonEmpty(t1, t2);
}

async function callOpenAIwithFallbacks(
  apiKey: string,
  models: string[],
  messages: Array<{ role: string; content: string }>
) {
  let lastErr = "";
  for (const m of models) {
    try {
      return await callChat(apiKey, m, messages);
    } catch (e: any) {
      lastErr = `chat ${m}: ${e?.message || e}`;
    }
    try {
      return await callResponses(apiKey, m, messages);
    } catch (e: any) {
      lastErr = `responses ${m}: ${e?.message || e}`;
    }
  }
  throw new Error(lastErr || "Nessuna via utile verso OpenAI");
}

// --- Route principale ---
export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: true, text: "Modalità demo: manca OPENAI_API_KEY.", used: { modelTried: [] } },
      );
    }

    const preferred = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const candidates = [preferred, "gpt-4.1", "gpt-4o-mini", "gpt-4o"];

    const body = await req.json().catch(() => ({}));
    const question: string = (body?.question || body?.q || body?.prompt || "").toString();
    const context: string = (body?.context || "").toString();
    const history: HistoryItem[] = Array.isArray(body?.history) ? body.history : [];
    if (!question) {
      const text = "Dimmi cosa vuoi sapere (es. 'Brand reputation di <struttura> a <località>').";
      return NextResponse.json({ ok: true, text, message: text, answer: text });
    }

    const hist = clampHistory(history, 3);
    const origin = originFromReq(req);

    // enrichment reputazione quando serve
    let lookup: any = null;
    const intent = detectReputationIntent(question);
    if (intent) lookup = await lookupReputation(origin, intent.name, intent.loc);

    const system = [
      "Se ti fornisco dati strutturati (JSON) su rating/recensioni, usali per rispondere con numeri e cita la fonte.",
      "Se i dati sono in modalità demo, dichiaralo con [demo] e suggerisci prossimi passi concisi.",
      "Non chiedere dati già disponibili. Sii operativo e sintetico.",
      "Apri con un verdetto (Reputation solida/buona/critica) quando hai indice o rating.",
      "Se non ci sono dati, fornisci comunque consigli pratici e una checklist breve (no rimandi generici)."
    ].join(" ");

    const evidence = lookup
      ? `\n\n[DatiReputation]\n${JSON.stringify(lookup)}\n[/DatiReputation]\n`
      : "";

    const messages = [
      { role: "system", content: system },
      ...hist,
      {
        role: "user",
        content: `${question}${context ? `\n\n[Contesto]\n${context}\n[/Contesto]` : ""}${evidence}`,
      },
    ];

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
        "- Se disponibile userò Google/Hotels; altrimenti ti fornirò uno schema di azione (risposte alle review, UGC, SEO locale, OTA mix)."
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
        modelTried: candidates,
      },
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
      used: { lookupMode: "none", sources: [], modelTried: [] },
    });
  }
}
