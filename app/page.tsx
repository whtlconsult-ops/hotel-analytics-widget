"use client";

// Forza il rendering client-side ed evita prerender/SSG
export const dynamic = "force-dynamic";
export const revalidate = 0;

import App from "./widget/App";

export default function Page() {
  return <App />;
}
