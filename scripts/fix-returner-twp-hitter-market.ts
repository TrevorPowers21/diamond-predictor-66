/**
 * One-purpose fix: the returner hitter precompute historically wrote the hitter
 * market into the shared `market_value` column for TWPs (should be NULL — the
 * value belongs in twp_hitter_market_value). It also left `twp_hitter_market_value`
 * on an older, stale value. This recomputes twp_hitter_market_value with the
 * CURRENT canonical computeHitterMarketValue (new equation) and NULLs the shared
 * market_value, for every is_twp returner/regular row.
 *
 *   npx tsx scripts/fix-returner-twp-hitter-market.ts          # dry run
 *   npx tsx scripts/fix-returner-twp-hitter-market.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
import { computeHitterMarketValue } from "../src/lib/depthRoles";
import { pickHitterWar } from "../src/lib/twpMarketValue";

const APPLY = process.argv.includes("--apply");
// Double-keyed prod guard (added 2026-08-30). Already env-driven (no literal .env path),
// but it had NO guard: `--env-file .env.production.local` wrote prod with no opt-in.
const PROD_REF = "trbvxuoliwrfowibatkm";
const WANT_PROD = process.argv.includes("--prod");
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const URL_IS_PROD = new RegExp(PROD_REF).test(SB_URL);
if (!SB_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (use --env-file). Refusing."); process.exit(1); }
if (URL_IS_PROD && !WANT_PROD) { console.error(`✗ target is PROD (${PROD_REF}) but --prod was NOT passed. Refusing.`); process.exit(1); }
if (WANT_PROD && !URL_IS_PROD) { console.error(`✗ --prod passed but target is NOT prod: ${SB_URL}. Refusing.`); process.exit(1); }
console.log(`[target] ${URL_IS_PROD ? "PROD" : "STAGING"} ${SB_URL}`);
const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const norm = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

(async () => {
  // is_twp players + their conference/position (with Teams Table fallback for conf)
  const players: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("players")
      .select("id, position, conference, source_team_id, team, is_twp")
      .eq("is_twp", true).range(f, f + 999);
    if (error) throw error;
    players.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // Teams Table conference fallback
  const teams: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("Teams Table").select("source_id, full_name, abbreviation, conference").range(f, f + 999);
    teams.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const confBySrc = new Map<string, string | null>();
  const confByName = new Map<string, string | null>();
  for (const t of teams) {
    if (t.source_id) confBySrc.set(String(t.source_id), t.conference ?? null);
    if (t.full_name) confByName.set(norm(t.full_name), t.conference ?? null);
    if (t.abbreviation) confByName.set(norm(t.abbreviation), t.conference ?? null);
  }
  const meta = new Map<string, { conference: string | null; position: string | null }>();
  for (const p of players) {
    let conf: string | null = p.conference ?? null;
    if (!conf && p.source_team_id && confBySrc.has(String(p.source_team_id))) conf = confBySrc.get(String(p.source_team_id)) ?? null;
    if (!conf && p.team && confByName.has(norm(p.team))) conf = confByName.get(norm(p.team)) ?? null;
    meta.set(p.id, { conference: conf, position: p.position });
  }
  const pids = players.map((p) => p.id);

  // returner/regular 2027 rows for those players (paginated, ordered)
  const rows: any[] = [];
  for (let i = 0; i < pids.length; i += 100) {
    const batch = pids.slice(i, i + 100);
    for (let f = 0; ; f += 1000) {
      const { data, error } = await sb.from("player_predictions")
        // ★ d_war/bsr_war/total_hitter_war added 2026-08-31 so the market prices off the composite, not offense-only.
        .select("id, player_id, o_war, d_war, bsr_war, total_hitter_war, market_value, twp_hitter_market_value")
        .eq("season", 2027).eq("model_type", "returner").eq("variant", "regular")
        .in("player_id", batch).order("id", { ascending: true }).range(f, f + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }

  let toWrite = 0, noConf = 0, noOwar = 0;
  const updates: { id: string; patch: any }[] = [];
  const samples: string[] = [];
  for (const r of rows) {
    const m = meta.get(r.player_id);
    // ★ 2026-08-31: price off `total_hitter_war` (o+d+bsr, NO p_war) via the shared `pickHitterWar` helper — the
    //   same one the display layer and F42b use. Was raw `o_war`, which ignored defense + baserunning. REGISTRY #19.
    const war = pickHitterWar(r);
    if (war == null) { noOwar++; continue; }
    if (!m?.conference) { noConf++; }
    const newH = computeHitterMarketValue(Number(war), { conference: m?.conference ?? null, position: m?.position ?? null });
    updates.push({ id: r.id, patch: { twp_hitter_market_value: newH, market_value: null } });
    toWrite++;
    if (samples.length < 8) samples.push(`  ${r.player_id.slice(0, 8)} war=${Number(war).toFixed(3)} (o_war=${r.o_war == null ? "-" : Number(r.o_war).toFixed(3)}) conf=${m?.conference} pos=${m?.position}  twpH ${r.twp_hitter_market_value == null ? "-" : Math.round(r.twp_hitter_market_value)} -> ${newH == null ? "null" : Math.round(newH)}  mv ${r.market_value == null ? "-" : Math.round(r.market_value)} -> null`);
  }
  console.log(`returner-TWP rows=${rows.length}  toWrite=${toWrite}  noConference=${noConf}  noOwar(skipped)=${noOwar}  APPLY=${APPLY}`);
  samples.forEach((s) => console.log(s));
  if (APPLY) {
    for (let i = 0; i < updates.length; i++) {
      const { error } = await sb.from("player_predictions").update(updates[i].patch).eq("id", updates[i].id);
      if (error) throw error;
      if ((i + 1) % 25 === 0) process.stdout.write(`\r  written ${i + 1}/${updates.length}`);
    }
    console.log(`\n  done (${updates.length}).`);
  } else console.log("DRY RUN — add --apply.");
})();
