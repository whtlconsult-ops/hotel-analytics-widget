// app/theme.ts
export type ChartVariant = "flat" | "pro";

export const THEME = {
  palette: {
    // Palette principale per i grafici (colori netti)
    chart: ["#e11d48", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#14b8a6", "#f97316"],
    // Palette secondarie già pronte (bar charts)
    barBlue: ["#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"],
    barOrange: ["#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c"],
  },
  chart: {
    pie: { innerRadius: 60, outerRadius: 110, paddingAngle: 3, cornerRadius: 6, legendColor: "#111827" },
    bar: { margin: { left: 8, right: 8, top: 8, bottom: 24 }, tickSize: 12 },
    barWide: { margin: { left: 8, right: 8, top: 8, bottom: 32 }, tickSize: 12 },
    line: { stroke: "#1e3a8a", strokeWidth: 2, dotRadius: 2 },
  },
};

// Helper per scegliere colore solido
export const solidColor = (i: number) => THEME.palette.chart[i % THEME.palette.chart.length];
