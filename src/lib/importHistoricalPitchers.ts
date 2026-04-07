import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: string[];
  teamsResolved: number;
  teamsUnresolved: string[];
};

/**
 * Import historical pitcher data from the source CSV format.
 * Maps source columns to Pitching Master schema and inserts with the given season.
 * Clears existing data for that season before importing.
 */
export async function importHistoricalPitchersCsv(csvText: string, season: number): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, skipped: 0, errors: [], teamsResolved: 0, teamsUnresolved: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { result.errors.push("CSV has no data rows"); return result; }

  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

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
  const col = (name: string) => header.indexOf(name);
  // Try multiple possible column names
  const colAny = (...names: string[]) => {
    for (const n of names) { const i = col(n); if (i >= 0) return i; }
    return -1;
  };

  const iPlayerId = colAny("playerId", "PlayerId", "playerID");
  const iFullName = colAny("playerFullName", "PlayerFullName", "player");
  const iTeamLocation = colAny("newestTeamLocation", "TeamLocation", "Team");
  const iTeamId = colAny("newestTeamId", "TeamId", "teamId");
  const iThrowHand = colAny("throwsHand", "ThrowHand", "throwHand");
  const iRole = colAny("Role", "role", "pos");
  const iIP = colAny("IP", "ip");
  const iG = colAny("G", "g", "Games");
  const iGS = colAny("GS", "gs", "GamesStarted");
  const iERA = colAny("ERA", "era");
  const iFIP = colAny("FIP", "fip");
  const iWHIP = colAny("WHIP", "whip");
  const iK9 = colAny("K9", "k9", "K/9");
  const iBB9 = colAny("BB9", "bb9", "BB/9");
  const iHR9 = colAny("HR9", "hr9", "HR/9");
  // Scouting metrics
  const iMissPct = colAny("Whiff%", "Miss%", "miss_pct", "WhiffPct");
  const iBBPct = colAny("BB%", "BBPct", "bb_pct");
  const iHHPct = colAny("HardHit%", "HardHitPct", "hard_hit_pct");
  const iIZWhiff = colAny("IZWhiff%", "InZoneWhiff%", "in_zone_whiff_pct");
  const iChasePct = colAny("Chase%", "ChasePct", "chase_pct");
  const iBarrelPct = colAny("Barrel%", "BarrelPct", "barrel_pct");
  const iLinePct = colAny("Line%", "LinePct", "line_pct");
  const iExitVel = colAny("ExitVel", "exit_vel", "AvgEV");
  const iGroundPct = colAny("Ground%", "GroundPct", "ground_pct", "GB%");
  const iIZPct = colAny("Zone%", "InZone%", "in_zone_pct");
  const i90thVel = colAny("90thVel", "90thExitVel", "Velo90th");
  const iPullPct = colAny("HPull%", "PullPct", "h_pull_pct");
  const iLA1030 = colAny("LA10-30%", "LA1030Pct", "la_10_30_pct");
  const iStuffPlus = colAny("Stuff+", "StuffPlus", "stuff_plus");

  if (iPlayerId === -1 || iFullName === -1) {
    result.errors.push(`Missing required columns. Need: playerId, playerFullName. Found: ${header.join(", ")}`);
    return result;
  }

  // Load Teams Table for conference/UUID resolution
  const { data: teams } = await supabase.from("Teams Table").select("id, full_name, abbreviation, conference, conference_id, source_id");
  type TeamEntry = { id: string; conference: string | null; conference_id: string | null };
  const teamByKey = new Map<string, TeamEntry>();
  for (const t of (teams || [])) {
    const entry: TeamEntry = { id: t.id, conference: t.conference, conference_id: t.conference_id };
    if (t.abbreviation) teamByKey.set(t.abbreviation.toLowerCase().trim(), entry);
    teamByKey.set(t.full_name.toLowerCase().trim(), entry);
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
    if (cleaned === "" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  // Baseball IP notation: "70.1" = 70 IP + 1 out (70.333), "70.2" = 70 IP + 2 outs (70.667)
  const parseIp = (val: string | undefined): number | null => {
    if (!val) return null;
    const cleaned = val.trim();
    if (cleaned === "" || cleaned === "-") return null;
    const m = cleaned.match(/^(\d+)(?:\.([012]))?$/);
    if (!m) {
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    const whole = Number(m[1]);
    const frac = m[2] ? Number(m[2]) : 0;
    return Math.round((whole + frac / 3) * 1000) / 1000;
  };

  const getCol = (idx: number, cols: string[]): string | undefined => idx >= 0 ? cols[idx] : undefined;

  const rows: any[] = [];
  const unresolvedTeams = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);

    const sourcePlayerId = cols[iPlayerId];
    const fullName = cols[iFullName];
    if (!sourcePlayerId || !fullName) continue;

    const teamLocation = getCol(iTeamLocation, cols) || "";
    const teamIdRaw = getCol(iTeamId, cols) || "";
    const teamLookupKey = teamLocation.toLowerCase().trim();
    const teamInfo = teamByKey.get(teamLookupKey) || teamByKey.get(teamIdRaw);

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
      ThrowHand: getCol(iThrowHand, cols) || null,
      Role: getCol(iRole, cols) || null,
      IP: parseIp(getCol(iIP, cols)),
      G: parseNum(getCol(iG, cols)),
      GS: parseNum(getCol(iGS, cols)),
      ERA: parseNum(getCol(iERA, cols)),
      FIP: parseNum(getCol(iFIP, cols)),
      WHIP: parseNum(getCol(iWHIP, cols)),
      K9: parseNum(getCol(iK9, cols)),
      BB9: parseNum(getCol(iBB9, cols)),
      HR9: parseNum(getCol(iHR9, cols)),
      miss_pct: stripPct(getCol(iMissPct, cols)),
      bb_pct: stripPct(getCol(iBBPct, cols)),
      hard_hit_pct: stripPct(getCol(iHHPct, cols)),
      in_zone_whiff_pct: stripPct(getCol(iIZWhiff, cols)),
      chase_pct: stripPct(getCol(iChasePct, cols)),
      barrel_pct: stripPct(getCol(iBarrelPct, cols)),
      line_pct: stripPct(getCol(iLinePct, cols)),
      exit_vel: parseNum(getCol(iExitVel, cols)),
      ground_pct: stripPct(getCol(iGroundPct, cols)),
      in_zone_pct: stripPct(getCol(iIZPct, cols)),
      "90th_vel": parseNum(getCol(i90thVel, cols)),
      h_pull_pct: stripPct(getCol(iPullPct, cols)),
      la_10_30_pct: stripPct(getCol(iLA1030, cols)),
      stuff_plus: parseNum(getCol(iStuffPlus, cols)),
    });
  }

  console.log(`[importHistoricalPitchers v2-fractional-IP] Parsed ${rows.length} rows for season ${season}, sample IP:`, rows.slice(0, 3).map(r => r.IP));
  result.teamsUnresolved = [...unresolvedTeams].sort();

  // Safety: never clear 2025 data via historical import
  if (season === 2025) {
    result.errors.push("Cannot import over 2025 data with the historical importer. Use the main import instead.");
    return result;
  }

  // Clear existing data for this season only
  console.log(`[importHistoricalPitchers] Clearing existing ${season} pitching data...`);
  const { error: clearErr } = await supabase.from("Pitching Master").delete().eq("Season", season);
  if (clearErr) {
    result.errors.push(`Failed to clear season ${season}: ${clearErr.message}`);
    return result;
  }

  // Insert in chunks
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("Pitching Master").insert(chunk);
    if (error) {
      result.errors.push(`Chunk ${i}: ${error.message}`);
      for (const row of chunk) {
        const { error: e2 } = await supabase.from("Pitching Master").insert([row]);
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

  console.log(`[importHistoricalPitchers] Done! Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}
