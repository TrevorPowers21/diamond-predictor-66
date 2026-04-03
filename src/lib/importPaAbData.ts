import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  hitterMasterUpdated: number;
  playersUpdated: number;
  notFound: number;
  errors: string[];
};

/**
 * Parse CSV text with PA and AB columns, update Hitter Master and players tables.
 * Matches by playerId (source_player_id).
 */
export async function importPaAbFromCsv(csvText: string): Promise<ImportResult> {
  const result: ImportResult = { hitterMasterUpdated: 0, playersUpdated: 0, notFound: 0, errors: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { result.errors.push("CSV has no data rows"); return result; }

  // Parse header to find column indices
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const playerIdIdx = header.indexOf("playerid");
  const abIdx = header.indexOf("ab");
  const paIdx = header.indexOf("pa");

  if (playerIdIdx === -1 || paIdx === -1) {
    result.errors.push(`Missing required columns. Found: ${header.join(", ")}. Need: playerId, PA`);
    return result;
  }

  // Parse rows
  const rows: Array<{ sourcePlayerId: string; ab: number | null; pa: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const sourcePlayerId = cols[playerIdIdx];
    const paVal = parseInt(cols[paIdx], 10);
    const abVal = abIdx >= 0 ? parseInt(cols[abIdx], 10) : null;
    if (!sourcePlayerId || !Number.isFinite(paVal)) continue;
    rows.push({
      sourcePlayerId,
      ab: abVal != null && Number.isFinite(abVal) ? abVal : null,
      pa: paVal,
    });
  }

  console.log(`[importPaAb] Parsed ${rows.length} rows from CSV`);

  // Update Hitter Master in batches
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async (row) => {
      const update: Record<string, number | null> = { pa: row.pa };
      if (row.ab != null) update.ab = row.ab;

      const { error, count } = await supabase
        .from("Hitter Master")
        .update(update)
        .eq("source_player_id", row.sourcePlayerId)
        .eq("Season", 2025);

      if (error) {
        result.errors.push(`HM ${row.sourcePlayerId}: ${error.message}`);
      } else if (count === 0) {
        result.notFound++;
      } else {
        result.hitterMasterUpdated++;
      }
    }));
  }

  // Update players table
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async (row) => {
      const update: Record<string, number | null> = { pa: row.pa };
      if (row.ab != null) update.ab = row.ab;

      const { error } = await supabase
        .from("players")
        .update(update)
        .eq("source_player_id", row.sourcePlayerId);

      if (error) {
        result.errors.push(`Players ${row.sourcePlayerId}: ${error.message}`);
      } else {
        result.playersUpdated++;
      }
    }));
  }

  console.log(`[importPaAb] Done!`, result);
  return result;
}
