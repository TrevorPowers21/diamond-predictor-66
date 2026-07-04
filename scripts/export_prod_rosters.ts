#!/usr/bin/env node
/**
 * Ground-truth export of every prod Team Builder roster, in HUMAN terms.
 * READ-ONLY. Emits a JSON the docx/CSV generator turns into a readable record so,
 * worst case, any roster can be rebuilt or set back by hand.
 *
 * Captures per build: budget, and per player — name, kind (returner / transfer /
 * imported freshman), on-roster toggle, position, depth role, dev-aggressiveness,
 * projected market value, and the coach's ACTUAL pay. Plus each team's shared
 * target board.
 *
 * Usage: npm run export-rosters:prod    (writes scripts/.prod_rosters.json)
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
if (!url.includes("trbvxuoliwrfowibatkm")) { console.error("Refusing: not pointed at prod."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const meta = (pn: any) => { try { return JSON.parse(pn || "{}"); } catch { return {}; } };
const money = (v: any) => (v == null || v === "" ? null : Math.round(Number(v)));
async function pageAll(t: string, cols: string): Promise<any[]> {
  const P = 1000; let out: any[] = []; let f = 0;
  while (true) { const { data, error } = await sb.from(t).select(cols).range(f, f + P - 1);
    if (error) throw new Error(`${t}: ${error.message}`); out = out.concat(data || []);
    if (!data || data.length < P) break; f += P; }
  return out;
}

function kindOf(r: any): string {
  if (!r.player_id) return "Imported (hand-entered)";
  const m = meta(r.production_notes);
  const isTarget = r.source === "portal" || m.rosterStatus === "target";
  if (isTarget) return "Transfer / portal";
  if (m.rosterStatus === "leaving") return "Leaving";
  return "Returner";
}

(async () => {
  const teams = await pageAll("customer_teams", "id,name");
  const builds = await pageAll("team_builds", "id,name,customer_team_id,total_budget,depth_assignments,depth_placeholders");
  const bps = await pageAll("team_build_players", "build_id,player_id,source,included_in_roster,custom_name,nil_value,position_slot,depth_order,production_notes");
  const board = await pageAll("target_board", "customer_team_id,player_id,added_at");
  const access = await pageAll("user_team_access", "user_id,customer_team_id");
  const { data: authUsers } = await (sb as any).auth.admin.listUsers({ perPage: 2000 });
  const emailOf = (id: string) => authUsers.users.find((u: any) => u.id === id)?.email ?? id.slice(0, 8);

  // player-name lookup for target board + any missing custom_name
  const pids = [...new Set([...bps.map((r) => r.player_id), ...board.map((r) => r.player_id)].filter(Boolean))];
  const players: any[] = [];
  for (let i = 0; i < pids.length; i += 300) {
    const { data } = await sb.from("players").select("id,first_name,last_name,position,team").in("id", pids.slice(i, i + 300));
    players.push(...(data || []));
  }
  const pName = new Map(players.map((p) => [p.id, `${p.first_name || ""} ${p.last_name || ""}`.trim()]));
  const pInfo = new Map(players.map((p) => [p.id, p]));

  const byBuild = new Map<string, any[]>();
  for (const r of bps) (byBuild.get(r.build_id) ?? byBuild.set(r.build_id, []).get(r.build_id))!.push(r);

  const mapBuild = (b: any) => {
    const rows = (byBuild.get(b.id) ?? []).map((r) => {
      const m = meta(r.production_notes);
      const name = (r.custom_name && r.custom_name.trim()) || pName.get(r.player_id) || "(unnamed)";
      return {
        name, kind: kindOf(r), onRoster: r.included_in_roster !== false,
        position: r.position_slot ?? pInfo.get(r.player_id)?.position ?? null,
        depthRole: m.depthRole ?? null, devAgg: m.devAggressiveness ?? null, devAggByCoach: !!m.devAggressivenessOverridden,
        classTransition: m.classTransition ?? null, classByCoach: !!m.classTransitionOverridden,
        projectionTier: m.projectionTier ?? null,
        projectedMarketValue: money(m.transferSnapshot?.nil_valuation ?? null),
        actualPay: money(r.nil_value), payByCoach: !!m.nilValueOverridden,
      };
    });
    rows.sort((a, b) => (Number(b.onRoster) - Number(a.onRoster)) || String(a.position).localeCompare(String(b.position)) || a.name.localeCompare(b.name));
    return {
      name: b.name, totalBudget: money(b.total_budget),
      depthAssignments: b.depth_assignments ?? {}, depthPlaceholders: b.depth_placeholders ?? {},
      counts: { onRoster: rows.filter((r) => r.onRoster).length, targetsOffRoster: rows.filter((r) => !r.onRoster).length, imported: rows.filter((r) => r.kind.startsWith("Imported")).length },
      players: rows,
    };
  };

  const out: any = { generatedFor: "PROD (read-only) — Team Builder ground truth", teams: [] };
  for (const t of teams) {
    const tBuilds = builds.filter((b) => b.customer_team_id === t.id);
    if (!tBuilds.length && !board.some((r) => r.customer_team_id === t.id)) continue;
    const users = [...new Set(access.filter((a) => a.customer_team_id === t.id).map((a) => emailOf(a.user_id)))];
    const teamBoard = board.filter((r) => r.customer_team_id === t.id).map((r) => {
      const info = pInfo.get(r.player_id);
      return { name: pName.get(r.player_id) || r.player_id.slice(0, 8), from: info?.team ?? null, position: info?.position ?? null };
    }).sort((a, b) => a.name.localeCompare(b.name));

    out.teams.push({ name: t.name, coaches: users, teamTargetBoard: teamBoard, builds: tBuilds.map(mapBuild) });
  }

  // Orphan builds: customer_team_id not in customer_teams (old demo builds with a
  // null team). Captured so the export reconciles to 100% of team_builds. Inert to
  // the deploy — the target migration skips null-team rows and the seed only touches
  // real customer_teams.
  const realTeamIds = new Set(teams.map((t) => t.id));
  const orphanBuilds = builds.filter((b) => !realTeamIds.has(b.customer_team_id));
  if (orphanBuilds.length) {
    out.teams.push({
      name: "⚠ Unaffiliated / legacy demo builds (no customer_team — not loaded by any coach; inert to the deploy)",
      coaches: [], teamTargetBoard: [], builds: orphanBuilds.map(mapBuild),
    });
  }

  writeFileSync("scripts/.prod_rosters.json", JSON.stringify(out, null, 2));
  const nB = out.teams.reduce((s: number, t: any) => s + t.builds.length, 0);
  const nP = out.teams.reduce((s: number, t: any) => s + t.builds.reduce((x: number, b: any) => x + b.players.length, 0), 0);
  console.log(`✅ wrote scripts/.prod_rosters.json — ${out.teams.length} teams, ${nB} builds, ${nP} player rows`);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
