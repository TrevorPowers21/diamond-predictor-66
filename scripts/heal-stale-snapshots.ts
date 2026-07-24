/**
 * Self-heal Step 2 — re-derive `snapshot = f(neutral, notes)` for the provably-safe
 * set and persist it. SAFE SET = drift > 0.02 WAR, devAgg==0 (dev-scale is 1.0 → f is
 * EXACT), and NO SP/RP role transition (projectEffective doesn't model the role
 * regression, so a role-crossed pitcher is quarantined, never healed).
 *
 * At devAgg==0 the displayed line IS the neutral line, re-WAR'd at the saved depth and
 * re-marketed: so the heal copies the neutral's rates + index, recomputes WAR at the
 * (sanitized) notes depth, and recomputes market from that WAR at the program tier.
 * Pitcher-depth sanitize: a pitcher slot whose notes.depthRole is a HITTER role
 * (pollution) falls back to the neutral's pitcher_depth_role — a pitcher can't be
 * "everyday_starter", so this only ever corrects, never overrides a real choice.
 *
 * The stored neutral was verified == the live player_predictions correct row (strict
 * team-precomputed → global regular, no cross-team fallback) before this was run.
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
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
console.log(`### DB: ${ENV}  APPLY=${APPLY} ###`);

const num = (v: any) => (v == null ? null : Number(v));
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const parseNotes = (pn: any) => { try { return typeof pn === "string" ? JSON.parse(pn) : pn; } catch { return null; } };
const page = async (t: string, sel: string) => { let f = 0, o: any[] = []; for (;;) { const { data } = await sb.from(t).select(sel).range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };
const depthIsStarter = (d: any) => /starter|weekend|weekday|midweek|swing/i.test(String(d || ""));
const neutralIsStarter = (role: any) => /^SP/i.test(String(role || ""));
const PIT_ROLES = ["weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"];
const HIT_FIELDS = ["p_avg", "p_obp", "p_slg", "p_iso", "p_wrc_plus"];
const PIT_FIELDS = ["p_k9", "p_bb9", "p_era", "p_fip", "p_hr9", "p_whip", "p_rv_plus", "pitcher_role"];

(async () => {
  // customer_team_id → conference
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => String(c.school_team_id)).filter(Boolean))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }

  const builds = await page("team_builds", "id, customer_team_id");
  const buildCt = new Map<string, string>(); for (const b of builds) buildCt.set(b.id, b.customer_team_id);
  const bps = await page("team_build_players", "id, player_id, build_id, position_slot, player_snapshot, neutral_snapshot, production_notes");
  const tbs = await page("target_board", "id, player_id, customer_team_id, position_slot, transfer_snapshot, neutral_snapshot, production_notes");
  const pids = [...new Set([...bps, ...tbs].map((r: any) => r.player_id).filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x))))];
  const nm = new Map<string, string>(), pos = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) { nm.set(p.id, `${p.first_name} ${p.last_name}`); pos.set(p.id, p.position); } }

  type Row = { table: string; id: string; pid: string; ctid: string | null; slot: any; snap: any; neu: any; notes: any; snapCol: string; warHitKey: string; mktNonTwp: string };
  const rows: Row[] = [
    ...bps.map((r: any) => ({ table: "team_build_players", id: r.id, pid: r.player_id, ctid: buildCt.get(r.build_id) ?? null, slot: r.position_slot, snap: r.player_snapshot, neu: r.neutral_snapshot, notes: r.production_notes, snapCol: "player_snapshot", warHitKey: "o_war", mktNonTwp: "market_value" })),
    ...tbs.map((r: any) => ({ table: "target_board", id: r.id, pid: r.player_id, ctid: r.customer_team_id, slot: r.position_slot, snap: r.transfer_snapshot, neu: r.neutral_snapshot, notes: r.production_notes, snapCol: "transfer_snapshot", warHitKey: "owar", mktNonTwp: "nil_valuation" })),
  ];

  const heal: { row: Row; side: "P" | "H"; before: any; after: any; snapWar: number; fWar: number; conf: string; depth: string }[] = [];
  let quarantined = 0, noConf = 0;
  for (const r of rows) {
    if (!r.neu || !/^[0-9a-f-]{36}$/i.test(String(r.pid)) || !r.snap) continue;
    const side: "P" | "H" = isPit(r.slot ?? (num(r.neu.p_rv_plus) != null ? "SP" : "")) ? "P" : "H";
    const snapWar = side === "P" ? num(r.snap.p_war) : num(r.snap[r.warHitKey] ?? r.snap.o_war ?? r.snap.owar); if (snapWar == null) continue;
    const notes = parseNotes(r.notes) ?? {};
    const devAgg = Number(notes?.devAggressiveness ?? 0) || 0;
    // pitcher-depth sanitize: a hitter role on a pitcher slot = pollution → use neutral's pitcher depth
    let depth = notes?.depthRole ?? (side === "P" ? r.neu.pitcher_depth_role : r.neu.hitter_depth_role);
    if (side === "P" && !PIT_ROLES.includes(String(depth))) depth = r.neu.pitcher_depth_role ?? depth;
    const roleCrossed = side === "P" && depthIsStarter(depth) !== neutralIsStarter(r.neu.pitcher_role);
    // WAR from the validated fn with the sanitized depth
    const { owar, pwar } = projectEffectiveWar(r.neu, { ...notes, depthRole: depth });
    const fWar = side === "P" ? pwar : owar; if (fWar == null) continue;
    if (Math.abs(fWar - snapWar) <= 0.02) continue;          // in sync
    if (devAgg !== 0 || roleCrossed) { quarantined++; continue; } // not safe → skip
    const conf = r.ctid ? ctConf.get(r.ctid) ?? "" : ""; if (!conf) { noConf++; continue; }

    // build the healed snapshot: preserve unknown fields, overlay neutral rates+index, WAR, depth, market
    const s: any = { ...r.snap };
    const overlay = side === "P" ? PIT_FIELDS : HIT_FIELDS;
    for (const k of overlay) if (r.neu[k] !== undefined) s[k] = r.neu[k];
    const isTwp = !!s.is_twp;
    if (side === "P") {
      s.p_war = fWar; s.projected_ip = pitcherExpectedIp(depth as any, EQ); s.pitcher_depth_role = depth;
      const mkt = computePitcherMarketValue(fWar, { conference: conf, role: pitcherRoleFromDepthRole(depth as any), team: nm.get(r.pid) ?? null }, EQ);
      if (isTwp) { s.twp_pitcher_market_value = mkt; s[r.mktNonTwp] = null; }
      else { s[r.mktNonTwp] = mkt; }
    } else {
      s[r.warHitKey] = fWar; if (r.warHitKey !== "o_war" && "o_war" in s) s.o_war = fWar; s.hitter_depth_role = depth;
      const mkt = computeHitterMarketValue(fWar, { conference: conf, position: pos.get(r.pid) });
      if (isTwp) { s.twp_hitter_market_value = mkt; s[r.mktNonTwp] = null; }
      else { s[r.mktNonTwp] = mkt; }
    }
    heal.push({ row: r, side, before: r.snap, after: s, snapWar, fWar, conf, depth });
  }

  heal.sort((a, b) => Math.abs(b.fWar - b.snapWar) - Math.abs(a.fWar - a.snapWar));
  console.log(`\n===== HEAL: ${heal.length} rows  (quarantined ${quarantined}, noConf ${noConf}) =====`);
  const hp = heal.filter((h) => h.side === "P").length;
  console.log(`hitters ${heal.length - hp} · pitchers ${hp}\n`);
  const fmt = (h: typeof heal[0]) => {
    const b = h.before, a = h.after, s = h.side;
    const idx = s === "P" ? `rv+${b.p_rv_plus}→${a.p_rv_plus}` : `wRC+${b.p_wrc_plus}→${a.p_wrc_plus}`;
    const war = s === "P" ? `pWAR ${num(b.p_war)?.toFixed(2)}→${num(a.p_war)?.toFixed(2)}` : `oWAR ${num(b[h.row.warHitKey] ?? b.o_war)?.toFixed(2)}→${h.fWar.toFixed(2)}`;
    const mk = h.row.mktNonTwp; const mv = b.is_twp ? (s === "P" ? `twpP ${num(b.twp_pitcher_market_value)}→${Math.round(num(a.twp_pitcher_market_value) ?? 0)}` : `twpH ${num(b.twp_hitter_market_value)}→${Math.round(num(a.twp_hitter_market_value) ?? 0)}`) : `$${num(b[mk]) == null ? "—" : Math.round(num(b[mk])!)}→${num(a[mk]) == null ? "—" : Math.round(num(a[mk])!)}`;
    return `  ${nm.get(h.row.pid)} [${s}] ${h.depth}: ${idx} · ${war} · ${mv}`;
  };
  (SHOW_ALL ? heal : heal.slice(0, 25)).forEach((h) => console.log(fmt(h)));
  if (!SHOW_ALL && heal.length > 25) console.log(`  … +${heal.length - 25} more (--all)`);

  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const h of heal) { const { error } = await sb.from(h.row.table).update({ [h.row.snapCol]: h.after }).eq("id", h.row.id); if (error) console.log("err", h.row.id, error.message); else done++; if (done % 25 === 0) process.stdout.write(`\r  ${done}/${heal.length}`); }
  console.log(`\n✅ healed ${done}/${heal.length}`);
})();
