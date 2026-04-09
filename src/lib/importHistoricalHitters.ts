import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: string[];
  teamsResolved: number;
  teamsUnresolved: string[];
};

/**
 * Import historical hitter data from the source CSV format.
 * Maps source columns to Hitter Master schema and inserts with the given season.
 * Does NOT clear existing data for that season — use upsert by source_player_id + Season.
 */
export async function importHistoricalHittersCsv(csvText: string, season: number): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, skipped: 0, errors: [], teamsResolved: 0, teamsUnresolved: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { result.errors.push("CSV has no data rows"); return result; }

  // Parse header
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  // Quote-aware CSV row parser (handles commas inside quoted fields like "Texas A&M, College Station")
  const parseCsvRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const col = (name: string) => {
    const idx = header.indexOf(name);
    return idx;
  };

  const iPlayerId = col("playerId");
  const iFullName = col("playerFullName");
  const iTeamLocation = col("newestTeamLocation");
  const iTeamId = col("newestTeamId");
  const iPos = col("pos");
  const iBatsHand = col("batsHand");
  const iThrowsHand = col("throwsHand");
  const iAB = col("AB");
  const iPA = col("PA");
  const iAVG = col("AVG");
  const iOBP = col("OBP");
  const iSLG = col("SLG");
  const iISO = col("ISO");
  const iContact = col("Contact%");
  const iLine = col("Line%");
  const iExitVel = col("ExitVel");
  const iPopup = col("Popup%");
  const iBB = col("BB%");
  const iChase = col("Chase%");
  const iBarrel = col("Barrel%");
  const iEv90 = col("90thExitVel");
  const iPull = col("HPull%");
  const iLA = col("LA10-30%");
  const iGround = col("Ground%");

  if (iPlayerId === -1 || iFullName === -1) {
    result.errors.push(`Missing required columns. Need: playerId, playerFullName. Found: ${header.join(", ")}`);
    return result;
  }

  // Load Teams Table for conference resolution
  const { data: teams } = await supabase.from("Teams Table").select("id, full_name, abbreviation, conference, conference_id, source_id");
  type TeamEntry = { id: string; conference: string | null; conference_id: string | null };
  const teamByKey = new Map<string, TeamEntry>();
  for (const t of (teams || [])) {
    const entry: TeamEntry = { id: t.id, conference: t.conference, conference_id: t.conference_id };
    if (t.abbreviation) teamByKey.set(t.abbreviation.toLowerCase().trim(), entry);
    teamByKey.set(t.full_name.toLowerCase().trim(), entry);
    // Also index by source_id for numeric team ID lookups
    if ((t as any).source_id) teamByKey.set(String((t as any).source_id), entry);
  }

  const stripPct = (val: string | undefined): number | null => {
    if (!val) return null;
    const cleaned = val.replace(/%/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const parseNum = (val: string | undefined): number | null => {
    if (!val) return null;
    const cleaned = val.replace(/[%,$]/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  // Parse rows
  const rows: any[] = [];
  const unresolvedTeams = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    // Handle CSV fields that might contain commas in quotes
    const cols = parseCsvRow(lines[i]);

    const sourcePlayerId = cols[iPlayerId];
    const fullName = cols[iFullName];
    if (!sourcePlayerId || !fullName) continue;

    const teamLocation = cols[iTeamLocation] || "";
    const teamId = cols[iTeamId] || "";
    const teamLookupKey = teamLocation.toLowerCase().trim();
    // Try by name first, then by source team ID
    const teamInfo = teamByKey.get(teamLookupKey) || teamByKey.get(teamId);

    if (teamLocation && !teamInfo) {
      unresolvedTeams.add(teamLocation);
    } else if (teamInfo) {
      result.teamsResolved++;
    }

    rows.push({
      source_player_id: sourcePlayerId,
      playerFullName: fullName,
      Team: teamLocation || null,
      TeamID: teamInfo?.id || null,
      Conference: teamInfo?.conference || null,
      conference_id: teamInfo?.conference_id || null,
      Season: season,
      Pos: cols[iPos] || null,
      BatHand: cols[iBatsHand] || null,
      ThrowHand: cols[iThrowsHand] || null,
      pa: parseNum(cols[iPA]),
      ab: parseNum(cols[iAB]),
      AVG: parseNum(cols[iAVG]),
      OBP: parseNum(cols[iOBP]),
      SLG: parseNum(cols[iSLG]),
      ISO: parseNum(cols[iISO]),
      contact: stripPct(cols[iContact]),
      line_drive: stripPct(cols[iLine]),
      avg_exit_velo: parseNum(cols[iExitVel]),
      pop_up: stripPct(cols[iPopup]),
      bb: stripPct(cols[iBB]),
      chase: stripPct(cols[iChase]),
      barrel: stripPct(cols[iBarrel]),
      ev90: parseNum(cols[iEv90]),
      pull: stripPct(cols[iPull]),
      la_10_30: stripPct(cols[iLA]),
      gb: stripPct(cols[iGround]),
    });
  }

  console.log(`[importHistorical] Parsed ${rows.length} rows for season ${season}`);
  result.teamsUnresolved = [...unresolvedTeams].sort();

  // Delete existing data for this season only to avoid duplicates
  console.log(`[importHistorical] Clearing existing ${season} data...`);
  const { error: clearErr } = await supabase
    .from("Hitter Master")
    .delete()
    .eq("Season", season);
  if (clearErr) {
    result.errors.push(`Failed to clear season ${season}: ${clearErr.message}`);
    return result;
  }

  // Insert in chunks
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("Hitter Master").insert(chunk);
    if (error) {
      result.errors.push(`Chunk ${i}: ${error.message}`);
      // Try one by one
      for (const row of chunk) {
        const { error: e2 } = await supabase.from("Hitter Master").insert([row]);
        if (e2) {
          result.errors.push(`Row ${row.source_player_id} (${row.playerFullName}): ${e2.message}`);
          result.skipped++;
        } else {
          result.inserted++;
        }
      }
    } else {
      result.inserted += chunk.length;
    }
  }

  console.log(`[importHistorical] Done! Inserted: ${result.inserted}, Skipped: ${result.skipped}`);

  // Junk-twin cleanup: delete the meaningless 0-AB hitter rows for true pitchers,
  // and the meaningless 0-IP pitcher rows for true hitters, in this season.
  await pruneJunkTwins(season);

  return result;
}

/**
 * Remove the junk twin rows created by importing the same source CSV into both
 * Hitter Master and Pitching Master:
 *  - 0-AB hitter rows whose source_player_id has IP > 0 in Pitching Master
 *  - 0-IP pitcher rows whose source_player_id has AB > 0 in Hitter Master
 *
 * Players with no meaningful record on either side (true 0/0 redshirts) are
 * preserved in both tables so class transition inference still works.
 */
export async function pruneJunkTwins(season: number): Promise<void> {
  // 1) Pull all source_player_ids in Pitching Master with IP > 0 for this season
  const pitcherIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id")
      .eq("Season", season)
      .gt("IP", 0)
      .range(from, from + 999);
    if (error) {
      console.error("[pruneJunkTwins] failed listing real pitchers", error);
      break;
    }
    for (const r of data || []) {
      const sid = (r as any).source_player_id;
      if (sid) pitcherIds.add(sid);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // 2) Pull all source_player_ids in Hitter Master with ab > 0 for this season
  const hitterIds = new Set<string>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id")
      .eq("Season", season)
      .gt("ab", 0)
      .range(from, from + 999);
    if (error) {
      console.error("[pruneJunkTwins] failed listing real hitters", error);
      break;
    }
    for (const r of data || []) {
      const sid = (r as any).source_player_id;
      if (sid) hitterIds.add(sid);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // 3) Delete junk hitter rows (0/null AB) for source_player_ids that are real pitchers
  let deletedHitters = 0;
  const pitcherIdList = [...pitcherIds];
  for (let i = 0; i < pitcherIdList.length; i += 200) {
    const chunk = pitcherIdList.slice(i, i + 200);
    const { error, count } = await supabase
      .from("Hitter Master")
      .delete({ count: "exact" })
      .eq("Season", season)
      .or("ab.is.null,ab.eq.0")
      .in("source_player_id", chunk);
    if (error) {
      console.error("[pruneJunkTwins] hitter delete chunk failed", error);
    } else {
      deletedHitters += count || 0;
    }
  }

  // 4) Delete junk pitcher rows (0/null IP) for source_player_ids that are real hitters
  let deletedPitchers = 0;
  const hitterIdList = [...hitterIds];
  for (let i = 0; i < hitterIdList.length; i += 200) {
    const chunk = hitterIdList.slice(i, i + 200);
    const { error, count } = await supabase
      .from("Pitching Master")
      .delete({ count: "exact" })
      .eq("Season", season)
      .or("IP.is.null,IP.eq.0")
      .in("source_player_id", chunk);
    if (error) {
      console.error("[pruneJunkTwins] pitcher delete chunk failed", error);
    } else {
      deletedPitchers += count || 0;
    }
  }

  console.log(`[pruneJunkTwins] season=${season} deletedHitters=${deletedHitters} deletedPitchers=${deletedPitchers}`);
}
