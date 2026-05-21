import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";

type VitalEntry = {
  name: string;
  value: number;
  rating: string;
  delta: number;
  id: string;
};

function logVital(entry: VitalEntry) {
  const { name, value, rating, delta } = entry;
  const ms = (n: number) => `${n.toFixed(1)} ms`;
  const score = (n: number) => n.toFixed(0);

  const formatted =
    name === "CLS" ? `${value.toFixed(4)} (delta ${value.toFixed(4)})` : `${ms(value)} (delta ${ms(delta)})`;

  const style =
    rating === "good"
      ? "color: #4ade80"
      : rating === "needs-improvement"
      ? "color: #facc15"
      : "color: #f87171";

  console.log(`%c[Web Vitals] ${name}: ${formatted} — ${rating.toUpperCase()}`, style);
}

/**
 * Register all Core Web Vital observers. Call once from main.tsx.
 *
 * Metrics captured:
 *   INP  — Interaction to Next Paint: measures the latency from user input
 *          (e.g. clicking a row dropdown) to the next rendered frame.
 *          This is the most direct measure of Team Builder table
 *          interaction speed. Target: < 200 ms (good), < 500 ms (needs work).
 *   LCP  — Largest Contentful Paint: how fast the main content appears.
 *   CLS  — Cumulative Layout Shift: visual stability score.
 *   FCP  — First Contentful Paint: time to first visible content.
 *   TTFB — Time to First Byte: server/CDN response speed.
 *
 * In development these print to the browser console so you can compare
 * values before and after optimization commits.
 *
 * To record production data, replace the console.log with a Supabase
 * insert (see commented block below) and run the migration in
 * supabase/migrations/20260521000001_create_performance_vitals.sql.
 */
export function reportWebVitals() {
  onINP(logVital, { reportAllChanges: true });
  onLCP(logVital);
  onCLS(logVital);
  onFCP(logVital);
  onTTFB(logVital);
}

/*
// ── Supabase production logging ───────────────────────────────────────────────
// Uncomment once the performance_vitals table is migrated.
//
// import { supabase } from "@/integrations/supabase/client";
//
// function sendToSupabase(entry: VitalEntry) {
//   supabase.from("performance_vitals").insert({
//     metric_name: entry.name,
//     value_ms:    entry.name === "CLS" ? null : entry.value,
//     value_score: entry.name === "CLS" ? entry.value : null,
//     rating:      entry.rating,
//     page:        window.location.pathname,
//     recorded_at: new Date().toISOString(),
//   });
// }
//
// export function reportWebVitals() {
//   const handler = (e: VitalEntry) => { logVital(e); sendToSupabase(e); };
//   onINP(handler, { reportAllChanges: true });
//   onLCP(handler); onCLS(handler); onFCP(handler); onTTFB(handler);
// }
*/
