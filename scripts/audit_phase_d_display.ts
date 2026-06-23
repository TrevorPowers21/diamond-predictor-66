#!/usr/bin/env node
/**
 * PHASE D — display verification. Computes what the Stats page SHOULD
 * show for reference players (Hudson Brown, Aaron Piasecki, Roblez), so
 * Trevor can cross-check against the browser. Runs the exact same
 * derive() formulas that pitchLogRates.ts uses.
 *
 * Usage:
 *   npm run audit-phase-d
 */
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SEASON = 2026;

// ── xStats lookups (snapshot of pitchLogRates.ts) ──────────────────
const HITTER_XBA_LOOKUP: [number, number][] = [
  [0.1018, 0.0750], [0.1687, 0.1583], [0.1869, 0.1772], [0.1961, 0.1914],
  [0.2042, 0.2000], [0.2103, 0.2079], [0.2155, 0.2135], [0.2203, 0.2178],
  [0.2242, 0.2222], [0.2280, 0.2268], [0.2317, 0.2308], [0.2347, 0.2339],
  [0.2373, 0.2381], [0.2408, 0.2414], [0.2435, 0.2446], [0.2460, 0.2478],
  [0.2486, 0.2500], [0.2508, 0.2537], [0.2537, 0.2568], [0.2556, 0.2597],
  [0.2578, 0.2623], [0.2595, 0.2651], [0.2616, 0.2676], [0.2636, 0.2703],
  [0.2657, 0.2727], [0.2683, 0.2754], [0.2702, 0.2785], [0.2726, 0.2810],
  [0.2748, 0.2833], [0.2771, 0.2865], [0.2791, 0.2887], [0.2812, 0.2914],
  [0.2831, 0.2935], [0.2853, 0.2952], [0.2876, 0.2976], [0.2899, 0.3008],
  [0.2918, 0.3034], [0.2945, 0.3065], [0.2974, 0.3099], [0.3005, 0.3133],
  [0.3035, 0.3163], [0.3061, 0.3191], [0.3094, 0.3220], [0.3125, 0.3265],
  [0.3157, 0.3306], [0.3203, 0.3371], [0.3254, 0.3429], [0.3312, 0.3495],
  [0.3393, 0.3581], [0.3524, 0.3729], [0.4145, 0.4485],
];
const HITTER_XSLG_LOOKUP: [number, number][] = [
  [0.1236, 0.0980], [0.2354, 0.2154], [0.2569, 0.2500], [0.2727, 0.2647],
  [0.2846, 0.2771], [0.2937, 0.2892], [0.3019, 0.2991], [0.3090, 0.3071],
  [0.3163, 0.3154], [0.3234, 0.3224], [0.3300, 0.3299], [0.3355, 0.3367],
  [0.3411, 0.3429], [0.3473, 0.3497], [0.3522, 0.3562], [0.3572, 0.3626],
  [0.3630, 0.3689], [0.3686, 0.3756], [0.3728, 0.3805], [0.3777, 0.3860],
  [0.3820, 0.3919], [0.3862, 0.3968], [0.3917, 0.4023], [0.3965, 0.4066],
  [0.4006, 0.4123], [0.4057, 0.4186], [0.4103, 0.4244], [0.4149, 0.4316],
  [0.4196, 0.4366], [0.4249, 0.4422], [0.4300, 0.4471], [0.4351, 0.4525],
  [0.4416, 0.4593], [0.4486, 0.4667], [0.4546, 0.4739], [0.4602, 0.4798],
  [0.4655, 0.4866], [0.4713, 0.4925], [0.4780, 0.5000], [0.4841, 0.5057],
  [0.4932, 0.5152], [0.5018, 0.5263], [0.5110, 0.5357], [0.5218, 0.5469],
  [0.5339, 0.5588], [0.5490, 0.5704], [0.5645, 0.5844], [0.5867, 0.6045],
  [0.6117, 0.6310], [0.6560, 0.6723], [0.9084, 1.1569],
];

