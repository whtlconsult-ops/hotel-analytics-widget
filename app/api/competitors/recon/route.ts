// app/api/competitors/recon/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { seasonalityItaly12, normalizeTo100 } from "../../../../lib/baseline";

/* -------------------- Helpers -------------------- */
const serpFetch = (u: string) =>
  fetch(u, { cache: "force-cache", next: { revalidate: 21600 } })
    .then(r => r.json())
    .catch(() => ({} as any));

function classifyCity(city: string) {
  const s = (city || "").toLowerCase();
  const urban = ["roma","rome","milano","milan","firenze","florence","venezia","venice","napoli","naples","bologna","torino","turin","verona","genova","pisa","siena"];
  const sea = ["rimini","riccione","viareggio","taormina","alghero","cagliari","olbia","gallipoli","sorrento","positano","ostuni"];
  const mountain = ["madonna di campiglio","cortina","cortina d'ampezzo","bormio","livigno","ortisei","selva","val gardena","canazei","alpe di siusi","brunico","folgarida","courmayeur"];
  if (urban.some(x => s.includes(x))) return "urban";
  if (sea.some(x => s.includes(x))) return "sea";
  if (mountain.some(x => s.includes(x))) return "mountain";
  return "generic";
}

function estimateADR(loc: string, rating?: number) {
  const baseSeason = normalizeTo100(seasonalityItaly12()); // 12 valori 0..100
  const ctx = classifyCity(loc);
  let k = 1.0;
  if (rating != null) {
    // 7.0 → 0.9  |  9.5 → 1.25
    k *= 0.9 + Math.max(0, Math.min(1, (rating - 7) / 2.5)) * 0.35;
  }
  if (ctx === "sea") k *= 1.05;
  if (ctx === "mountain") k *= 1.08;
  const level = 110; // € medio indicativo
  return baseSeason.map(v => Math.round(level * (v / 100) * k));
}

