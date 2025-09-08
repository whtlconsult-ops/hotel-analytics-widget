// app/api/external/reverse-geocode/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    if (!lat || !lng) {
      return NextResponse.json({ ok: false, error: "Missing lat/lng" }, { status: 400 });
    }

    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lng);
    url.searchParams.set("format", "json");
    url.searchParams.set("zoom", "10");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "it");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "hotel-analytics-widget/1.0 (contatto@tuodominio.it)",
      },
      next: { revalidate: 86400 },
    });

    const raw = await res.json();
    const name =
      raw?.display_name ||
      [raw?.address?.city, raw?.address?.town, raw?.address?.village, raw?.address?.county]
        .filter(Boolean)
        .join(", ");

    return NextResponse.json({ ok: true, name: name || "Località" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "REVERSE_ERROR" }, { status: 500 });
  }
}
