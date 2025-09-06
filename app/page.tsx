// app/page.tsx
export const dynamic = 'force-dynamic'; // evita prerender statico
export const revalidate = 0;            // niente ISR

import App from "./widget/App";

export default function Page() {
  return <App />;
}
