/**
 * Self-heal Step 2 (v2) — re-derive `snapshot = f(neutral, notes)` for the stale set
 * and persist it. Now models the SP↔RP role transition: the session role is resolved
 * SLOT-first (effectivePitcherRoleForBuild), and for a TARGET row it looks THROUGH to
 * the player's active-build roster slot (a target snapshot mirrors its roster row, so
 * a null-slot target must not lose the roster's transition). projectEffective applies
 * the transition when session role ≠ neutral pitcher_role.
 *
 * SAFE SET = drift > 0.02 WAR. devScale is proven faithful (devAgg≠0 hitters 27/27 +
 * pitchers 17/23 match to the decimal; the drifters are internally-consistent stale
 * lines from an older neutral), so devAgg≠0 rows heal too. Pitcher-depth sanitize: a
 * hitter role on a pitcher slot falls back to the neutral's pitcher_depth_role.
 *
 * Full-line rebuild: pitcher rows take projectEffective's returned (role+dev adjusted)
 * rates + pRV+; hitter rows copy the neutral rates (dev-scale=1 at devAgg=0). WAR at
 * the sanitized depth, market re-baked at the program tier.
 *
 *   npx tsx scripts/heal-stale-snapshots.ts [--prod] [--apply] [--all]
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { projectEffectiveWar } from "../src/lib/projectEffective";
import { computeHitterMarketValue, computePitcherMarketValue, pitcherExpectedIp, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";

const ENV = process.argv.includes("--prod") ? ".env.production.local" : ".env.local";
const APPLY = process.argv.includes("--apply");
const SHOW_ALL = process.argv.includes("--all");
// --market: also recompute a stale market (correct WAR, but stored $ ≠ f(WAR) by
// >2%, e.g. missing the IF/pos multiplier or carrying the dropped pitcher PVF).
// Off by default so the routine heal stays narrow (WAR/zeroed-market only).
const MKT = process.argv.includes("--market");
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
console.log(`### DB: ${ENV}  APPLY=${APPLY} ###`);

// Prod --apply is gated (mirrors import:prod): a scheduled/unattended run must set
// RSTR_AUTOMATION_TOKEN; an interactive one can pass --yes. Guards against a stray
// `--prod --apply` writing prod without intent.
if (APPLY && ENV.includes("production") && !process.env.RSTR_AUTOMATION_TOKEN && !process.argv.includes("--yes")) {
  console.log("REFUSED: prod --apply needs RSTR_AUTOMATION_TOKEN (unattended) or --yes (interactive).");
  process.exit(3);
}

const num = (v: any) => (v == null ? null : Number(v));
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const asRole = (s: any): "SP" | "RP" | null => { const v = String(s || "").toUpperCase(); if (/^SP|^LHP|^RHP/.test(v)) return "SP"; if (/^RP|^CL/.test(v)) return "RP"; return null; };
const parseNotes = (pn: any) => { try { return typeof pn === "string" ? JSON.parse(pn) : pn; } catch { return null; } };
const page = async (t: string, sel: string, flt?: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel).order("id").range(f, f + 999); if (flt) q = flt(sb.from(t).select(sel).order("id")).range(f, f + 999); const { data } = await q; o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };
const PIT_ROLES = ["weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"];
const HIT_FIELDS = ["p_avg", "p_obp", "p_slg", "p_iso", "p_wrc_plus"];

(async () => {
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => c.school_team_id).filter(Boolean).map(String))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }

  const builds = await page("team_builds", "id, customer_team_id, is_active");
  const buildCt = new Map<string, string>(); for (const b of builds) buildCt.set(b.id, (b as any).customer_team_id);
  const activeBuildIds = new Set(builds.filter((b: any) => b.is_active).map((b: any) => b.id));
  const bps = await page("team_build_players", "id, player_id, build_id, position_slot, included_in_roster, player_snapshot, neutral_snapshot, production_notes");
  const tbs = await page("target_board", "id, player_id, customer_team_id, position_slot, transfer_snapshot, neutral_snapshot, production_notes");
  const pids = [...new Set([...bps, ...tbs].map((r: any) => r.player_id).filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x))))];
  const nm = new Map<string, string>(), pos = new Map<string, string>(), twp = new Map<string, boolean>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position, is_twp").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) { nm.set(p.id, `${p.first_name} ${p.last_name}`); pos.set(p.id, p.position); twp.set(p.id, !!p.is_twp); } }

  // (customer_team_id, player_id) → active-build roster pitcher slot (look-through for targets)
  const rosterSlot = new Map<string, string>();
  for (const r of bps) { if (!activeBuildIds.has((r as any).build_id) || !(r as any).included_in_roster) continue; if (!isPit((r as any).position_slot)) continue; const ct = buildCt.get((r as any).build_id); if (ct) rosterSlot.set(`${ct}|${(r as any).player_id}`, (r as any).position_slot); }

  const sessionRoleFor = (pid: string, ctid: string | null, slot: any, where: "roster" | "target"): "SP" | "RP" => {
    if (where === "target") { const rs = ctid ? rosterSlot.get(`${ctid}|${pid}`) : null; if (rs) return asRole(rs) ?? "RP"; }
    return asRole(slot) ?? (twp.get(pid) ? "RP" : (asRole(pos.get(pid)) ?? "RP"));
  };

  type Row = { table: string; id: string; pid: string; ctid: string | null; slot: any; snap: any; neu: any; notes: any; snapCol: string; warHitKey: string; mktNonTwp: string; where: "roster" | "target" };
  const rows: Row[] = [
    ...bps.map((r: any) => ({ table: "team_build_players", id: r.id, pid: r.player_id, ctid: buildCt.get(r.build_id) ?? null, slot: r.position_slot, snap: r.player_snapshot, neu: r.neutral_snapshot, notes: r.production_notes, snapCol: "player_snapshot", warHitKey: "o_war", mktNonTwp: "market_value", where: "roster" as const })),
    ...tbs.map((r: any) => ({ table: "target_board", id: r.id, pid: r.player_id, ctid: r.customer_team_id, slot: r.position_slot, snap: r.transfer_snapshot, neu: r.neutral_snapshot, notes: r.production_notes, snapCol: "transfer_snapshot", warHitKey: "owar", mktNonTwp: "nil_valuation", where: "target" as const })),
  ];

  const heal: { row: Row; side: "P" | "H"; before: any; after: any; snapWar: number; fWar: number; depth: string; trans: boolean; mktOnly: boolean }[] = [];
  let noConf = 0;
  for (const r of rows) {
    if (!r.neu || !/^[0-9a-f-]{36}$/i.test(String(r.pid)) || !r.snap) continue;
    // Side by the NEUTRAL's data shape, not the slot label — a mis-slotted hitter
    // (e.g. a utility bat parked in an "RP4" slot) must still heal as a hitter.
    // Only a genuine TWP row carries both sides, so fall back to the slot then.
    const neuHasH = num(r.neu.p_wrc_plus) != null || num(r.neu.o_war) != null;
    const neuHasP = num(r.neu.p_rv_plus) != null || num(r.neu.p_war) != null;
    const side: "P" | "H" = (neuHasP && !neuHasH) ? "P" : (neuHasH && !neuHasP) ? "H" : (isPit(r.slot ?? "") ? "P" : "H");
    const snapWar = side === "P" ? num(r.snap.p_war) : num(r.snap[r.warHitKey] ?? r.snap.o_war ?? r.snap.owar); if (snapWar == null) continue;
    const notes = parseNotes(r.notes) ?? {};
    const devAgg = Number(notes?.devAggressiveness ?? 0) || 0;
    let depth = notes?.depthRole ?? (side === "P" ? r.neu.pitcher_depth_role : r.neu.hitter_depth_role);
    if (side === "P" && !PIT_ROLES.includes(String(depth))) depth = r.neu.pitcher_depth_role ?? depth;
    const sessionRole = side === "P" ? sessionRoleFor(r.pid, r.ctid, r.slot, r.where) : undefined;
    const { owar, pwar, roleChanged, rates, hitterRates } = projectEffectiveWar(r.neu, { ...notes, depthRole: depth }, EQ, sessionRole as any);
    const fWar = side === "P" ? pwar : owar; if (fWar == null) continue;
    // devScale proven faithful → heal any devAgg
    const conf = r.ctid ? ctConf.get(r.ctid) ?? "" : ""; if (!conf) { noConf++; continue; }

    const s: any = { ...r.snap };
    const isTwp = !!s.is_twp;
    // stored market for the drift compare (side + TWP aware)
    const storedMkt = side === "P"
      ? (isTwp ? num(s.twp_pitcher_market_value) : num(s[r.mktNonTwp]))
      : (isTwp ? num(s.twp_hitter_market_value) : num(s[r.mktNonTwp]));
    let newMkt: number | null;
    if (side === "P") {
      // role+dev adjusted rates from the model (non-transition devAgg=0 → == neutral)
      if (rates) { s.p_era = rates.p_era; s.p_fip = rates.p_fip; s.p_whip = rates.p_whip; s.p_k9 = rates.p_k9; s.p_bb9 = rates.p_bb9; s.p_hr9 = rates.p_hr9; s.p_rv_plus = rates.p_rv_plus; }
      s.p_war = fWar; s.projected_ip = pitcherExpectedIp(depth as any, EQ); s.pitcher_depth_role = depth;
      newMkt = computePitcherMarketValue(fWar, { conference: conf, role: pitcherRoleFromDepthRole(depth as any), team: nm.get(r.pid) ?? null }, EQ);
      if (isTwp) { s.twp_pitcher_market_value = newMkt; s[r.mktNonTwp] = null; } else { s[r.mktNonTwp] = newMkt; }
    } else {
      // Write the DEV-AGG-ADJUSTED slash + wRC+ (the displayed line) so wRC+ stays
      // consistent with the adjusted oWAR. devAgg=0 → hitterRates == neutral, so
      // untoggled hitters are byte-identical to the old neutral-copy behaviour.
      if (hitterRates) {
        if (hitterRates.p_avg != null) s.p_avg = hitterRates.p_avg;
        if (hitterRates.p_obp != null) s.p_obp = hitterRates.p_obp;
        if (hitterRates.p_slg != null) s.p_slg = hitterRates.p_slg;
        if (hitterRates.p_iso != null) s.p_iso = hitterRates.p_iso;
        if (hitterRates.p_wrc_plus != null) s.p_wrc_plus = hitterRates.p_wrc_plus;
      } else for (const k of HIT_FIELDS) if (r.neu[k] !== undefined) s[k] = r.neu[k];
      s[r.warHitKey] = fWar; if (r.warHitKey !== "o_war" && "o_war" in s) s.o_war = fWar; s.hitter_depth_role = depth;
      // Headline total_hitter_war = toggled oWAR + neutral d/bsr (destination/toggle-invariant).
      // Market rides TOTAL WAR (not o_war), consistent with the precompute + the 7b display swap.
      const dW = num(r.neu.d_war) ?? 0, bsrW = num(r.neu.bsr_war) ?? 0;
      const totalHit = fWar + dW + bsrW;
      s.total_hitter_war = totalHit; s.d_war = dW; s.bsr_war = bsrW;
      newMkt = computeHitterMarketValue(totalHit, { conference: conf, position: pos.get(r.pid) });
      if (isTwp) { s.twp_hitter_market_value = newMkt; s[r.mktNonTwp] = null; } else { s[r.mktNonTwp] = newMkt; }
    }
    // Heal if WAR drifted OR the market is broken-to-zero. The market-zero case
    // catches a correct-WAR, eligible player whose stored market is ~$0/null (e.g. a
    // role-transition pitcher the eligibility gate zeroed). Deliberately NARROW — we do
    // NOT churn markets that merely differ by a position/tier nuance, only ones that are
    // effectively missing. (Small market wobble is a separate, non-urgent consistency pass.)
    const warDrift = Math.abs(fWar - snapWar) > 0.02;
    const mktZeroed = newMkt != null && newMkt > 1000 && (storedMkt == null || storedMkt < 1);
    // wRC+ drift: a dev-agg-toggled hitter whose oWAR is already correct but whose
    // stored wRC+ is still the NEUTRAL value (≠ the adjusted wRC+ its oWAR implies).
    // This is the class verify-all §2 flags as oWAR≠recompute(stored wRC+).
    const wrcDrift = side === "H" && hitterRates?.p_wrc_plus != null && num(r.snap.p_wrc_plus) != null
      && Math.abs(Number(hitterRates.p_wrc_plus) - Number(r.snap.p_wrc_plus)) >= 1;
    // market drift (opt-in --market): correct WAR but stored $ off from f(WAR) by
    // >2% — the IF/pos-multiplier + dropped-PVF migration from this branch.
    const mktDrift = MKT && newMkt != null && storedMkt != null
      && Math.abs(newMkt - storedMkt) > Math.max(500, 0.02 * Math.abs(newMkt));
    if (!warDrift && !mktZeroed && !wrcDrift && !mktDrift) continue;   // fully in sync
    heal.push({ row: r, side, before: r.snap, after: s, snapWar, fWar, depth, trans: !!roleChanged, mktOnly: !warDrift && !wrcDrift && (mktZeroed || mktDrift) });
  }

  heal.sort((a, b) => Math.abs(b.fWar - b.snapWar) - Math.abs(a.fWar - a.snapWar));
  console.log(`\n===== HEAL v2: ${heal.length} rows  (noConf ${noConf}) =====`);
  const hp = heal.filter((h) => h.side === "P").length, tr = heal.filter((h) => h.trans).length;
  const dv = heal.filter((h) => (Number(parseNotes(h.row.notes)?.devAggressiveness ?? 0) || 0) !== 0).length;
  console.log(`(devAgg≠0 among these: ${dv})`);
  console.log(`hitters ${heal.length - hp} · pitchers ${hp} (role-transition: ${tr})\n`);
  const mo = heal.filter((h) => h.mktOnly).length;
  console.log(`(market-only heals — WAR was already correct: ${mo})`);
  (SHOW_ALL ? heal : heal.slice(0, 30)).forEach((h) => {
    const b = h.before, a = h.after, s = h.side, mk = h.row.mktNonTwp;
    const idx = s === "P" ? `rv+${b.p_rv_plus}→${a.p_rv_plus}` : `wRC+${b.p_wrc_plus}→${a.p_wrc_plus}`;
    const bMk = b.is_twp ? (s === "P" ? b.twp_pitcher_market_value : b.twp_hitter_market_value) : b[mk];
    const aMk = a.is_twp ? (s === "P" ? a.twp_pitcher_market_value : a.twp_hitter_market_value) : a[mk];
    const mkStr = h.mktOnly ? ` · $${bMk == null ? "—" : Math.round(Number(bMk))}→${aMk == null ? "—" : Math.round(Number(aMk))} [MKT]` : "";
    console.log(`  ${nm.get(h.row.pid)} [${s}]${h.trans ? " ⇄" : ""} (${h.row.where}) ${h.depth}: ${idx} · WAR ${h.snapWar.toFixed(3)}→${h.fWar.toFixed(3)}${mkStr}`);
  });
  if (!SHOW_ALL && heal.length > 30) console.log(`  … +${heal.length - 30} more (--all)`);

  if (!APPLY) { console.log(`\n(dry-run — no writes. Add --apply.)`); console.log(`HEAL_SUMMARY env=${ENV.includes("production") ? "prod" : "staging"} dryrun=true drift=${heal.length}`); return; }
  let done = 0, errs = 0;
  for (const h of heal) { const { error } = await sb.from(h.row.table).update({ [h.row.snapCol]: h.after }).eq("id", h.row.id); if (error) { console.log("err", h.row.id, error.message); errs++; } else done++; if (done % 10 === 0) process.stdout.write(`\r  ${done}/${heal.length}`); }
  console.log(`\n✅ healed ${done}/${heal.length}`);
  console.log(`HEAL_SUMMARY env=${ENV.includes("production") ? "prod" : "staging"} dryrun=false healed=${done} errors=${errs}`);
  if (errs > 0) process.exit(1);
})();
