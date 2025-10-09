export const runtime = "nodejs";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// GET /api/competitors/inspect?url=https://www.esempiohotel.it
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("url")?.trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

    const url = raw.match(/^https?:\/\//i) ? raw : `https://${raw}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "HotelTradeAudit/1.0 (+https://hoteltrade.it)",
        "Accept-Language": "it,en;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
    });
    const html = await r.text();
    const $ = cheerio.load(html);

    const lang = $("html").attr("lang") || undefined;
    const hreflangs = $("link[rel='alternate'][hreflang]")
      .map((_, el) => String($(el).attr("hreflang") || "").toLowerCase())
      .get();

    // booking engine detection
    const links = $("a[href]").map((_, el) => String($(el).attr("href") || "")).get();
    function detectEngine(hay: string) {
      const patterns: Array<[string, RegExp]> = [
        ["synxis", /synxis|reservations\.travelclick|be\.synxis|book\.synxis/i],
        ["d-edge", /d-edge|securesuite|secured-forms/i],
        ["simplebooking", /simplebooking|book\.simplebooking/i],
        ["verticalbooking", /verticalbooking|book\.verticalbooking/i],
        ["bookassist", /bookassist|bookings\.bookassist/i],
        ["blastness", /blastness|bb.*blastness/i],
        ["ericsoft", /ericsoft|bookingengine\.ericsoft/i],
        ["passepartout", /passepartout|welcomeasy|book\.welcomeasy/i],
        ["omnibees", /omnibees|book\.omnibees/i],
      ];
      for (const [vendor, re] of patterns) if (re.test(hay)) return vendor;
      return null;
    }
    const engineVendor = detectEngine(html + "\n" + links.join("\n"));

    // schema.org
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

    return NextResponse.json({
      ok: true,
      signals: {
        engine: engineVendor ? { engine: "booking-engine", vendor: engineVendor } : null,
        hotelName,
        amenities: Array.from(amenities),
        languages: Array.from(new Set([lang, ...hreflangs].filter(Boolean))),
      }
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
