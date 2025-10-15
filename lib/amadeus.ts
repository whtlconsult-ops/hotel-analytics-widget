let tokenCache: { access_token: string; expires_at: number } | null = null;

export async function getAmadeusToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now + 60_000) {
    return tokenCache.access_token;
  }
  const id = process.env.AMADEUS_KEY;
  const sec = process.env.AMADEUS_SECRET;
  if (!id || !sec) throw new Error("AMADEUS_KEY/AMADEUS_SECRET mancanti");

  const u = "https://test.api.amadeus.com/v1/security/oauth2/token";
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: sec,
  });

  const r = await fetch(u, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Amadeus OAuth ${r.status}`);
  const j = await r.json();
  const ttl = Number(j.expires_in || 1800) * 1000;
  tokenCache = { access_token: j.access_token, expires_at: now + ttl };
  return tokenCache.access_token;
}
