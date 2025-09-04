"use client";

export const dynamic = "force-dynamic"; // disattiva il prerender/SSG di questa pagina
export const fetchCache = "force-no-store";

import App from "./widget/App";

export default function Page() {
  return <App />;
}
