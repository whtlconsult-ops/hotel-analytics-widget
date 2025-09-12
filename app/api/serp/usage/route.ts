// app/api/serp/usage/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return NextResponse.json({ ok:false, error:"SERPAPI_KEY missing" }, { status: 400 });
  try {
    const j = await fetch(`https://serpapi.com/account?api_key=${apiKey}`, { cache: "no-store" }).then(r=>r.json());
    return NextResponse.json({
      ok: true,
      usage: {
        searches_used: j.quota_searches_used,
        searches_total: j.quota_searches_total,
        searches_left: j.plan_searches_left ?? (j.quota_searches_total - j.quota_searches_used),
      }
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status: 500 });
  }
}
