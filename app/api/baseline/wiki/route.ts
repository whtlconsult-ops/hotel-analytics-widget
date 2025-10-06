// app/api/baseline/wiki/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

// Piccolo mapping IT->EN per città comuni; estendibile
const IT_EN: Record<string,string> = {
  "firenze": "Florence",
  "roma": "Rome",
  "milano": "Milan",
  "napoli": "Naples",
  "torino": "Turin",
  "venezia": "Venice",
  "bologna": "Bologna",
};

function ymKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function last12YmKeys(): string[] {
  const now = new Date();
  const arr: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(ymKey(d));
  }
  return arr;
}

function apiUrl(project: string, article: string, startYm: string, endYm: string) {
  // monthly, YYYYMM01 inclusive
  const start = startYm.replace("-", "") + "01";
  const end   = endYm.replace("-", "") + "01";
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${encodeURIComponent(article)}/monthly/${start}/${end}`;
}

async function fetchSeries(project: string, article: string, startYm: string, endYm: string) {
  try {
    const u = apiUrl(project, article, startYm, endYm);
    const r = await fetch(u, {
      headers: { "User-Agent": "HospitalityWidget/1.0 (baseline wiki)" },
      cache: "force-cache",
      next: { revalidate: 21600 } // 6h
    });
    if (!r.ok) return [];
    const j = await r.json();
    const items: any[] = Array.isArray(j?.items) ? j.items : [];
    return items.map(it => {
      const ts = String(it?.timestamp || ""); // YYYYMMDD00
      const ym = `${ts.slice(0,4)}-${ts.slice(4,6)}`;
      const views = Number(it?.views || 0);
      return { month: ym, views };
    });
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || url.searchParams.get("city") || "").trim();
    const months = Math.max(6, Math.min(24, Number(url.searchParams.get("months") || 12)));

    if (!q) return NextResponse.json({ ok: false, error: "Missing city (q)" }, { status: 400 });

    // ultime N chiavi mensili
    const yms = last12YmKeys().slice(-months);
    const startYm = yms[0];
    const endYm   = yms[yms.length - 1];

    // Articolo IT + EN (se mapping noto)
    const cityLower = q.toLowerCase();
    const articleIT = q.replace(/\s+/g, "_");
    const articleEN = (IT_EN[cityLower] || q).replace(/\s+/g, "_");

    const [itArr, enArr] = await Promise.all([
      fetchSeries("it.wikipedia.org", articleIT, startYm, endYm),
      fetchSeries("en.wikipedia.org", articleEN, startYm, endYm),
    ]);

    // Merge per month (somma views)
    const byMonth: Record<string, number> = {};
    yms.forEach(ym => { byMonth[ym] = 0; });
    [...itArr, ...enArr].forEach(row => {
      if (row && row.month && byMonth[row.month] != null) {
        byMonth[row.month] += Number(row.views || 0);
      }
    });

    const series = yms.map(ym => ({ month: ym, views: byMonth[ym] || 0 }));
    return NextResponse.json({ ok: true, series, note: "Wikipedia Pageviews IT+EN" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
