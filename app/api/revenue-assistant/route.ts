export const runtime = "nodejs";

import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
Sei "RevenueAssistant", un assistente AI per hotel, resort, agriturismi e case vacanza.
Parli in italiano.
Rispondi in modo operativo, sintetico, con punti elenco.
Se mancano dati (periodo, occupancy, ADR storico, pick-up, canale, roomtype) lo dici SUBITO e proponi la lista dati da farti dare.
Chiudi SEMPRE con: "Prossimo passo operativo: …".
`.trim();

// conoscenza locale, personalizzabile
const HOTEL_KNOWLEDGE = {
  pricing: [
    "Mai fare sconti a pioggia: partire dal BAR e agire per segmento.",
    "Se il pick-up è basso a 30-45 giorni, apri promo solo OTA, mantieni diretto con valore.",
    "Se le OTA vendono più del diretto, alza le OTA di 5€ e dai benefit sul sito.",
  ],
  distribution: [
    "Booking / Expedia ok ma con allotment minimo in bassa domanda.",
    "Per agriturismi conta molto Google Business Profile e canali tematici.",
  ],
  staff: [
    "Pre-stay 48h con upgrade e info arrivo.",
    "Formare reception a proporre late check-out e upsell camera.",
  ],
};

export async function POST(req: Request) {
  try {
    const { message, topic, context: extraContext, previous = [] } = await req.json();

    const safeMsg = String(message || "").slice(0, 4000);

    const extraRules =
      topic === "revenue"
        ? HOTEL_KNOWLEDGE.pricing.join(" • ")
        : topic === "marketing"
        ? HOTEL_KNOWLEDGE.distribution.join(" • ")
        : topic === "operations"
        ? HOTEL_KNOWLEDGE.staff.join(" • ")
        : "";

    const userMsg = `
Utente chiede (${topic || "generico"}):
${safeMsg}

Regole interne consulente:
${extraRules || "— nessuna regola specifica —"}

Contesto dal widget:
${extraContext || "— nessun contesto disponibile —"}
`.trim();

    // costruiamo la chat completa
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // turni precedenti (dal client)
    if (Array.isArray(previous)) {
      for (const turn of previous) {
        if (!turn) continue;
        if (turn.role === "user" || turn.role === "assistant") {
          messages.push({
            role: turn.role,
            content: String(turn.content || ""),
          });
        }
      }
    }

    // ultimo messaggio
    messages.push({ role: "user", content: userMsg });

    // chiamata al modello
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_API_KEY mancante",
        },
        { status: 500 }
      );
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.4,
        max_tokens: 900,
      }),
    });

    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: "Errore modello: " + r.status + " " + err,
        },
        { status: 500 }
      );
    }

    const j = await r.json();
    const content =
      j?.choices?.[0]?.message?.content ||
      "Non sono riuscito a generare una risposta coerente.";

    return NextResponse.json(
      {
        ok: true,
        answer: content,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
