export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// GET /api/competitors/inspect?url=https://www.esempiohotel.it
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("url")?.trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

    // normalizza URL
    const url = raw.match(/^https?:\/\//i) ? raw : `https://${raw}`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "HotelTradeAudit/1.0 (+https://hoteltrade.it)",
        "Accept-Language": "it,en;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    });
    const finalUrl = r.url;
    const html = await r.text();
    const signals = extractSignals(html, finalUrl);

    return NextResponse.json({ ok: true, url: finalUrl, signals }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

function extractSignals(html: string, finalUrl: string) {
  const $ = cheerio.load(html);

  // meta base
  const lang = $("html").attr("lang") || undefined;
  const hreflangs = $("link[rel='alternate'][hreflang]")
    .map((_, el) => String($(el).attr("hreflang") || "").toLowerCase())
    .get();

  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content") || "";

  // links
  const links = $("a[href]").map((_, el) => String($(el).attr("href") || "")).get();

  // analytics / pixel
  const ga4 = (html.match(/G-[A-Z0-9]{6,}/) || [])[0];
  const gtm = (html.match(/GTM-[A-Z0-9]+/) || [])[0];
  const fbPixel = (html.match(/fbq\(['"]init['"],\s*['"](\d+)['"]\)/) || [])[1];

  // booking engine detection (html o href)
  const engine = detectEngine(html, links);

  // schema.org
  const jsonldBlocks = $('script[type="application/ld+json"]').map((_, el) => $(el).contents().text()).get();
  const schemaTypes = new Set<string>();
  let hotelName: string | undefined;
  const amenities = new Set<string>();

  for (const block of jsonldBlocks) {
    try {
      const obj = JSON.parse(block);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const j of arr) {
        const t = j?.["@type"];
        if (t) schemaTypes.add(String(t));
        if (!hotelName && (t === "Hotel" || t === "LodgingBusiness" || t === "Organization")) {
          hotelName = j?.name || hotelName;
          if (Array.isArray(j?.amenityFeature)) {
            for (const a of j.amenityFeature) {
              const name = a?.name || a?.amenityType;
              if (name) amenities.add(String(name));
            }
          }
        }
      }
    } catch {}
  }

  return {
    lang,
    hreflangs,
    title,
    metaDesc,
    analytics: { ga4: !!ga4 ? ga4 : undefined, gtm: !!gtm ? gtm : undefined, fbPixel: !!fbPixel ? fbPixel : undefined },
    engine, // { engine: 'booking-engine' | null, vendor: string|null, hints: string|null }
    schemaTypes: Array.from(schemaTypes),
    hotelName,
    amenities: Array.from(amenities),
    detectedLanguages: Array.from(new Set([lang, ...hreflangs].filter(Boolean))),
    finalUrl,
  };
}

function detectEngine(html: string, links: string[]) {
  const patterns: Array<[vendor: string, re: RegExp]> = [
    ["synxis", /synxis|reservations\.travelclick|be\.synxis|book\.synxis/i],
    ["d-edge", /d-edge|securesuite|secured-forms/i],
    ["simplebooking", /simplebooking|book\.simplebooking/i],
    ["verticalbooking", /verticalbooking|book\.verticalbooking/i],
    ["bookassist", /bookassist|bookings\.bookassist/i],
    ["blastness", /blastness|bb.*blastness/i],
    ["ericsoft", /ericsoft|bookingengine\.ericsoft/i],
    ["passepartout", /passepartout|welcomeasy|book\.welcomeasy/i],
    ["omnibees", /omnibees|book\.omnibees/i],
    ["generic", /booking-?engine|bookingengine/i],
  ];
  const hay = (html || "") + "\n" + (links || []).join("\n");
  for (const [vendor, re] of patterns) {
    if (re.test(hay)) return { engine: "booking-engine", vendor, hints: vendor };
  }
  return { engine: null, vendor: null, hints: null };
}
