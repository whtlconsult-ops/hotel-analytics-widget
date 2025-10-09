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
const origin = new URL(req.url).origin;
    if (!name) return NextResponse.json({ ok:false, error:"Missing name" }, { status:400 });

    const apiKey = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
    const notes: string[] = [];
    let profile: any = { name };

    // A) Google Maps lookup (se possibile)
    if (apiKey && loc) {
      const p = new URLSearchParams({
        engine: "google_maps", type: "search",
        q: `${name} ${loc}`, hl: "it", api_key: apiKey,
      });
      const j = await serpFetch(`https://serpapi.com/search.json?${p.toString()}`);
      const res = Array.isArray(j?.local_results) ? j.local_results : [];
      if (res.length > 0) {
        const best = res[0];
        profile.name = best?.title || profile.name;
        profile.address = best?.address;
        profile.category = best?.type || best?.place_type;
        profile.rating = Number(best?.rating) || undefined;
        profile.reviews = Number(best?.reviews) || Number(best?.user_ratings_total) || undefined;
        if (best?.gps_coordinates?.latitude && best?.gps_coordinates?.longitude) {
          profile.coords = { lat: Number(best.gps_coordinates.latitude), lng: Number(best.gps_coordinates.longitude) };
        }
        // amenities hints
        const snippets = [best?.description, best?.snippet].filter(Boolean).join(" · ").toLowerCase();
        const amz = ["spa","piscina","parcheggio","pet","colazione","ristorante","palestra","navetta","vista","centro"];
        profile.amenities = amz.filter(a => snippets.includes(a));
      } else {
        notes.push("Maps: nessun risultato preciso.");
      }
    } else {
      notes.push("SerpAPI non disponibile: profilo ridotto.");
    }

    // B) Canali via search mirate (best-effort, poco costose)
    const channels: string[] = [];
    if (apiKey) {
      const probes = [
        ["Booking.com", `site:booking.com "${name}" ${loc}`],
        ["Expedia",     `site:expedia.* "${name}" ${loc}`],
        ["Airbnb",      `site:airbnb.* "${name}" ${loc}`],
        ["Diretto",     `site:. "${name}" ${loc} prenota|booking|reservations`],
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
if (site) {
  try {
    const inspR = await fetch(
      `${origin}/api/competitors/inspect?url=${encodeURIComponent(site)}`,
      { cache: "no-store" }
    );
    const insp = await inspR.json();

    if (insp?.ok) {
      // Nome "canonico" da schema.org se non era stato risolto da Maps
      if (insp.signals?.hotelName && !profile.name) {
        profile.name = insp.signals.hotelName;
      }
      // Amenities: unisci senza duplicati
      if (Array.isArray(insp.signals?.amenities) && insp.signals.amenities.length) {
        profile.amenities = Array.from(
          new Set([...(profile.amenities || []), ...insp.signals.amenities])
        );
      }
      // Booking engine → implica canale "Diretto"
      if (insp.signals?.engine?.vendor) {
        profile.channels = Array.from(
          new Set([...(profile.channels || []), "Diretto"])
        );
        notes.push(`Booking engine rilevato (${insp.signals.engine.vendor}).`);
      }
    }
  } catch {
    notes.push("Inspect sito: non raggiungibile.");
  }
}

    // C) ADR stimato (12 mesi)
    const adrMonthly = estimateADR(loc || profile.address || "", profile.rating);

    return NextResponse.json({ ok:true, profile, adrMonthly, notes: notes.length?notes:undefined }, { status:200 });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 });
  }
}
