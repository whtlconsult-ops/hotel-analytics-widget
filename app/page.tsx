"use client";

export const dynamic = "force-dynamic"; // evita prerender lato server
export const revalidate = 0;             // nessuna cache/SSG
export const fetchCache = "force-no-store";

import App from "./widget/App";

export default function Page() {
  return <App />;
}
