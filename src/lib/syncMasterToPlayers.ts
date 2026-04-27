import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 200;

type SyncResult = {
  hittersInserted: number;
  pitchersInserted: number;
  errors: string[];
};

type AddMissingResult = {
  inserted: number;
  skipped: number;
  errors: string[];
};

/**
 * Non-destructive sync: find source_player_ids in Hitter Master + Pitching Master
 * that don't exist in the players table yet, and insert them. Does NOT delete or
 * modify any existing player rows.
 */
export async function addMissingPlayers(season = 2025): Promise<AddMissingResult> {
  const result: AddMissingResult = { inserted: 0, skipped: 0, errors: [] };

  // 1. Load all existing source_player_ids from players table
  console.log("[addMissing] Loading existing player source IDs...");
  const existingIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players")
      .select("source_player_id")
      .not("source_player_id", "is", null)
      .range(from, from + 999);
    if (error) { result.errors.push(`Load existing: ${error.message}`); return result; }
    for (const r of data || []) if (r.source_player_id) existingIds.add(r.source_player_id);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[addMissing] ${existingIds.size} existing players with source IDs`);

  // 2. Load hitter master rows for the target season
  console.log(`[addMissing] Loading Hitter Master season ${season}...`);
  const hitterRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, Pos, BatHand, ThrowHand, pa, ab")
      .eq("Season", season)
      .range(from, from + 999);
    if (error) { result.errors.push(`Hitter load: ${error.message}`); break; }
    hitterRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // 3. Load pitcher master rows for the target season
  console.log(`[addMissing] Loading Pitching Master season ${season}...`);
  const pitcherRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, ThrowHand, Role, IP, G, GS")
      .eq("Season", season)
      .range(from, from + 999);
    if (error) { result.errors.push(`Pitcher load: ${error.message}`); break; }
    pitcherRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // 4. Find missing source_player_ids and build insert records
  const splitName = (full: string | null) => {
    const parts = (full || "").trim().split(/\s+/);
    return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
  };

  const toInsert = new Map<string, any>();

  for (const h of hitterRows) {
    const sid = h.source_player_id;
    if (!sid || existingIds.has(sid) || toInsert.has(sid)) continue;
    const { first, last } = splitName(h.playerFullName);
    if (!first || !last) continue;
    toInsert.set(sid, {
      first_name: first,
      last_name: last,
      team: h.Team ?? null,
      conference: h.Conference ?? null,
      position: h.Pos ?? null,
      bats_hand: h.BatHand ?? null,
      throws_hand: h.ThrowHand ?? null,
      source_player_id: sid,
      source_team_id: h.TeamID ?? null,
      transfer_portal: false,
      from_team: h.Team ?? null,
      pa: h.pa ?? null,
      ab: h.ab ?? null,
    });
  }

  for (const p of pitcherRows) {
    const sid = p.source_player_id;
    if (!sid || existingIds.has(sid) || toInsert.has(sid)) continue;
    const { first, last } = splitName(p.playerFullName);
    if (!first || !last) continue;
    const role = (p.Role || "").trim().toUpperCase();
    toInsert.set(sid, {
      first_name: first,
      last_name: last,
      team: p.Team ?? null,
      conference: p.Conference ?? null,
      position: role === "SP" || role === "RP" ? role : "P",
      throws_hand: p.ThrowHand ?? null,
      source_player_id: sid,
      source_team_id: p.TeamID ?? null,
      transfer_portal: false,
      from_team: p.Team ?? null,
      ip: p.IP ?? null,
      g: p.G ?? null,
      gs: p.GS ?? null,
    });
  }

  result.skipped = existingIds.size;
  const inserts = Array.from(toInsert.values());
  console.log(`[addMissing] Found ${inserts.length} missing players to insert`);

  if (inserts.length === 0) return result;

  // 5. Insert in chunks
  for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
    const chunk = inserts.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("players").insert(chunk);
    if (error) {
      result.errors.push(`Insert chunk ${i}: ${error.message}`);
    } else {
      result.inserted += chunk.length;
    }
  }

  console.log(`[addMissing] Done! Inserted ${result.inserted}, skipped ${result.skipped} existing`, result);
  return result;
}

/**
 * Clear the players table, then rebuild it from ALL seasons in Hitter Master +
 * Pitching Master. One row per source_player_id, with metadata preferred from
 * the most recent season the player appears in.
 *
 * The `season` parameter is the "preferred" season for metadata (defaults 2025).
 * Players who don't appear in that season fall back to the most recent season
 * they DO appear in.
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

  // ─── Load ALL hitter rows across every season ───────────────────────
  console.log("[syncMaster] Loading Hitter Master (all seasons)...");
  const hitterRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, Pos, BatHand, ThrowHand, Season, pa, ab")
      .order("Season", { ascending: false })
      .order("source_player_id", { ascending: true })
      .range(from, from + 999);
    if (error) { result.errors.push(`Hitter Master load: ${error.message}`); break; }
    hitterRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // ─── Load ALL pitcher rows across every season ──────────────────────
  console.log("[syncMaster] Loading Pitching Master (all seasons)...");
  const pitcherRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, ThrowHand, Role, Season, IP, G, GS")
      .order("Season", { ascending: false })
      .order("source_player_id", { ascending: true })
      .range(from, from + 999);
    if (error) { result.errors.push(`Pitching Master load: ${error.message}`); break; }
    pitcherRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // ─── Collapse to one record per source_player_id ─────────────────────
  // Preference order: preferred season first, then most recent. Hitter rows
  // beat pitcher rows when both exist for the same season (so position info
  // comes from the hitter side for two-way players).
  type Collapsed = {
    source_player_id: string | null;
    first_name: string;
    last_name: string;
    team: string | null;
    conference: string | null;
    position: string | null;
    bats_hand: string | null;
    throws_hand: string | null;
    source_team_id: string | null;
    bestSeason: number;
    isPitcher: boolean;
    pa: number | null;
    ab: number | null;
    ip: number | null;
    g: number | null;
    gs: number | null;
  };
  const byId = new Map<string, Collapsed>();
  // Anonymous (no source_player_id) rows are keyed by name+team+isPitcher to
  // dedupe but won't merge across hitter/pitcher tables.
  const anon: Collapsed[] = [];

  const splitName = (full: string | null) => {
    const parts = (full || "").trim().split(/\s+/);
    return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
  };
  const seasonScore = (s: number | null) => {
    if (s == null) return -1;
    if (s === season) return 1_000_000; // preferred season wins
    return Number(s);
  };

  for (const h of hitterRows) {
    const { first, last } = splitName(h.playerFullName);
    if (!first || !last) continue;
    const rec: Collapsed = {
      source_player_id: h.source_player_id ?? null,
      first_name: first,
      last_name: last,
      team: h.Team ?? null,
      conference: h.Conference ?? null,
      position: h.Pos ?? null,
      bats_hand: h.BatHand ?? null,
      throws_hand: h.ThrowHand ?? null,
      source_team_id: h.TeamID ?? null,
      bestSeason: Number(h.Season) || 0,
      isPitcher: false,
      pa: h.pa ?? null,
      ab: h.ab ?? null,
      ip: null,
      g: null,
      gs: null,
    };
    if (rec.source_player_id) {
      const existing = byId.get(rec.source_player_id);
      if (!existing) {
        byId.set(rec.source_player_id, rec);
      } else if (seasonScore(rec.bestSeason) > seasonScore(existing.bestSeason)) {
        // Newer hitter row wins, but inherit pitching counts if existing had them
        rec.ip = existing.ip ?? rec.ip;
        rec.g = existing.g ?? rec.g;
        rec.gs = existing.gs ?? rec.gs;
        byId.set(rec.source_player_id, rec);
      } else {
        // Existing record wins season-wise but pull pa/ab if missing
        existing.pa = existing.pa ?? rec.pa;
        existing.ab = existing.ab ?? rec.ab;
      }
    } else {
      anon.push(rec);
    }
  }

  for (const p of pitcherRows) {
    const { first, last } = splitName(p.playerFullName);
    if (!first || !last) continue;
    const role = (p.Role || "").trim().toUpperCase();
    const position = role === "SP" || role === "RP" ? role : "P";
    const rec: Collapsed = {
      source_player_id: p.source_player_id ?? null,
      first_name: first,
      last_name: last,
      team: p.Team ?? null,
      conference: p.Conference ?? null,
      position,
      bats_hand: null,
      throws_hand: p.ThrowHand ?? null,
      source_team_id: p.TeamID ?? null,
      bestSeason: Number(p.Season) || 0,
      isPitcher: true,
      pa: null,
      ab: null,
      ip: p.IP ?? null,
      g: p.G ?? null,
      gs: p.GS ?? null,
    };
    if (rec.source_player_id) {
      const existing = byId.get(rec.source_player_id);
      if (!existing) {
        byId.set(rec.source_player_id, rec);
      } else if (seasonScore(rec.bestSeason) > seasonScore(existing.bestSeason)) {
        if (!existing.isPitcher) {
          existing.team = rec.team;
          existing.conference = rec.conference;
          existing.throws_hand = rec.throws_hand ?? existing.throws_hand;
          existing.source_team_id = rec.source_team_id;
          existing.bestSeason = rec.bestSeason;
          existing.ip = rec.ip ?? existing.ip;
          existing.g = rec.g ?? existing.g;
          existing.gs = rec.gs ?? existing.gs;
        } else {
          // overwrite but preserve any prior pa/ab from hitter side
          rec.pa = existing.pa ?? rec.pa;
          rec.ab = existing.ab ?? rec.ab;
          byId.set(rec.source_player_id, rec);
        }
      } else {
        // Existing record from preferred season — still pull in pitching counts
        existing.ip = existing.ip ?? rec.ip;
        existing.g = existing.g ?? rec.g;
        existing.gs = existing.gs ?? rec.gs;
      }
    } else {
      anon.push(rec);
    }
  }

  // ─── Force team/conference to come from the preferred (2025) season only ──
  // Without this, departed players show up on a current roster because their
  // last team carries forward. We want a player on the team they actually
  // played for in 2025, or null if they weren't in 2025 at all.
  const teamBySourceId2025 = new Map<string, { team: string | null; conference: string | null; teamId: string | null }>();
  for (const h of hitterRows) {
    if (Number(h.Season) !== season) continue;
    if (!h.source_player_id) continue;
    teamBySourceId2025.set(h.source_player_id, { team: h.Team ?? null, conference: h.Conference ?? null, teamId: h.TeamID ?? null });
  }
  for (const p of pitcherRows) {
    if (Number(p.Season) !== season) continue;
    if (!p.source_player_id) continue;
    // Hitter row takes precedence (already set), only fill if missing
    if (!teamBySourceId2025.has(p.source_player_id)) {
      teamBySourceId2025.set(p.source_player_id, { team: p.Team ?? null, conference: p.Conference ?? null, teamId: p.TeamID ?? null });
    }
  }

  for (const [sid, rec] of byId.entries()) {
    const t = teamBySourceId2025.get(sid);
    if (t) {
      rec.team = t.team;
      rec.conference = t.conference;
      rec.source_team_id = t.teamId;
    } else {
      // Player has no 2025 row — they're a departed player. Clear roster fields
      // so they don't pollute current rosters; profile lookups still work via id.
      rec.team = null;
      rec.conference = null;
      rec.source_team_id = null;
    }
  }

  // ─── Two-way player detection ────────────────────────────────────────
  // Tag as TWP when the player has meaningful PA on the hitter side (>=10 AB)
  // AND meaningful IP on the pitcher side (>=5 IP) in the preferred season.
  const twoWayHitters = new Set<string>();
  const twoWayPitchers = new Set<string>();
  for (const h of hitterRows) {
    if (Number(h.Season) !== season) continue;
    if (!h.source_player_id) continue;
    if ((Number(h.ab) || 0) >= 10) twoWayHitters.add(h.source_player_id);
  }
  for (const p of pitcherRows) {
    if (Number(p.Season) !== season) continue;
    if (!p.source_player_id) continue;
    if ((Number(p.IP) || 0) >= 5) twoWayPitchers.add(p.source_player_id);
  }
  for (const [sid, rec] of byId.entries()) {
    if (twoWayHitters.has(sid) && twoWayPitchers.has(sid)) {
      rec.position = "TWP";
    }
  }

  // ─── Build final insert payload ──────────────────────────────────────
  const allRecs = [...byId.values(), ...anon];
  const inserts = allRecs.map((r) => ({
    first_name: r.first_name,
    last_name: r.last_name,
    team: r.team,
    conference: r.conference,
    position: r.position,
    bats_hand: r.bats_hand,
    throws_hand: r.throws_hand,
    source_player_id: r.source_player_id,
    source_team_id: r.source_team_id,
    transfer_portal: false,
    from_team: r.team,
    pa: r.pa,
    ab: r.ab,
    ip: r.ip,
    g: r.g,
    gs: r.gs,
  }));

  console.log(`[syncMaster] Inserting ${inserts.length} unique players (across all seasons)...`);
  for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
    const chunk = inserts.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("players").insert(chunk);
    if (error) {
      result.errors.push(`Insert chunk ${i}: ${error.message}`);
    } else {
      // Split the count between the two buckets for the existing UI label
      for (const c of chunk) {
        // crude classification: if position is SP/RP/P we call it a pitcher
        if (c.position === "SP" || c.position === "RP" || c.position === "P") {
          result.pitchersInserted++;
        } else {
          result.hittersInserted++;
        }
      }
    }
  }

  console.log(`[syncMaster] Done! Total: ${inserts.length} players (${result.hittersInserted} hitters, ${result.pitchersInserted} pitchers)`, result);
  return result;
}
