import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 200;

type SyncResult = {
  hittersInserted: number;
  pitchersInserted: number;
  errors: string[];
};

/**
 * Clear the players table, then rebuild it from Hitter Master + Pitching Master.
 * Clean slate — no dedup, no partial updates.
 */
export async function syncMasterToPlayers(season = 2025): Promise<SyncResult> {
  const result: SyncResult = { hittersInserted: 0, pitchersInserted: 0, errors: [] };

  // ─── Clear players table ─────────────────────────────────────────────
  console.log("[syncMaster] Clearing players table...");
  const { error: clearErr } = await supabase.from("players").delete().gte("id", "00000000-0000-0000-0000-000000000000");
  if (clearErr) {
    result.errors.push(`Failed to clear players: ${clearErr.message}`);
    return result;
  }

  // Track source_player_ids to handle players who are both hitters and pitchers
  const insertedSourceIds = new Set<string>();

  // ─── Insert Hitters ──────────────────────────────────────────────────
  console.log("[syncMaster] Loading Hitter Master...");
  const hitterRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, Pos, BatHand, ThrowHand")
      .eq("Season", season)
      .range(from, from + 999);
    if (error) { result.errors.push(`Hitter Master load: ${error.message}`); break; }
    hitterRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  console.log(`[syncMaster] Inserting ${hitterRows.length} hitters...`);
  const hitterInserts = hitterRows.map((h) => {
    const parts = (h.playerFullName || "").trim().split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    if (h.source_player_id) insertedSourceIds.add(h.source_player_id);
    return {
      first_name: firstName,
      last_name: lastName,
      team: h.Team,
      conference: h.Conference,
      position: h.Pos,
      bats_hand: h.BatHand,
      throws_hand: h.ThrowHand,
      source_player_id: h.source_player_id,
      source_team_id: h.TeamID,
      transfer_portal: false,
      from_team: h.Team,
    };
  }).filter((r) => r.first_name && r.last_name);

  for (let i = 0; i < hitterInserts.length; i += CHUNK_SIZE) {
    const chunk = hitterInserts.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("players").insert(chunk);
    if (error) {
      result.errors.push(`Hitter chunk ${i}: ${error.message}`);
    } else {
      result.hittersInserted += chunk.length;
    }
  }

  // ─── Insert Pitchers (skip if already inserted as hitter) ────────────
  console.log("[syncMaster] Loading Pitching Master...");
  const pitcherRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, ThrowHand, Role")
      .eq("Season", season)
      .range(from, from + 999);
    if (error) { result.errors.push(`Pitching Master load: ${error.message}`); break; }
    pitcherRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const pitcherInserts = pitcherRows
    .filter((p) => !p.source_player_id || !insertedSourceIds.has(p.source_player_id))
    .map((p) => {
      const parts = (p.playerFullName || "").trim().split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";
      const role = (p.Role || "").trim().toUpperCase();
      const position = role === "SP" || role === "RP" ? role : "P";
      return {
        first_name: firstName,
        last_name: lastName,
        team: p.Team,
        conference: p.Conference,
        position,
        throws_hand: p.ThrowHand,
        source_player_id: p.source_player_id,
        source_team_id: p.TeamID,
        transfer_portal: false,
        from_team: p.Team,
      };
    })
    .filter((r) => r.first_name && r.last_name);

  console.log(`[syncMaster] Inserting ${pitcherInserts.length} pitchers...`);
  for (let i = 0; i < pitcherInserts.length; i += CHUNK_SIZE) {
    const chunk = pitcherInserts.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("players").insert(chunk);
    if (error) {
      result.errors.push(`Pitcher chunk ${i}: ${error.message}`);
    } else {
      result.pitchersInserted += chunk.length;
    }
  }

  console.log(`[syncMaster] Done! Hitters: ${result.hittersInserted}, Pitchers: ${result.pitchersInserted}`, result);
  return result;
}
