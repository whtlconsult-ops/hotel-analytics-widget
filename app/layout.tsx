import 'leaflet/dist/leaflet.css';
import "./globals.css"; // ⬅️ IMPORTANTE: carica Tailwind

export const metadata = {
  title: "Hotel Analytics Widget",
  description: "Widget Analisi Domanda – Hospitality",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      {/* className sul body per avere il fondo grigio chiaro ovunque */}
      <body className="bg-slate-50">{children}</body>
    </html>
  );
}
