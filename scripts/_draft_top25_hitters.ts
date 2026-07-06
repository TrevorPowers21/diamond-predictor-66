import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

// 1) Pull all draft-eligible hitters from slot values (latest draft_year)
const { data: slots, error: sErr } = await supabase
  .from("player_slot_values")
  .select("player_id, player_name, current_school, rank, aggregate, position, is_high_school, draft_year")
  .eq("draft_year", 2026)
  .eq("is_high_school", false)
  .not("player_id", "is", null);

if (sErr) {
  console.error(sErr);
  process.exit(1);
}

// Filter to hitters only — positions like P/SP/RP/CL/LHP/RHP excluded
const isPitcherPos = (p?: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p || ""));
const slotHitters = (slots || []).filter((s) => !isPitcherPos(s.position));
console.log(`${slotHitters.length} non-pitcher slot rows for 2026 draft`);

// 2) Resolve players → source_player_id
const playerIds = slotHitters.map((s) => s.player_id!).filter(Boolean);
const { data: players } = await supabase
  .from("players")
  .select("id, source_player_id, first_name, last_name, team, conference, division, position")
  .in("id", playerIds);

const bySrcId = new Map<string, any>();
const byPlayerId = new Map<string, any>();
for (const p of players || []) {
  if (p.source_player_id) bySrcId.set(p.source_player_id, p);
  byPlayerId.set(p.id, p);
}

// 3) Hitter Master 2026 stats — pull all candidates by source_player_id
const sourceIds = Array.from(bySrcId.keys());
const hmRows: any[] = [];
const CHUNK = 200;
for (let i = 0; i < sourceIds.length; i += CHUNK) {
  const chunk = sourceIds.slice(i, i + CHUNK);
  const { data, error } = await (supabase as any)
    .from("Hitter Master")
    .select("source_player_id, playerFullName, contact, chase, avg_exit_velo, barrel, overall_power_rating, pa, ab, AVG, OBP, SLG, ISO, Season")
    .in("source_player_id", chunk)
    .eq("Season", 2026);
  if (error) {
    console.error("HM chunk error:", error);
    continue;
  }
  hmRows.push(...(data || []));
}
console.log(`${hmRows.length} Hitter Master 2026 rows matched`);

// 4) Join slot → player → HM, dedupe per player
const rows = slotHitters
  .map((s) => {
    const player = byPlayerId.get(s.player_id);
    if (!player) return null;
    const hm = hmRows.find((h) => h.source_player_id === player.source_player_id);
    if (!hm) return null;
    const avg = hm.AVG != null ? Number(hm.AVG) : null;
    const obp = hm.OBP != null ? Number(hm.OBP) : null;
    const slg = hm.SLG != null ? Number(hm.SLG) : null;
    const iso = hm.ISO != null ? Number(hm.ISO) : null;
    const ops = obp != null && slg != null ? obp + slg : null;
    return {
      name: `${player.first_name} ${player.last_name}`,
      team: player.team || s.current_school,
      pos: player.position || s.position,
      pr: hm.overall_power_rating,
      avg, obp, slg, ops, iso,
      contact: hm.contact,
      chase: hm.chase,
      ev: hm.avg_exit_velo,
      barrel: hm.barrel,
      pa: hm.pa,
      slotRank: s.rank,
      aggregate: s.aggregate,
    };
  })
  .filter(Boolean) as any[];

// 5) Dedupe by player name + team, sort by power rating desc
const seen = new Set<string>();
const top25 = rows
  .filter((r) => r.pr != null)
  .filter((r) => {
    const key = `${r.name}|${r.team}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => Number(b.pr) - Number(a.pr));

// 6) Print
const pct = (n: number | null | undefined) => n == null ? "-" : `${Number(n).toFixed(1)}%`;
const num = (n: number | null | undefined, d = 1) => n == null ? "-" : Number(n).toFixed(d);

const slash = (n: number | null | undefined) => n == null ? "-" : n.toFixed(3).replace(/^0/, "");
console.log("\n# 2026 Draft 600 hitters by overall power rating\n");
console.log("| # | Player | Team | Pos | Power | AVG | OBP | SLG | OPS | ISO | Contact | Chase | EV | Barrel | PA |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
top25.forEach((r, i) => {
  console.log(
    `| ${i + 1} | ${r.name} | ${r.team || "-"} | ${r.pos || "-"} | ${num(r.pr, 1)} | ${slash(r.avg)} | ${slash(r.obp)} | ${slash(r.slg)} | ${slash(r.ops)} | ${slash(r.iso)} | ${pct(r.contact)} | ${pct(r.chase)} | ${num(r.ev, 1)} | ${pct(r.barrel)} | ${r.pa ?? "-"} |`
  );
});
