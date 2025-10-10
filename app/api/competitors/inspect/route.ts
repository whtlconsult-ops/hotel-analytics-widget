export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

/* -------------------- Helpers (a livello file) -------------------- */

// 1) Rileva il booking engine da HTML / href / src / action
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
  for (let i = 0; i < patterns.length; i++) {
    const [vendor, re] = patterns[i];
    if (re.test(h)) return vendor;
  }
  return null;
}

// 2) Fetch con timeout
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

// 3) URL assoluto
function absolutize(href: string, base: string) {
  try { return new URL(href, base).toString(); } catch { return href; }
}

// 4) Fetch robusta con più varianti (https/http, con/senza www) e UA “browser”
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
  const candList = Array.from(candidates);
  const headersList = [HEADERS_A, HEADERS_B];

  for (let i = 0; i < candList.length; i++) {
    const candidate = candList[i];
    for (let j = 0; j < headersList.length; j++) {
      const H = headersList[j];
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

// 5) OpenGraph (nome sito / title)
function parseOpenGraph($: any) {
  const siteName = $('meta[property="og:site_name"]').attr("content") || undefined;
  const titleOg  = $('meta[property="og:title"]').attr("content") || undefined;
  return { siteName, titleOg };
}

// 6) Microdata schema.org (Hotel/LodgingBusiness/Organization)
function parseMicrodata($: any) {
  let name: string | undefined;
  let address: string | undefined;
  $('[itemscope][itemtype*="schema.org"]').each((_: any, el: any) => {
    const t = String($(el).attr("itemtype") || "");
    if (/Hotel|LodgingBusiness|Organization/i.test(t)) {
      if (!name) {
        const n = $(el).find('[itemprop="name"]').first().text().trim();
        if (n) name = n;
      }
      if (!address) {
        const a = $(el).find('[itemprop="address"]').first();
        if (a.length) {
          const parts = [
            a.find('[itemprop="streetAddress"]').text(),
            a.find('[itemprop="postalCode"]').text(),
            a.find('[itemprop="addressLocality"]').text(),
            a.find('[itemprop="addressRegion"]').text(),
            a.find('[itemprop="addressCountry"]').text(),
          ]
            .map((s) => String(s || "").trim())
            .filter(Boolean);
          if (parts.length) address = parts.join(", ");
        }
      }
    }
  });
  return { name, address };
}

/* -------------------- Route -------------------- */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("url") || "").trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

    // Homepage (robusta)
    const { html, baseUrl } = await getHtmlOrThrow(raw);
    const $ = cheerio.load(html);

    // Lingue
    const lang = $("html").attr("lang") || undefined;
    const hreflangs = $("link[rel='alternate'][hreflang]")
      .map((_: any, el: any) => String($(el).attr("hreflang") || "").toLowerCase())
      .get();

    // Arricchitori OG/Microdata
    const og = parseOpenGraph($);
    const md = parseMicrodata($);

    // Rilevamento engine su homepage (HTML + href/src/action)
    const links  = $("a[href]").map((_: any, el: any) => String($(el).attr("href") || "")).get();
    const scripts= $("script[src]").map((_: any, el: any) => String($(el).attr("src") || "")).get();
    const ifr    = $("iframe[src]").map((_: any, el: any) => String($(el).attr("src") || "")).get();
    const forms  = $("form[action]").map((_: any, el: any) => String($(el).attr("action") || "")).get();
    let engine = detectEngine(
      (html || "") + "\n" +
      links.join("\n") + "\n" +
      scripts.join("\n") + "\n" +
      ifr.join("\n") + "\n" +
      forms.join("\n")
    );

    // “Secondo salto” sul bottone Prenota (se stesso dominio)
    if (!engine) {
      const cand = $("a[href]").filter((_: any, el: any) => {
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
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
                "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
              },
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

    // JSON-LD: nome e amenities
    const jsonld = $('script[type="application/ld+json"]').map((_: any, el: any) => $(el).contents().text()).get();
    let hotelName: string | undefined;
    const amenities = new Set<string>();
    for (let i = 0; i < jsonld.length; i++) {
      const block = jsonld[i];
      try {
        const obj = JSON.parse(block);
        const arr = Array.isArray(obj) ? obj : [obj];
        for (let k = 0; k < arr.length; k++) {
          const j = arr[k];
          const t = j?.["@type"];
          if (t === "Hotel" || t === "LodgingBusiness" || t === "Organization") {
            if (!hotelName && j?.name) hotelName = String(j.name);
            if (Array.isArray(j?.amenityFeature)) {
              for (let z = 0; z < j.amenityFeature.length; z++) {
                const a = j.amenityFeature[z];
                const label = a?.name || a?.amenityType;
                if (label) amenities.add(String(label));
              }
            }
          }
        }
      } catch {}
    }

    // Se il nome non è emerso dal JSON-LD, fallback a Microdata/OG/Title
    if (!hotelName) {
      const titleTxt = String($("title").text() || "").trim() || undefined;
      hotelName = md.name || og.siteName || og.titleOg || titleTxt;
    }

    // Footer text (per fallback address nel recon)
    const footerText = String(($("footer").text() || ""));

    // Address da microdata o pagine secondarie (contatti/where-we-are…)
    let microAddress: string | undefined = md.address;
    if (!microAddress) {
      const more = ["/contatti", "/contact", "/dove-siamo", "/where-we-are", "/privacy"];
      for (let i = 0; i < more.length; i++) {
        const href = absolutize(more[i], baseUrl);
        try {
          const child = await fetchWithTimeout(
            href,
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
                "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
              },
            },
            6000
          );
          const $$ = cheerio.load(child);
          const txt = String($$.text() || "").replace(/\s+/g, " ").trim();
          const m =
            txt.match(/\b\d{4,5}\b\s+[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+(?:,\s*[A-Z]{2})?(?:,\s*Italia)?/i) ||
            txt.match(/[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+,\s*[A-Z]{2}(?:,\s*Italia)?/i);
          if (m && m[0]) { microAddress = m[0].trim(); break; }
        } catch {}
      }
    }

    // Risposta JSON
    return NextResponse.json(
      {
        ok: true,
        signals: {
          engine: engine ? { engine: "booking-engine", vendor: engine } : null,
          hotelName,
          amenities: Array.from(amenities),
          languages: Array.from(new Set([lang, ...hreflangs].filter(Boolean))),
        },
        jsonld,
        footerText,
        microAddress,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
