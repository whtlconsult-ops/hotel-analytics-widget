export const metadata = {
  title: "Hotel Analytics Widget",
  description: "Widget Analisi Domanda – Hospitality",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
