export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

/* -------------------- Helpers a livello file -------------------- */

// Rileva il booking engine da HTML / href
function detectEngine(hay: string) {
  const patterns: Array<[string, RegExp]> = [
    ["synxis", /synxis|reservations\.travelclick|be\.synxis|book\.synxis/i],
    ["d-edge", /d-edge|securesuite|secured-forms/i],
    ["quovai", /(be\.)?quovai\.com/i],
    ["simplebooking", /simplebooking|book\.simplebooking/i],
    ["verticalbooking", /verticalbooking|book\.verticalbooking/i],
    ["bookassist", /bookassist|bookings\.bookassist/i],
    ["blastness", /blastness|bb.*blastness/i],
    ["ericsoft", /ericsoft|bookingengine\.ericsoft/i],
    ["passepartout", /passepartout|welcomeasy|book\.welcomeasy/i],
    ["omnibees", /omnibees|book\.omnibees/i],
    ["generic", /booking-?engine|bookingengine/i],
  ];
  const h = hay || "";
  for (const [vendor, re] of patterns) if (re.test(h)) return vendor;
  return null;
}

async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = 7000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal, redirect: "follow", cache: "no-store" });
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function absolutize(href: string, base: string) {
  try { return new URL(href, base).toString(); } catch { return href; }
}
async function getHtmlOrThrow(inputUrl: string) {
  const normalized = /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`;
  const u = new URL(normalized);
  const candidates = new Set<string>([
    u.toString(),
    `https://www.${u.host.replace(/^www\./, "")}${u.pathname || ""}`,
    u.protocol === "https:" ? u.toString().replace(/^https:/, "http:") : u.toString().replace(/^http:/, "https:"),
    `http://www.${u.host.replace(/^www\./, "")}${u.pathname || ""}`,
  ]);

  const HEADERS_A = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  const HEADERS_B = {
    "User-Agent": "HotelTradeAudit/1.0 (+https://hoteltrade.it)",
    "Accept-Language": "it,en;q=0.8",
    Accept: "text/html,*/*;q=0.8",
  };

  let lastError: any = null;
  for (const candidate of candidates) {
    for (const H of [HEADERS_A, HEADERS_B]) {
      try {
        const res = await fetch(candidate, {
          headers: H,
          redirect: "follow",
          cache: "no-store",
        });
        const text = await res.text();
        if (res.status >= 200 && res.status < 400 && (text || "").length > 200) {
          return { html: text, baseUrl: res.url || candidate };
        }
        lastError = `HTTP ${res.status}`;
      } catch (e: any) {
        lastError = e?.message || String(e);
      }
    }
  }
  throw new Error(lastError || "Fetch blocked");
}

/* -------------------- Route -------------------- */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("url")?.trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

    const { html, baseUrl } = await getHtmlOrThrow(raw);
    const $ = cheerio.load(html);

    const lang = $("html").attr("lang") || undefined;
    const hreflangs = $("link[rel='alternate'][hreflang]")
      .map((_, el) => String($(el).attr("hreflang") || "").toLowerCase())
      .get();

    // 1) Rilevamento engine su homepage
    const links = $("a[href]").map((_, el) => String($(el).attr("href") || "")).get();
    let engine = detectEngine((html || "") + "\n" + links.join("\n"));

    // 2) Se non trovato: “secondo salto” su bottone Prenota (stesso dominio)
    if (!engine) {
      const cand = $("a[href]").filter((_, el) => {
        const txt = ($(el).text() || "").toLowerCase();
        const href = String($(el).attr("href") || "").toLowerCase();
        return /\bprenot|book|reserv/.test(txt) || /(booking|reserve|prenota)/.test(href);
      }).first();

      const href = cand.attr("href");
      if (href) {
        const abs = absolutize(href, baseUrl);
        let sameOrigin = false;
        try { sameOrigin = new URL(abs).origin === new URL(baseUrl).origin; } catch {}
        if (sameOrigin) {
          try {
            const childHtml = await fetchWithTimeout(abs, {
              headers: {
                "User-Agent": "HotelTradeAudit/1.0 (+https://hoteltrade.it)",
                "Accept-Language": "it,en;q=0.8",
              }
            }, 7000);

            const childVendor = detectEngine(childHtml);
            if (childVendor) engine = childVendor;
            else if (/quovai/i.test(childHtml)) engine = "quovai"; // euristica debole
          } catch {
            // ignora timeout/errori
          }
        }
      }
    }

    // 3) JSON-LD: nome e amenities
    const jsonld = $('script[type="application/ld+json"]').map((_, el) => $(el).contents().text()).get();
    let hotelName: string | undefined;
    const amenities = new Set<string>();
    for (const block of jsonld) {
      try {
        const obj = JSON.parse(block);
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const j of arr) {
          const t = j?.["@type"];
          if (t === "Hotel" || t === "LodgingBusiness" || t === "Organization") {
            if (!hotelName && j?.name) hotelName = String(j.name);
            if (Array.isArray(j?.amenityFeature)) {
              for (const a of j.amenityFeature) {
                const label = a?.name || a?.amenityType;
                if (label) amenities.add(String(label));
              }
            }
          }
        }
      } catch {}
    }

    // 4) Footer plain text (per fallback address nel recon)
    const footerText = ($("footer").text() || "").toString();

    // 5) Risposta
    return NextResponse.json({
  ok: true,
  signals: {
    engine: engine ? { engine: "booking-engine", vendor: engine } : null,
    hotelName,
    amenities: Array.from(amenities),
    languages: Array.from(new Set([lang, ...hreflangs].filter(Boolean))),
  },
  jsonld,
  footerText,
}, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
