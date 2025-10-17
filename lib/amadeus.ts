// /lib/amadeus.ts
export type AmadeusToken = { token: string; exp: number };

let cache: AmadeusToken | null = null;

/** Ottiene e cache-a un bearer token dal sandbox Amadeus */
export async function getAmadeusToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.exp > now + 15_000) return cache.token;

  const key = process.env.AMADEUS_KEY;
  const secret = process.env.AMADEUS_SECRET;
  if (!key || !secret) throw new Error("AMADEUS_KEY/AMADEUS_SECRET mancanti");

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", key);
  body.set("client_secret", secret);

  const r = await fetch("https://test.api.amadeus.com/v1/security/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    // niente cache: è un token
    cache: "no-store",
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Amadeus token error ${r.status}: ${t}`);
  }
  const j = await r.json();
  const token = String(j.access_token || "");
  const expiresIn = Number(j.expires_in || 0); // secondi

  if (!token) throw new Error("Access token vuoto");

  cache = { token, exp: now + Math.max(30, expiresIn - 60) * 1000 };
  return token;
}
