export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

type HistoryItem = { role: "user" | "assistant"; content: string };

function clampHistory(h: HistoryItem[], maxPairs = 3): HistoryItem[] {
  const filtered = (Array.isArray(h) ? h : []).filter(
    (x) => x && x.role && typeof x.content === "string"
  );
  return filtered.slice(-maxPairs * 2);
}

function getOrigin(req: Request): string {
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

// intent leggero per reputation/posizionamento/concorrenza
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
  // es. 'si chiama: "Borgo Dolci Colline"' oppure 'struttura Borgo Dolci Colline'
  const m1 = t.match(/si chiama\s*[:\-]?\s*["“”]?([^"\n,]+)["“”]?/i);
  if (m1) name = m1[1].trim();
  if (!name) {
    const m2 = t.match(/struttura\s+([^,\.]+?)(?:\s+di\s+|,|\.)/i);
    if (m2) name = m2[1].trim();
  }
  // cattura località grossolana: 'di/a <località>'
  let loc = "";
  const m3 = t.match(/\b(di|a)\s+([a-zàèéìòù\s'\-]{2,})\b/i);
  if (m3) loc = m3[2].trim();

  return { name: name || text, loc };
}

async function callOpenAI_ChatCompletions(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    throw new Error(`OpenAI chat/completions: ${msg}`);
  }
  return j?.choices?.[0]?.message?.content || "";
}

async function callOpenAI_Responses(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  // Il Responses API accetta "input" anche come array di messaggi (vedi guida di migrazione). :contentReference[oaicite:1]{index=1}
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
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    throw new Error(`OpenAI responses: ${msg}`);
  }
  // preferisci output_text se presente, altrimenti ricomponi
  if (typeof j?.output_text === "string" && j.output_text.trim()) {
    return j.output_text;
  }
  if (Array.isArray(j?.output)) {
    const parts = j.output
      .map((p: any) => {
        if (p?.content && Array.isArray(p.content)) {
          return p.content
            .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
            .join("\n");
        }
        if (typeof p?.text === "string") return p.text;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("\n\n");
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY mancante" },
        { status: 500 }
      );

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // consigliato nel 2025 :contentReference[oaicite:2]{index=2}

    const body = await req.json().catch(() => ({}));
    const question: string = (body?.question || body?.q || body?.prompt || "").toString();
    const context: string = (body?.context || "").toString();
    const history: HistoryItem[] = Array.isArray(body?.history) ? body.history : [];
    if (!question)
      return NextResponse.json({ ok: false, error: "Manca 'question'." }, { status: 400 });

    const hist = clampHistory(history, 3);
    const origin = getOrigin(req);

    // enrichment reputazione solo quando rilevante
    let lookup: any = null;
    const intent = detectReputationIntent(question);
    if (intent) lookup = await lookupReputation(origin, intent.name, intent.loc);

    const system = [
      "Se ti fornisco dati strutturati (JSON) su rating/recensioni, usali per rispondere con numeri e cita la fonte.",
      "Se i dati sono in modalità demo, dichiaralo con [demo] e suggerisci prossimi passi concisi.",
      "Non chiedere dati già disponibili. Sii operativo e sintetico.",
      "Apri con un verdetto (Reputation solida/buona/critica) quando hai indice o rating.",
      "Quando il tema è concorrenza/posizionamento senza dati, fornisci comunque un'analisi operativa basata su prassi del settore (benchmark, canali, ADR/LOS tipici) senza inventare numeri specifici."
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

    // 1° tentativo: Chat Completions
    let text = "";
    try {
      text = await callOpenAI_ChatCompletions(apiKey, model, messages);
    } catch (e) {
      // 2° tentativo: Responses API (moderno)
      text = await callOpenAI_Responses(apiKey, model, messages);
    }
    if (!text || !text.trim()) {
      text = "Non ho ricevuto un contenuto utile dal modello. Prova a ripetere la richiesta o a specificare di più.";
    }

    return NextResponse.json({
      ok: true,
      text,
      used: {
        lookupMode: lookup?.meta?.mode || (lookup ? "live" : "none"),
        sources: Object.keys(lookup?.sources || {}),
        model,
      },
    });
  } catch (e: any) {
    // Esponi l'errore in chiaro per evitare il “Nessuna risposta utile”
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
