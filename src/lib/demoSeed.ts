import { supabase } from "@/integrations/supabase/client";

/**
 * Seeds the "RSTR IQ All-American" demo data with a hand-picked roster.
 * Resolves each name against the players table, builds a team_builds row,
 * inserts team_build_players for the lineup + pitching staff, and drops
 * the target-board names into target_board.
 *
 * Idempotent — re-running clears and re-seeds for the same user.
 */

export const ALL_STAR_BUILD_NAME = "RSTR IQ All-American 2026";
export const ALL_STAR_TEAM = "RSTR IQ All-Americans";

type RosterEntry = { first: string; last: string; slot: string };

// Hand-picked hitter lineup: top pick per position
const ROSTER_HITTERS: RosterEntry[] = [
  { first: "Carson",      last: "Tinney",      slot: "C"  },
  { first: "Zach",        last: "Yorke",       slot: "1B" },
  { first: "Kaleb",       last: "Freeman",     slot: "2B" },
  { first: "Henry",       last: "Ford",        slot: "3B" },
  { first: "Christopher", last: "Hacopian",    slot: "SS" },
  { first: "Jordy",       last: "Oriach",      slot: "OF" },
  { first: "Cole",        last: "Koniarsky",   slot: "OF" },
  { first: "Konni",       last: "Durschlag",   slot: "OF" },
];

// Pitching staff — role defaults to SP; classification is refined below using
// 2025 GS/G from Pitching Master.
const ROSTER_PITCHERS: Array<{ first: string; last: string }> = [
  { first: "Jackson", last: "Flora"     },
  { first: "Tyler",   last: "Bremner"   },
  { first: "Liam",    last: "Doyle"     },
  { first: "Blake",   last: "Gillespie" },
  { first: "Trey",    last: "Beard"     },
  { first: "Kade",    last: "Anderson"  },
  { first: "Chase",   last: "Shores"    },
];

const TARGET_NAMES: Array<{ first: string; last: string }> = [
  { first: "Jack",    last: "Arcamone"  },  // C
  { first: "Joe",     last: "Tiroly"    },  // 2B
  { first: "Roch",    last: "Cholowsky" },  // SS
  { first: "Aiden",   last: "Robbins"   },  // OF
  { first: "Brayden", last: "Simpson"   },  // OF
];

export type SeedResult = {
  build_id: string;
  roster_count: number;
  target_count: number;
  skipped_positions: string[];
};

/**
 * Finds a single player by fuzzy first+last match. Returns null if nothing
 * found; returns the richest match (with source_player_id) when ambiguous.
 */
async function findPlayerId(first: string, last: string): Promise<{ id: string; source_player_id: string | null } | null> {
  const { data } = await supabase
    .from("players")
    .select("id, first_name, last_name, source_player_id, position")
    .ilike("first_name", first)
    .ilike("last_name", last);
  const rows = (data || []) as Array<{ id: string; first_name: string | null; last_name: string | null; source_player_id: string | null; position: string | null }>;
  if (rows.length === 0) return null;
  // Prefer rows that have a source_player_id (i.e., they're in the master tables)
  const withSource = rows.filter((r) => r.source_player_id);
  const pool = withSource.length > 0 ? withSource : rows;
  return { id: pool[0].id, source_player_id: pool[0].source_player_id };
}

