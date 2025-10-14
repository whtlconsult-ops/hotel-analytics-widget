export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { seasonalityItaly12, normalizeTo100 } from "../../../../lib/baseline";

// Helpers
const serpFetch = (u: string) =>
  fetch(u, { cache: "force-cache", next: { revalidate: 21600 } })
    .then(r => r.json()).catch(()=> ({} as any));

function classifyCity(city: string) {
  const s = (city||"").toLowerCase();
  const urban = ["roma","rome","milano","milan","firenze","florence","venezia","venice","napoli","naples","bologna","torino","turin","verona","genova","pisa","siena"];
  const sea   = ["rimini","riccione","viareggio","taormina","alghero","cagliari","olbia","gallipoli","sorrento","positano","ostuni"];
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
  if (ctx === "sea")      k *= 1.05;
  if (ctx === "mountain") k *= 1.08;
  // calibro un livello medio (puoi esporlo da UI in futuro)
  const level = 110; // € medio indicativo
  return baseSeason.map(v => Math.round(level * (v/100) * k));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    const loc  = (searchParams.get("loc")  || "").trim();
const site = (searchParams.get("site") || "").trim();
const be   = (searchParams.get("be")   || "").trim(); // NEW
const siteEffective = be || site;                     // NEW
const origin = new URL(req.url).origin;
    if (!name && !site) {
  return NextResponse.json({ ok:false, error:"Missing name or site" }, { status:400 });
}
    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const notes: string[] = [];
    let profile: any = { name };
// 0) Se manca il sito, prova a dedurlo da Nominatim (OSM) e poi usa /inspect
if (!site && (name || loc)) {
  try {
    const q = [name, loc].filter(Boolean).join(" ");
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&extratags=1`;
    const r = await fetch(url, { headers: { "User-Agent": "HotelTradeAudit/1.0" }, cache: "no-store" });
    const j = await r.json();
    if (Array.isArray(j) && j[0]?.extratags) {
      const ex = j[0].extratags;
      const guess =
        ex.website || ex["contact:website"] || ex.url || ex["contact:url"] ||
        j[0].website || j[0]["contact:website"];
      if (guess) {
        // prova inspect
        const inspR = await fetch(`${origin}/api/competitors/inspect?url=${encodeURIComponent(String(guess))}`, { cache: "no-store" });
        const insp = await inspR.json();
        if (insp?.ok) {
          if (insp.signals?.hotelName && !profile.name) profile.name = String(insp.signals.hotelName);
          if (Array.isArray(insp.signals?.amenities) && insp.signals.amenities.length) {
            profile.amenities = Array.from(new Set([...(profile.amenities || []), ...insp.signals.amenities]));
          }
          if (insp.signals?.engine?.vendor) {
            profile.channels = Array.from(new Set([...(profile.channels || []), "Diretto"]));
            notes.push(`Booking engine rilevato (${insp.signals.engine.vendor}).`);
          }
          if (!profile.address) {
            // usa microAddress > JSON-LD > footer
            if (insp.microAddress) profile.address = insp.microAddress;
            else {
              // (se hai già la logica JSON-LD/footer nel blocco site) puoi replicarla qui
            }
          }
        } else {
          notes.push("Nominatim sito: trovato ma non ispezionabile.");
        }
      }
    }
  } catch {
    notes.push("Nominatim: nessun sito riconosciuto.");
  }
}

// Enrichment da sito ufficiale se name mancante
if (!name && site) {
  try {
    const inspR = await fetch(`${origin}/api/competitors/inspect?url=${encodeURIComponent(site)}`, { cache: "no-store" });
    const insp = await inspR.json();
    if (insp?.ok) {
      if (insp.signals?.hotelName) profile.name = insp.signals.hotelName;
      if (Array.isArray(insp.signals?.amenities) && insp.signals.amenities.length) {
        profile.amenities = Array.from(new Set([...(profile.amenities || []), ...insp.signals.amenities]));
      }
      if (insp.signals?.engine?.vendor) {
        profile.channels = Array.from(new Set([...(profile.channels || []), "Diretto"]));
        notes.push(`Booking engine rilevato (${insp.signals.engine.vendor}).`);
      }
    }
  } catch {}
}

    // A) Google Maps lookup (se possibile)
const qStr = `${profile.name || name} ${loc}`.trim();

if (apiKey && qStr) {
  const params = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: qStr,
    hl: "it",
    api_key: apiKey,
  });

  const j = await serpFetch(`https://serpapi.com/search.json?${params.toString()}`);
  const res = Array.isArray(j?.local_results) ? j.local_results : [];
  if (res.length > 0) {
    const best = res[0];
    profile.name = best?.title || profile.name;
    profile.address = best?.address;
    profile.category = best?.type || best?.place_type;
    profile.rating = Number(best?.rating) || undefined;
    profile.reviews = Number(best?.reviews) || Number(best?.user_ratings_total) || undefined;
    if (best?.gps_coordinates?.latitude && best?.gps_coordinates?.longitude) {
      profile.coords = {
        lat: Number(best.gps_coordinates.latitude),
        lng: Number(best.gps_coordinates.longitude),
      };
    }
    // amenities hints
    const snippets = [best?.description, best?.snippet].filter(Boolean).join(" · ").toLowerCase();
    const amz = ["spa", "piscina", "parcheggio", "pet", "colazione", "ristorante", "palestra", "navetta", "vista", "centro"];
    profile.amenities = Array.from(new Set([...(profile.amenities || []), ...amz.filter(a => snippets.includes(a))]));
  } else {
    notes.push("Maps: nessun risultato preciso.");
  }
} else if (!apiKey) {
  notes.push("SerpAPI non disponibile: profilo ridotto.");
} else {
  notes.push("Maps: query insufficiente (manca nome/località).");
}
// Fallback: se non ho coords da Maps, prova Geoapify (serve GEOAPIFY_KEY)
try {
  if ((!profile.coords || !profile.coords.lat || !profile.coords.lng) && (loc || name)) {
    const geoKey = process.env.GEOAPIFY_KEY;
    if (geoKey) {
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
    } else {
      notes.push("Geoapify non configurato (GEOAPIFY_KEY mancante).");
    }
  }
} catch {}

    // B) Canali via search mirate (best-effort, poco costose)
    const channels: string[] = [];
    if (apiKey) {
      const probes = [
        ["Booking.com", `site:booking.com "${profile.name || name}" ${loc}`],
        ["Expedia",     `site:expedia.* "${profile.name || name}" ${loc}`],
        ["Airbnb",      `site:airbnb.* "${profile.name || name}" ${loc}`],
        ["Diretto",     `site:. "${profile.name || name}" ${loc}`],
      ];
      for (const [label, q] of probes) {
        const p = new URLSearchParams({ engine:"google", q, hl:"it", num:"1", api_key: apiKey });
        const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
        const ok = (Array.isArray(j?.organic_results) && j.organic_results.length>0);
        if (ok) channels.push(label as string);
      }
    }
    profile.channels = Array.from(new Set(channels));

// --- Enrichment dal sito ufficiale (se fornito) ---
if (siteEffective) {
  try {
    const inspR = await fetch(`${origin}/api/competitors/inspect?url=${encodeURIComponent(siteEffective)}`, { cache: "no-store" });
    const insp = await inspR.json();

    if (insp?.ok) {
      // Nome canonico da schema.org
      if (insp.signals?.hotelName && !profile.name) {
        profile.name = String(insp.signals.hotelName);
      }

      // Amenities → unione senza duplicati
      if (Array.isArray(insp.signals?.amenities) && insp.signals.amenities.length) {
        profile.amenities = Array.from(
          new Set([...(profile.amenities || []), ...insp.signals.amenities])
        );
      }

      // Booking engine ⇒ aggiungi “Diretto”
      if (insp.signals?.engine?.vendor) {
        profile.channels = Array.from(
          new Set([...(profile.channels || []), "Diretto"])
        );
        notes.push(`Booking engine rilevato (${insp.signals.engine.vendor}).`);
      }

      // **Address** da JSON-LD
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
                  ]
                    .filter(Boolean)
                    .join(", ");
                  if (parts) { profile.address = parts; break; }
                }
              }
            }
            if (profile.address) break;
          } catch {}
        }
      }

      // **Address** fallback dal footer
      if (!profile.address && typeof insp.footerText === "string" && insp.footerText.trim().length) {
        const t = insp.footerText.replace(/\s+/g, " ").trim();
        const m =
          t.match(/\b\d{4,5}\b\s+[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+(?:,\s*[A-Z]{2})?(?:,\s*Italia)?/i) ||
          t.match(/[A-Za-zÀ-ÖØ-öø-ÿ'’\s]+,\s*[A-Z]{2}(?:,\s*Italia)?/i);
        if (m && m[0]) profile.address = m[0].trim();
      }
    } else {
      notes.push(
        `Inspect sito: ${typeof insp?.error === "string" ? insp.error : "non raggiungibile"}.`
      );
    }
  } catch (e: any) {
    notes.push(`Inspect sito: ${String(e?.message || e)}`);
  }
}
let adrMonthly: number[] | null = null;

// 1) Se ho coords → tenta Amadeus "area ADR"
try {
  const origin = new URL(req.url).origin;
  if (profile?.coords?.lat && profile?.coords?.lng) {
    const ym = new Date().getFullYear(); // anno corrente (puoi passarlo da UI)
    const u = `${origin}/api/rates/monthly?lat=${encodeURIComponent(String(profile.coords.lat))}&lng=${encodeURIComponent(String(profile.coords.lng))}&year=${ym}${name ? `&q=${encodeURIComponent(name)}` : ""}`;
    const rr = await fetch(u, { cache:"no-store" });
    const jj = await rr.json();
    if (jj?.ok && Array.isArray(jj.monthly) && jj.monthly.length === 12) {
      adrMonthly = jj.monthly;
      (notes as string[]).push("ADR da Amadeus (mediana 2 campioni/mese).");
    }
  }
} catch {}

// 2) Fallback su curva stagionale
if (!adrMonthly) {
  adrMonthly = estimateADR(loc || profile.address || "", profile.rating);
  (notes as string[]).push("ADR stimato da stagionalità (fallback).");
}
    return NextResponse.json({ ok:true, profile, adrMonthly, notes: notes.length?notes:undefined }, { status:200 });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
