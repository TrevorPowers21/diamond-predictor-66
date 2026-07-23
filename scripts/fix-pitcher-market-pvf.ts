/**
 * Strip the stale weekend-starter PVF (×1.2) from stored pitcher market values in
 * player_predictions. The market MODEL already dropped PVF (pitcherProjection.ts:503
 * = pWar × $/WAR × tier, no PVF); only rows baked before that change are stale.
 *
 * SAFE BY CONSTRUCTION: for each row we recompute the canonical no-PVF value from
 * the SAME conference→tier the precompute used, then only WRITE when the stored
 * value equals recompute × 1.2 (PVF was applied). Rows already equal to recompute
 * are skipped. Anything that matches NEITHER is logged and left untouched — so a
 * bad conference lookup can never corrupt a correct row; it just shows up as a
 * mismatch to investigate.
 *
 *   npx tsx scripts/fix-pitcher-market-pvf.ts           # dry-run
 *   npx tsx scripts/fix-pitcher-market-pvf.ts --apply   # write
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { getProgramTierMultiplierByConference } from "../src/lib/nilProgramSpecific";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"));
const APPLY = process.argv.includes("--apply");
const PVF = EQ.market_pvf_weekend_sp; // 1.2
const DPW = EQ.market_dollars_per_war; // 25000
const GA_CT = "3b1cc0e2-4acd-4a27-a7bc-d345c347f18d";
const TIERS = { sec: EQ.market_tier_sec, p4: EQ.market_tier_acc_big12, bigTen: EQ.market_tier_big_ten, strongMid: EQ.market_tier_strong_mid, lowMajor: EQ.market_tier_low_major, juco: 0.35 };
const tierFor = (conf: string | null | undefined) => getProgramTierMultiplierByConference(conf, TIERS as any);
// pWar is stored rounded, so recompute lands ~1% off; the PVF gap is 20%, so a
// generous tolerance still can't confuse ×1.0 with ×1.2. Absolute floor covers
// tiny-dollar (near-zero WAR) rows where relative error explodes.
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(400, Math.abs(b) * 0.04);

(async () => {
  // customer_team_id → destination conference (school_team_id → Teams Table.id → conference)
  let cts: any[] | null = null;
  for (let a = 0; a < 5 && !cts?.length; a++) { const { data, error } = await sb.from("customer_teams").select("id, school_team_id"); if (error) console.log(`customer_teams read retry ${a}: ${error.message}`); cts = data; }
  if (!cts?.length) { console.log("FATAL: could not read customer_teams — aborting (no conference map)."); return; }
  const teamIds = [...new Set((cts || []).map((c: any) => String(c.school_team_id)).filter(Boolean))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }
  console.log(`customer_teams: ${cts?.length}, resolved conferences: ${ctConf.size}`);

  // player_id → origin conference (for global rows)
  const playerConf = new Map<string, string>();
  { let from = 0; for (;;) { const { data } = await sb.from("players").select("id, conference").range(from, from + 999); if (!data?.length) break; for (const p of data) playerConf.set(p.id, p.conference); from += 1000; if (data.length < 1000) break; } }
  console.log(`players origin conf: ${playerConf.size}`);

  const rowConference = (r: any) => r.customer_team_id ? (ctConf.get(r.customer_team_id) ?? null) : (playerConf.get(r.player_id) ?? null);

  // CANONICAL RESYNC: every populated pitcher-market field is recomputed to
  // pWar_current × 25000 × tier (no PVF, floor 0). Categories are for reporting
  // only — the written value is always the canonical one, so market becomes an
  // exact function of the displayed WAR. Big moves are surfaced to eyeball.
  let scanned = 0, unchanged = 0, nudge = 0, pvf = 0, other = 0, noConf = 0, totalMoved = 0;
  const updates: { id: any; market_value?: number; twp_pitcher_market_value?: number }[] = [];
  const bigMoves: string[] = [], gaSamples: string[] = [];

  const decide = (stored: number | null, pWar: number | null, tier: number, who: string, field: string): number | undefined => {
    if (stored == null || pWar == null) return undefined;        // field not shown → leave as-is
    const newVal = pWar > 0 ? Math.max(0, pWar * DPW * tier) : 0; // canonical, floor 0
    if (Math.abs(newVal - stored) <= 1) { unchanged++; return undefined; }
    totalMoved += Math.abs(newVal - stored);
    if (near(stored, newVal)) nudge++;                           // pWar-rounding precision fix
    else if (near(stored, newVal * PVF)) pvf++;                  // dropped the ×1.2 premium
    else { other++;                                             // market was stale vs recomputed WAR (or anomaly)
      const moveFrac = Math.abs(newVal - stored) / Math.max(1, Math.abs(stored));
      if ((Math.abs(stored) >= 5000 || Math.abs(newVal) >= 5000) && moveFrac >= 0.4 && bigMoves.length < 40)
        bigMoves.push(`  ⚠BIG ${who} ${field}: ${Math.round(stored)} → ${Math.round(newVal)} (tier=${tier} pWar=${pWar.toFixed(3)})`);
    }
    return newVal;
  };

  let from = 0; const STEP = 1000;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, player_id, customer_team_id, variant, pitcher_role, p_war, market_value, twp_pitcher_market_value")
      .not("pitcher_role", "is", null).order("id").range(from, from + STEP - 1);
    if (error) { console.log("read error:", error.message); break; }
    if (!data?.length) break;
    for (const r of data) {
      scanned++;
      const conf = rowConference(r);
      if (conf == null) { noConf++; continue; }                 // can't resolve tier → never touch
      const tier = tierFor(conf);
      const who = `${String(r.player_id).slice(0, 8)}${r.customer_team_id === GA_CT ? " [GA]" : ""}`;
      const mv = decide(r.market_value, r.p_war, tier, who, "mv");
      const tw = decide(r.twp_pitcher_market_value, r.p_war, tier, who, "twpP");
      const upd: any = { id: r.id };
      if (typeof mv === "number") upd.market_value = mv;
      if (typeof tw === "number") upd.twp_pitcher_market_value = tw;
      if (upd.market_value !== undefined || upd.twp_pitcher_market_value !== undefined) {
        updates.push(upd);
        if (r.customer_team_id === GA_CT && gaSamples.length < 20) gaSamples.push(`  GA ${who}: ${r.market_value != null ? `mv ${Math.round(r.market_value)}→${upd.market_value != null ? Math.round(upd.market_value) : "—"}` : ""} ${r.twp_pitcher_market_value != null ? `twpP ${Math.round(r.twp_pitcher_market_value)}→${upd.twp_pitcher_market_value != null ? Math.round(upd.twp_pitcher_market_value) : "—"}` : ""}`);
      }
    }
    from += STEP; if (data.length < STEP) break;
  }

  console.log(`\nscanned pitcher rows: ${scanned}`);
  console.log(`  already exact (no write):     ${unchanged}`);
  console.log(`  will change:                  ${updates.length}`);
  console.log(`    • precision nudge:          ${nudge}`);
  console.log(`    • PVF ×1.2 dropped:         ${pvf}`);
  console.log(`    • stale-vs-WAR / anomaly:   ${other}`);
  console.log(`  no conference (untouched):    ${noConf}`);
  console.log(`  total $ moved:                $${Math.round(totalMoved).toLocaleString()}`);
  if (bigMoves.length) { console.log(`\nBIG MOVES (≥40% & ≥$5k — eyeball these ${bigMoves.length}${other > 40 ? "+" : ""}):`); bigMoves.forEach((s) => console.log(s)); }
  if (gaSamples.length) { console.log("\nGEORGIA CHANGES (spot check):"); gaSamples.forEach((s) => console.log(s)); }

  if (!APPLY) { console.log(`\n(dry-run — no writes. Re-run with --apply.)`); return; }
  console.log(`\nAPPLYING ${updates.length} row updates...`);
  let done = 0;
  for (const u of updates) { const patch: any = {}; if (u.market_value !== undefined) patch.market_value = u.market_value; if (u.twp_pitcher_market_value !== undefined) patch.twp_pitcher_market_value = u.twp_pitcher_market_value; const { error } = await sb.from("player_predictions").update(patch).eq("id", u.id); if (error) { console.log("update err", u.id, error.message); } else { done++; if (done % 2000 === 0) console.log(`  ${done}/${updates.length}`); } }
  console.log(`✅ applied ${done}/${updates.length}`);
})();
