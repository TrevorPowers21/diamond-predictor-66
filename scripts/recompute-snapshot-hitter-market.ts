/**
 * Recompute HITTER market on build snapshots from each snapshot's stored
 * total_hitter_war (o+d+bsr), at the build program's conference + the player's
 * position. Fixes the disconnect where a toggled snapshot's market was baked off
 * OFFENSE oWAR (useTeamBuilderSimulation:1105) instead of the total, and where
 * resync floored off offense (a positive-total / negative-offense player wrongly $0).
 *
 * Pure DB fix (Trevor 2026-08-26: "fix it in the DB, not the live toggle path") — the
 * WAR + all toggles (dev_agg/depth/nil) are left untouched; only the dollar figure is
 * re-derived as an exact function of the DISPLAYED total_hitter_war. Idempotent.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/recompute-snapshot-hitter-market.ts            # dry-run, all builds
 *   npx tsx --env-file-if-exists=.env.local scripts/recompute-snapshot-hitter-market.ts --apply
 *   ... --prod   (reads .env.production.local)
 */
import { createClient } from "@supabase/supabase-js";
import { computeHitterMarketValue } from "@/lib/depthRoles";
import { pickHitterWar } from "@/lib/twpMarketValue";

const IS_PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (/trbvxuoliwrfowibatkm/.test(url) && !IS_PROD) { console.error("✗ URL is PROD but --prod not passed."); process.exit(1); }
if (IS_PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("✗ --prod passed but URL is not prod."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
console.log(`target: ${IS_PROD ? "🔴 PROD" : "STAGING"}${APPLY ? " [APPLY]" : " [DRY RUN]"}`);
const num = (v: any) => v == null ? null : Number(v);

(async () => {
  // build_id → conference (team_builds.customer_team_id → customer_teams.school_team_id → Teams Table.conference)
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => c.school_team_id).filter(Boolean).map(String))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), (t as any).conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String((c as any).school_team_id)); if (cf) ctConf.set((c as any).id, cf); }
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id");
  const buildConf = new Map<string, string>(); for (const b of (builds || [])) { const cf = ctConf.get((b as any).customer_team_id); if (cf) buildConf.set((b as any).id, cf); }

  // all build players (paginated, ordered)
  let bps: any[] = []; { let f = 0; for (;;) { const { data, error } = await sb.from("team_build_players").select("id, build_id, player_id, position_slot, player_snapshot").order("id").range(f, f + 999); if (error) throw error; bps = bps.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } }
  // Only real UUID player_ids can be looked up in `players`. A single stray non-UUID
  // (e.g. a literal null from a portal-search add) makes Postgres reject the WHOLE
  // `.in("id", batch)` as an invalid-uuid error, silently dropping every real player in
  // that batch → their natural position is lost and PVF falls back wrong. Filter first,
  // and error-check each batch so this can never silently poison the position map again.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pids = [...new Set(bps.map((r: any) => r.player_id))].filter((p) => p != null && UUID_RE.test(String(p)));
  const playerPos = new Map<string, string>(), name = new Map<string, string>(), playerTwp = new Map<string, boolean>();
  // ★ 2026-08-31 — `is_twp` is fetched from `players`, the SOURCE OF TRUTH. See REGISTRY #21.
  for (let i = 0; i < pids.length; i += 200) { const { data, error } = await sb.from("players").select("id, first_name, last_name, position, is_twp").in("id", pids.slice(i, i + 200)); if (error) throw new Error(`players fetch batch @${i} failed: ${error.message}`); for (const p of (data || [])) { playerPos.set((p as any).id, (p as any).position); playerTwp.set((p as any).id, (p as any).is_twp === true); name.set((p as any).id, `${(p as any).first_name} ${(p as any).last_name}`); } }

  let changed = 0, noConf = 0, skippedPitcher = 0; const updates: any[] = [], samples: string[] = [];
  for (const r of bps) {
    const s0 = r.player_snapshot || {}; if (!Object.keys(s0).length) continue;
    // hitter snapshot = has a hitter WAR and is not a pure pitcher row
    const total = pickHitterWar(s0);                 // total_hitter_war (o+d+bsr), o_war fallback
    if (total == null || (s0.p_war != null && s0.o_war == null)) { skippedPitcher++; continue; }
    const conf = buildConf.get(r.build_id); if (!conf) { noConf++; continue; }
    const pos = playerPos.get(r.player_id) ?? s0.position ?? r.position_slot ?? null;
    const newMv = computeHitterMarketValue(Number(total), { conference: conf, position: pos });
    const s = { ...s0 };
    // ★ 2026-08-31 — BRANCH ON `players.is_twp`, THE SOURCE OF TRUTH — never on the snapshot's embedded copy.
    //   E35 flipped `players.is_twp` 137→253 and NOTHING updated the snapshots, so `s.is_twp` is stale (or absent)
    //   on every row written before that. Branching on it routed a TWP's dollars into the SHARED `market_value`,
    //   which the display layer (`pickHitterMarketValue`) never reads for a TWP — a correct number in the column
    //   nobody looks at, while the column it DOES read held a stale wrong-conference value (2.9× off).
    //   ⛔ Do NOT "fix" this by back-filling `is_twp` into snapshots — that just creates another copy to go stale.
    //   See SILENT-FAILURE REGISTRY #21. Same resolution as the `players.pa` defect (REGISTRY #9): change what is
    //   READ, do not sync another column.
    const isTwp = playerTwp.get(r.player_id) === true;
    // TWP: hitter dollars live in twp_hitter_market_value and the shared market_value MUST be NULL.
    const field = isTwp ? "twp_hitter_market_value" : "market_value";
    const oldMv = num(s[field]);
    if (newMv == null) continue;
    // A TWP row carrying a non-null shared market_value is itself a defect to repair, even if the dollars in
    // `field` are already correct — so it counts as a change.
    const staleShared = isTwp && s.market_value != null;
    if (oldMv == null || Math.abs(oldMv - newMv) >= 1 || staleShared) {
      s[field] = newMv;
      if (isTwp) { s.market_value = null; s.is_twp = true; }
      updates.push({ id: r.id, player_snapshot: s });
      changed++;
      if (samples.length < 12) { const nm = name.get(r.player_id) ?? (s0 as any).name ?? (s0 as any).player_name ?? ((s0 as any).first_name ? `${(s0 as any).first_name} ${(s0 as any).last_name ?? ""}`.trim() : null) ?? `id:${String(r.player_id).slice(0, 8)}`; const winNew = Number(total) !== 0 ? Math.round(newMv / Number(total)) : 0; samples.push(`  ${nm} [${r.position_slot ?? pos}] ${conf} total=${Number(total).toFixed(2)} ${field}: $${oldMv == null ? "—" : Math.round(oldMv)} → $${Math.round(newMv)}  ($${winNew}/win)`); }
    }
  }
  console.log(`hitter snaps to update: ${changed}  (noConf ${noConf}, pitcher-only skipped ${skippedPitcher})`);
  samples.forEach((x) => console.log(x));
  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); return; }
  for (let i = 0; i < updates.length; i++) { const { error } = await sb.from("team_build_players").update({ player_snapshot: updates[i].player_snapshot }).eq("id", updates[i].id); if (error) console.log("err", updates[i].id, error.message); if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i + 1}/${updates.length}`); }
  console.log(`\n✅ applied ${updates.length}`);
})();
