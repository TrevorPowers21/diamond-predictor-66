export const NAVY_BG = "#040810";
export const NAVY_CARD = "#0a1428";
export const NAVY_BORDER = "#1f2d52"; // NOTE: MASTER.md rules the canonical border as #162241;
                                      // flipping this value is the held color-sweep phase (visual
                                      // verify), so it stays #1f2d52 here for byte-identical imports.
export const GOLD = "#D4AF37";

// Ratified chart palette (slate-on-navy), per design-system/rstr-iq/MASTER.md. The current
// rendered chart look is canonical — these are the hexes already in use, centralized so future
// charts import one source. GOLD is reserved for the highlighted / primary data point.
export const CHART_THEME = {
  slate900: "#0F172A",
  slate600: "#475569",
  slate500: "#6b7280",
  slate400: "#94A3B8",
  gray600: "#4b5563",
  gray550: "#525252",
  highlight: GOLD, // #D4AF37 — highlighted / primary series only
} as const;