export async function seedAllStarDemoData(userId: string): Promise<SeedResult> {
  const skipped: string[] = [];

  // ─── Ensure synthetic Teams Table entry exists ──────────────────────────
  const { data: existingTeam } = await (supabase as any)
    .from("Teams Table")
    .select("id")
    .eq("full_name", ALL_STAR_TEAM)
    .maybeSingle();

  if (!existingTeam) {
    const { data: secRow } = await supabase
      .from("Conference Names")
      .select("id")
      .eq("conference abbreviation", "SEC")
      .maybeSingle();

    const { error: teamInsertErr } = await (supabase as any)
      .from("Teams Table")
      .insert({
        full_name: ALL_STAR_TEAM,
        abbreviation: "ALL",
        season: 2025,
        conference: "SEC",
        conference_id: secRow?.id ?? null,
      });
    if (teamInsertErr) {
      console.warn("Could not create synthetic Teams Table row:", teamInsertErr.message);
    }
  }

  // ─── Resolve all player names to IDs ────────────────────────────────────
  const rosterResolved: Array<{ slot: string; player_id: string }> = [];
  for (const entry of ROSTER_HITTERS) {
    const hit = await findPlayerId(entry.first, entry.last);
    if (!hit) {
      skipped.push(`${entry.slot}: ${entry.first} ${entry.last}`);
      continue;
    }
    rosterResolved.push({ slot: entry.slot, player_id: hit.id });
  }

  // Resolve pitchers + classify SP/RP from Pitching Master GS/G
  const pitcherResolutions: Array<{ source_player_id: string | null; player_id: string; first: string; last: string }> = [];
  for (const entry of ROSTER_PITCHERS) {
    const hit = await findPlayerId(entry.first, entry.last);
    if (!hit) {
      skipped.push(`P: ${entry.first} ${entry.last}`);
      continue;
    }
    pitcherResolutions.push({
      source_player_id: hit.source_player_id,
      player_id: hit.id,
      first: entry.first,
      last: entry.last,
    });
  }

  const pitcherSourceIds = pitcherResolutions.map((p) => p.source_player_id).filter(Boolean) as string[];
  let pmBySourceId = new Map<string, { gs: number; g: number }>();
  if (pitcherSourceIds.length > 0) {
    const { data: pmRows } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, GS, G")
      .eq("Season", 2025)
      .in("source_player_id", pitcherSourceIds);
    for (const r of (pmRows || [])) {
      if (!r.source_player_id) continue;
      pmBySourceId.set(r.source_player_id, { gs: Number(r.GS) || 0, g: Number(r.G) || 0 });
    }
  }

  for (const p of pitcherResolutions) {
    const pmInfo = p.source_player_id ? pmBySourceId.get(p.source_player_id) : null;
    const gs = pmInfo?.gs ?? 0;
    const g = pmInfo?.g ?? 0;
    const isStarter = gs >= 5 && g > 0 && (gs / g) >= 0.5;
    rosterResolved.push({ slot: isStarter ? "SP" : "RP", player_id: p.player_id });
  }

  // ─── Delete old build (idempotent) ──────────────────────────────────────
  const { data: existingBuilds } = await supabase
    .from("team_builds")
    .select("id")
    .eq("user_id", userId)
    .eq("name", ALL_STAR_BUILD_NAME);
  for (const b of (existingBuilds || [])) {
    await supabase.from("team_build_players").delete().eq("build_id", b.id);
    await supabase.from("team_builds").delete().eq("id", b.id);
  }

  // ─── Create team_builds row ─────────────────────────────────────────────
  const { data: createdBuild, error: buildErr } = await supabase
    .from("team_builds")
    .insert({
      user_id: userId,
      name: ALL_STAR_BUILD_NAME,
      team: ALL_STAR_TEAM,
      season: 2026,
      total_budget: 1_000_000,
      notes: "Hand-picked demo roster.",
    })
    .select("id")
    .single();
  if (buildErr || !createdBuild) throw buildErr || new Error("Failed to create build");

  // ─── Insert roster members ──────────────────────────────────────────────
  const memberRows = rosterResolved.map((r, i) => ({
    build_id: createdBuild.id,
    player_id: r.player_id,
    position_slot: r.slot,
    depth_order: i + 1,
    source: "returner" as const,
    nil_value: null,
  }));
  if (memberRows.length > 0) {
    const { error: membersErr } = await supabase.from("team_build_players").insert(memberRows);
    if (membersErr) throw membersErr;
  }

  // ─── Target Board ───────────────────────────────────────────────────────
  await (supabase as any).from("target_board").delete().eq("user_id", userId);

  const targetRows: Array<{ user_id: string; player_id: string }> = [];
  for (const entry of TARGET_NAMES) {
    const hit = await findPlayerId(entry.first, entry.last);
    if (!hit) {
      skipped.push(`TARGET: ${entry.first} ${entry.last}`);
      continue;
    }
    targetRows.push({ user_id: userId, player_id: hit.id });
  }
  if (targetRows.length > 0) {
    const { error: tbErr } = await (supabase as any).from("target_board").insert(targetRows);
    if (tbErr) throw tbErr;
  }

  return {
    build_id: createdBuild.id,
    roster_count: rosterResolved.length,
    target_count: targetRows.length,
    skipped_positions: skipped,
  };
}
