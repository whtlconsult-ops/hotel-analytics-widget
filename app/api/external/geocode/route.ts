// app/api/external/geocode/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    if (!q || q.trim().length < 2) {
      return NextResponse.json({ ok: false, error: "Missing q" }, { status: 400 });
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "it");

    const res = await fetch(url.toString(), {
      headers: {
        // metti un tuo contatto reale o dominio
        "User-Agent": "hotel-analytics-widget/1.0 (contatto@tuodominio.it)",
      },
      // Nominatim chiede di non fare troppi tentativi in parallelo. Qui siamo ok.
      next: { revalidate: 3600 },
    });

    const raw = await res.json();
    const results = Array.isArray(raw)
      ? raw.map((r: any) => ({
          name: r.display_name as string,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }))
      : [];

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "GEOCODE_ERROR" }, { status: 500 });
  }
}