/* -------------------- ROUTE -------------------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    const loc = (searchParams.get("loc") || "").trim();
    const site = (searchParams.get("site") || "").trim();

    if (!name && !loc && !site) {
      return NextResponse.json({ ok: false, error: "Missing name/loc/site" }, { status: 400 });
    }

    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const geoKey = process.env.GEOAPIFY_KEY;
    const notes: string[] = [];

    const profile: any = { name: name || undefined };

    /* A) Google Maps lookup (SerpAPI) */
    if (apiKey && (name || loc)) {
      try {
        const p = new URLSearchParams({
          engine: "google_maps",
          type: "search",
          q: [name, loc].filter(Boolean).join(" "),
          hl: "it",
          api_key: apiKey,
        });
        const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
        const res = Array.isArray(j?.local_results) ? j.local_results : [];
        if (res.length > 0) {
          const best = res[0];
          profile.name = best?.title || profile.name;
          profile.address = best?.address || profile.address;
          profile.category = best?.type || best?.place_type || profile.category;
          profile.rating = Number(best?.rating) || profile.rating;
          profile.reviews = Number(best?.reviews || best?.user_ratings_total) || profile.reviews;
          if (best?.gps_coordinates?.latitude && best?.gps_coordinates?.longitude) {
            profile.coords = {
              lat: Number(best.gps_coordinates.latitude),
              lng: Number(best.gps_coordinates.longitude),
            };
          }
          const snippets = [best?.description, best?.snippet].filter(Boolean).join(" · ").toLowerCase();
          const amz = ["spa", "piscina", "parcheggio", "pet", "colazione", "ristorante", "palestra", "navetta", "vista", "centro"];
          profile.amenities = amz.filter(a => snippets.includes(a));
        } else {
          notes.push("Maps: nessun risultato preciso.");
        }
      } catch {
        notes.push("Maps: errore richiesta.");
      }
    } else {
      notes.push("SerpAPI non disponibile: profilo ridotto.");
    }

    /* B) Fallback coords via Geoapify (se mancano) */
    try {
      if ((!profile.coords || !profile.coords.lat || !profile.coords.lng) && (geoKey && (name || loc))) {
        const q = [name, loc].filter(Boolean).join(" ").trim();
        const u = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&type=amenity&filter=category.accommodation&limit=1&apiKey=${encodeURIComponent(geoKey)}`;
        const r = await fetch(u, { cache: "force-cache", next: { revalidate: 21600 } });
        const j = await r.json();
        if (Array.isArray(j?.features) && j.features[0]?.properties) {
          const p = j.features[0].properties;
          const lat = Number(p.lat), lng = Number(p.lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            profile.coords = { lat, lng };
            profile.address = profile.address || p.formatted || p.address_line1 || profile.address;
            notes.push("Coordinate ottenute da Geoapify (fallback).");
          }
        }
      } else if (!geoKey) {
        notes.push("Geoapify non configurato (GEOAPIFY_KEY mancante).");
      }
    } catch {
      notes.push("Geoapify errore.");
    }

    /* C) Arricchimento dal sito ufficiale (inspect) */
    if (site) {
      try {
        const base = new URL(req.url);
        const origin = `${base.protocol}//${base.host}`;
        const inspectUrl = `${origin}/api/competitors/inspect?site=${encodeURIComponent(site)}`;
        const r = await fetch(inspectUrl, { cache: "no-store" });
        const insp = await r.json();

        if (insp?.ok) {
          // booking engine rilevato?
          if (Array.isArray(insp.engines) && insp.engines.length) {
            profile.channels = Array.from(new Set([...(profile.channels || []), "Diretto"]));
            notes.push(`Booking engine rilevato (${insp.engines.join(", ")}).`);
          }
          // JSON-LD: prova a ricostruire l'indirizzo
          if (!profile.address && Array.isArray(insp.jsonld)) {
            for (const raw of insp.jsonld) {
              try {
                const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
                const arr = Array.isArray(obj) ? obj : [obj];
                for (const j of arr) {
                  const t = j?.["@type"];
                  if (t === "Hotel" || t === "LodgingBusiness" || t === "Organization") {
                    const a = j?.address;
                    if (a && (a.streetAddress || a.addressLocality)) {
                      const parts = [
                        a.streetAddress,
                        a.postalCode,
                        a.addressLocality,
                        a.addressRegion,
                        a.addressCountry,
                      ].filter(Boolean).join(", ");
                      if (parts) { profile.address = parts; break; }
                    }
                  }
                }
                if (profile.address) break;
              } catch { /* ignore json parse */ }
            }
          }
          // footer testo come fallback address
          if (!profile.address && typeof insp.footerText === "string" && insp.footerText.trim().length) {
            const t = insp.footerText.replace(/\s+/g, " ").trim();
            const m =
              t.match(/\b\d{4,5}\b\s+[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+(?:,\s*[A-Z]{2})?(?:,\s*Italia)?/i) ||
              t.match(/[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+,\s*[A-Z]{2}(?:,\s*Italia)?/i);
            if (m && m[0]) profile.address = m[0].trim();
          }
        } else {
          notes.push(`Inspect sito: ${typeof insp?.error === "string" ? insp.error : "non raggiungibile"}.`);
        }
      } catch (e: any) {
        notes.push(`Inspect sito: ${String(e?.message || e)}`);
      }
    }

    /* D) ADR reale via Amadeus (se coords presenti), altrimenti stima */
    let adrMonthly: number[] = estimateADR(loc || profile.address || "", profile.rating);

    try {
      if (profile?.coords?.lat != null && profile?.coords?.lng != null) {
        const base = new URL(req.url);
        const origin = `${base.protocol}//${base.host}`;
        const year = Number(base.searchParams.get("year")) || new Date().getFullYear();

        const u = new URL("/api/rates/monthly", origin);
        u.searchParams.set("lat", String(profile.coords.lat));
        u.searchParams.set("lng", String(profile.coords.lng));
        u.searchParams.set("year", String(year));

        const rr = await fetch(u.toString(), { cache: "no-store" });
        const jj = await rr.json();
        if (jj?.ok && Array.isArray(jj.monthly) && jj.monthly.length === 12) {
          adrMonthly = (jj.monthly as any[]).map(v => (Number.isFinite(Number(v)) ? Number(v) : 0));
          notes.push("ADR reale da Amadeus (mediana, 2 campioni/mese).");
        } else {
          notes.push("ADR Amadeus non disponibile → usata stima.");
        }
      } else {
        notes.push("ADR: mancano coordinate → usata stima.");
      }
    } catch {
      notes.push("ADR Amadeus errore → usata stima.");
    }

    /* Risposta */
    return NextResponse.json(
      { ok: true, profile, adrMonthly, notes: notes.length ? notes : undefined },
      { status: 200 }
    );

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
