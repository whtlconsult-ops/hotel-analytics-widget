export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Rileva il booking engine dalla homepage (HTML + href)
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
  for (const [vendor, re] of patterns) {
    if (re.test(h)) return vendor;
  }
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

// GET /api/competitors/inspect?url=https://www.esempiohotel.it
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const loc = (searchParams.get("loc") || "").trim();
    if (!loc) return NextResponse.json({ ok: false, error: "Missing loc" }, { status: 400 });

    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const items: any[] = [];

    // 1) Prova SERPAPI Google Maps
    if (apiKey) {
      const p = new URLSearchParams({
        engine: "google_maps", type: "search",
        q: `lodging near ${loc}`, hl: "it", api_key: apiKey,
      });
      const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
      const res = Array.isArray(j?.local_results) ? j.local_results : [];
      for (const r of res.slice(0, 10)) {
        items.push({
          name: r?.title || "",
          address: r?.address,
          rating: r?.rating ? Number(r.rating) : undefined,
          category: r?.type || r?.place_type,
          distanceKm: r?.distance_meters ? Number(r.distance_meters) / 1000 : undefined,
        });
      }
    }

    // 2) Fallback Nominatim (OSM) se SERP vuoto / non disponibile
    if (items.length === 0) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent("hotel " + loc)}&limit=10&addressdetails=1`;
      const r = await fetch(url, { headers: { "User-Agent": "HotelTradeAudit/1.0" }, cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j)) {
        for (const row of j) {
          const nm = String(row?.display_name || "");
          const name = nm.split(",")[0] || "Struttura ricettiva";
          const addr = row?.address ? [
            row.address.road, row.address.house_number,
            row.address.postcode,
            row.address.city || row.address.town || row.address.village,
            row.address.state
          ].filter(Boolean).join(", ") : nm;
          items.push({
            name,
            address: addr,
            rating: undefined,
            category: row?.type || row?.class || "lodging",
            distanceKm: undefined,
          });
        }
      }
    }

    // 3) Seed finale se ancora vuoto
    if (items.length === 0) {
      const demo = [
        { name:"Hotel Centrale", address:`${loc}`, rating:8.6, category:"Hotel" },
        { name:"Residenza Duomo", address:`${loc}`, rating:8.9, category:"B&B" },
        { name:"Agriturismo Le Colline", address:`${loc}`, rating:9.1, category:"Agriturismo" },
        { name:"Albergo Riviera", address:`${loc}`, rating:8.0, category:"Hotel" },
      ];
      return NextResponse.json({ ok: true, items: demo }, { status: 200 });
    }

    return NextResponse.json({ ok: true, items: items.slice(0, 8) }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// booking engine detection
const links = $("a[href]").map((_, el) => String($(el).attr("href") || "")).get();
const engineVendor = detectEngine((html || "") + "\n" + links.join("\n"));
let engine = engineVendor;
const baseUrl = r.url || url;

if (!engine) {
  // 1) Trova un link "Prenota / Book / Reserve"
  const cand = $("a[href]").filter((_, el) => {
    const txt = ($(el).text() || "").toLowerCase();
    const href = String($(el).attr("href") || "").toLowerCase();
    return /\bprenot|book|reserv/.test(txt) || /(booking|reserve|prenota)/.test(href);
  }).first();

  const href = cand.attr("href");
  if (href) {
    const abs = absolutize(href, baseUrl);
    // 2) Se è stesso dominio, scarica UNA pagina e cerca segnali
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

        // 2a) Rileva engine da HTML della pagina di prenotazione
        const childVendor = detectEngine(childHtml);
        if (childVendor) {
          engine = childVendor;
        } else if (/quovai/i.test(childHtml)) {
          // 2b) Heuristic debole: stringa "quovai" nel markup
          engine = "quovai";
        }
      } catch {
        // ignora errori di fetch/timeout
      }
    }
  }
}

    // schema.org
    const jsonld = $('script[type="application/ld+json"]').map((_, el) => $(el).contents().text()).get();
    const footerText = ($("footer").text() || "").toString();
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