function interp(t: [number, number][], x: number): number {
  if (x <= t[0][0]) return t[0][1];
  if (x >= t[t.length-1][0]) return t[t.length-1][1];
  for (let i = 0; i < t.length-1; i++) {
    const [x0,y0] = t[i]; const [x1,y1] = t[i+1];
    if (x >= x0 && x <= x1) return y0 + ((x-x0)/(x1-x0))*(y1-y0);
  }
  return t[t.length-1][1];
}

const slash = (v: number | null) => v == null ? "—" : v.toFixed(3).replace(/^0+/, "");
const pct = (v: number | null) => v == null ? "—" : `${(v*100).toFixed(1)}%`;
const one = (v: number | null) => v == null ? "—" : v.toFixed(1);

async function reportHitter(pid: string, name: string) {
  const { data: r } = await (s as any).from("pitch_log_hitter_totals")
    .select("*").eq("batter_id", pid).eq("season", SEASON).eq("dimension_key", "all").maybeSingle();
  if (!r) { console.log(`No data for ${name}`); return; }

  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  ${name}  — what the Hitter Stats page SHOULD show`);
  console.log(`══════════════════════════════════════════════════════════════════════`);

  const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
  const tb = r.hits_single + 2*r.hits_double + 3*r.hits_triple + 4*r.hits_hr;
  const avg = hits / r.ab;
  const obp = (hits + r.bb + r.hbp) / (r.ab + r.bb + r.hbp + r.sac);
  const slg = tb / r.ab;
  const ops = obp + slg;
  const iso = slg - avg;
  const xAb = r.ab + r.sac;
  const rawXba = r.x_hits_sum / xAb;
  const rawXslg = r.x_bases_sum / xAb;
  const xba = interp(HITTER_XBA_LOOKUP, rawXba);
  const xslg = interp(HITTER_XSLG_LOOKUP, rawXslg);
  const trackingPct = r.batted_balls_with_ev / r.batted_balls_in_play;

  console.log(`\nTOP STATS LINE (chips):`);
  console.log(`  PA=${r.pa}  AB=${r.ab}  AVG=${slash(avg)}  OBP=${slash(obp)}  SLG=${slash(slg)}  OPS=${slash(ops)}`);
  console.log(`  ISO=${slash(iso)}  HR=${r.hits_hr}  BB=${r.bb}  K=${r.k}  BB%=${pct(r.bb/r.pa)}  K%=${pct(r.k/r.pa)}`);

  console.log(`\nBATTED BALL DATA panel (left column):`);
  console.log(`  xBA          ${slash(xba)}  (raw=${rawXba.toFixed(3)})`);
  console.log(`  xSLG         ${slash(xslg)}  (raw=${rawXslg.toFixed(3)})`);
  const babipNum = hits - r.hits_hr;
  const babipDen = r.ab - r.k - r.hits_hr + r.sac;
  console.log(`  BABIP        ${slash(babipNum/babipDen)}`);
  console.log(`  Avg EV       ${one(r.ev_sum / r.batted_balls_with_ev)} mph`);
  console.log(`  Max EV       ${one(r.max_ev)} mph`);
  console.log(`  Hard Hit%    ${pct(r.batted_hard_hit / r.batted_balls_with_ev)}`);
  console.log(`  Barrel%      ${pct(r.batted_barrels / r.batted_balls_with_ev)}`);
  console.log(`  LA 10-30%    ${pct(r.batted_la_10_to_30 / r.batted_balls_with_ev)}`);
  console.log(`  GB%          ${pct(r.batted_ground_balls / r.batted_balls_with_ev)}`);
  console.log(`  LD%          ${pct(r.batted_line_drives / r.batted_balls_with_ev)}`);
  console.log(`  FB%          ${pct(r.batted_fly_balls / r.batted_balls_with_ev)}`);

  console.log(`\n  Tracking badge: ${trackingPct >= 0.8 ? "FULL TRACKING" : trackingPct >= 0.5 ? "PARTIAL TRACKING" : "LOW TRACKING"} · ${(trackingPct*100).toFixed(0)}%`);
  console.log(`  (${r.batted_balls_with_ev} of ${r.batted_balls_in_play} BIP tracked)`);

  console.log(`\nPLATE DISCIPLINE panel:`);
  console.log(`  Contact%     ${pct((r.total_swings - r.total_whiffs) / r.total_swings)}`);
  console.log(`  Chase%       ${pct(r.total_chases / r.total_out_of_zone)}`);
  console.log(`  IZ Whiff%    ${pct(r.total_in_zone_whiffs / r.total_in_zone_swings)}`);
  console.log(`  Zone%        ${pct(r.total_in_zone / (r.total_in_zone + r.total_out_of_zone))}`);
  console.log(`  K%           ${pct(r.k / r.pa)}`);
  console.log(`  BB%          ${pct(r.bb / r.pa)}`);
  console.log(`  HR%          ${pct(r.hits_hr / r.pa)}`);
}

async function reportPitcher(pid: string, name: string) {
  const { data: r } = await (s as any).from("pitch_log_pitcher_totals")
    .select("*").eq("pitcher_id", pid).eq("season", SEASON).eq("dimension_key", "all").maybeSingle();
  if (!r) { console.log(`No data for ${name}`); return; }

  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  ${name}  — what the Pitcher Stats page SHOULD show`);
  console.log(`══════════════════════════════════════════════════════════════════════`);

  console.log(`\nQUALITY OF STUFF panel:`);
  console.log(`  Stuff+       ${one(r.stuff_plus_sum / r.stuff_plus_data_pitches)}`);
  console.log(`  FB Velo      ${one(r.fb_velo_sum / r.fb_velo_pitches)} mph`);
  console.log(`  Whiff%       ${pct(r.total_whiffs / r.total_swings)}`);
  console.log(`  IZ Whiff%    ${pct(r.total_in_zone_whiffs / r.total_in_zone_swings)}`);
  console.log(`  Chase%       ${pct(r.total_chases / r.total_out_of_zone)}`);
  const csw = (r.total_called_strikes + r.total_whiffs) / r.total_pitches;
  console.log(`  CSW%         ${pct(csw)}`);
  console.log(`  Strike%      ${pct(r.total_strikes / r.total_pitches)}`);
  console.log(`  Zone%        ${pct(r.total_in_zone / (r.total_in_zone + r.total_out_of_zone))}`);

  console.log(`\nBATTED BALL METRICS panel:`);
  console.log(`  Avg EV       ${one(r.ev_sum_allowed / r.batted_balls_allowed_with_ev)} mph`);
  const baHits = r.hits_single_allowed + r.hits_double_allowed + r.hits_triple_allowed + r.hits_hr_allowed;
  const babipNum = baHits - r.hits_hr_allowed;
  const babipDen = r.total_ab - r.total_k - r.hits_hr_allowed;
  console.log(`  BABIP        ${slash(babipNum/babipDen)}`);
  console.log(`  Hard Hit%    ${pct(r.batted_hard_hit_allowed / r.batted_balls_allowed_with_ev)}`);
  console.log(`  Barrel%      ${pct(r.batted_barrels_allowed / r.batted_balls_allowed_with_ev)}`);
  console.log(`  GB%          ${pct(r.batted_ground_balls_allowed / r.batted_balls_allowed_with_ev)}`);
  console.log(`  HR%          ${pct(r.hits_hr_allowed / r.total_pa)}`);

  const trackingPct = r.batted_balls_allowed_in_play > 0 ? r.batted_balls_allowed_with_ev / r.batted_balls_allowed_in_play : 0;
  console.log(`\n  Tracking badge: ${trackingPct >= 0.8 ? "FULL TRACKING" : trackingPct >= 0.5 ? "PARTIAL TRACKING" : "LOW TRACKING"} · ${(trackingPct*100).toFixed(0)}%`);
}

async function main() {
  await reportHitter("1342167668", "Hudson Brown (Kentucky)");
  await reportHitter("1750930555", "Aaron Piasecki");
  await reportHitter("1580046678", "Jonathan Gomez (NEC — low tracking)");
  await reportPitcher("1180787200", "Albert Roblez (FGCU)");
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Cross-check above values against the Stats page in your browser.");
  console.log("  Discrepancies signal a display-layer bug. Matches confirm Phase D.");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
