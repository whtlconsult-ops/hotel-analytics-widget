// app/components/WeatherIcon.tsx
import React from "react";

export type WeatherKind =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "rain"
  | "drizzle"
  | "storm"
  | "snow"
  | "fog";

export function codeToKind(code?: number): WeatherKind {
  if (code == null) return "cloud-sun";
  if (code === 0) return "sun";
  if ([1, 2, 3].includes(code)) return "cloud-sun";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "cloud";
}

/**
 * Icone minimal con stroke scuro + fill tenue per stare bene su sfondi chiari/scuri.
 * Usa className per dimensioni (es. "h-4 w-4").
 */
export function WeatherIcon({
  kind,
  className = "h-4 w-4",
}: {
  kind: WeatherKind;
  className?: string;
}) {
  const stroke = "#0f172a"; // slate-900
  const fog = "#94a3b8";    // slate-400
  const cloud = "#cbd5e1";  // slate-300
  const sun = "#fbbf24";    // amber-400
  const rain = "#60a5fa";   // blue-400
  const snow = "#e2e8f0";   // slate-200
  const storm = "#f59e0b";  // amber-500

  switch (kind) {
    case "sun":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Sole">
          <circle cx="12" cy="12" r="4.5" fill={sun} stroke={stroke} strokeWidth="1.5" />
          <g stroke={stroke} strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
          </g>
        </svg>
      );
    case "cloud-sun":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Variabile">
          <circle cx="7.5" cy="8" r="3" fill={sun} stroke={stroke} strokeWidth="1.3" />
          <path d="M6 4V3M3 7H2M11 7h1M4.4 5.4l-.7-.7M9.6 5.4l.7-.7" stroke={stroke} strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M8.5 18h7.5a3 3 0 0 0 0-6 4.2 4.2 0 0 0-7.9-1.6 3.3 3.3 0 0 0-.6 7.6Z" fill={cloud} stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Nuvoloso">
          <path d="M6.5 19h9a3.5 3.5 0 0 0 .3-7 5.2 5.2 0 0 0-10.1-.9A3.3 3.3 0 0 0 6.5 19Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
        </svg>
      );
    case "drizzle":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Pioviggine">
          <path d="M6.5 14.5h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-.9 3 3 0 0 0 .5 6.9Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
          <g stroke={rain} strokeWidth="1.6" strokeLinecap="round">
            <path d="M9 18.5v2"/><path d="M12 17.5v2"/><path d="M15 18.5v2"/>
          </g>
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Pioggia">
          <path d="M6.5 14.5h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-.9 3 3 0 0 0 .5 6.9Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
          <g stroke={rain} strokeWidth="1.8" strokeLinecap="round">
            <path d="M8.5 17.5v3"/><path d="M11.5 16.5v3"/><path d="M14.5 17.5v3"/><path d="M17.5 16.5v3"/>
          </g>
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Neve">
          <path d="M6.5 14.5h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-.9 3 3 0 0 0 .5 6.9Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
          <g stroke={snow} strokeWidth="1.6" strokeLinecap="round">
            <path d="M9 17l.8.8M12 16.5l.8.8M15 17l.8.8M9.8 18l-.8.8M12.8 18.5l-.8.8M15.8 18l-.8.8"/>
          </g>
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Temporale">
          <path d="M6.5 14.5h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-.9 3 3 0 0 0 .5 6.9Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
          <path d="M11 16l-1.5 3h2L10.5 22" fill="none" stroke={storm} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-label="Nebbia">
          <path d="M6.5 14.5h9a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-.9 3 3 0 0 0 .5 6.9Z" fill={cloud} stroke={stroke} strokeWidth="1.5"/>
          <g stroke={fog} strokeWidth="1.6" strokeLinecap="round">
            <path d="M7 17h10"/><path d="M8 19h8"/>
          </g>
        </svg>
      );
    default:
      return null;
  }
}
