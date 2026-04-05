import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  updated: number;
  notFound: number;
  errors: string[];
};

/**
 * Update 90th_vel (EV90 - 90th percentile exit velocity against) on Pitching Master
 * from a CSV with playerId and 90thExitVel columns.
 */
export async function importPitcherEv90FromCsv(csvText: string, season = 2025): Promise<ImportResult> {
  const result: ImportResult = { updated: 0, notFound: 0, errors: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { result.errors.push("CSV has no data rows"); return result; }

  const header = lines[0].split(",").map((h) => h.trim());
  const iPlayerId = header.indexOf("playerId");
  const iEv90 = header.indexOf("90thExitVel");

  if (iPlayerId === -1 || iEv90 === -1) {
    result.errors.push(`Missing columns. Need: playerId, 90thExitVel. Found: ${header.join(", ")}`);
    return result;
  }

  const rows: Array<{ sourcePlayerId: string; ev90: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const pid = cols[iPlayerId];
    const val = cols[iEv90]?.replace(/-/g, "").trim();
    if (!pid || !val) continue;
    const num = Number(val);
    if (!Number.isFinite(num)) continue;
    rows.push({ sourcePlayerId: pid, ev90: num });
  }

  console.log(`[importEv90] Parsed ${rows.length} rows`);

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async (row) => {
      const { data, error } = await supabase
        .from("Pitching Master")
        .update({ "90th_vel": row.ev90 })
        .eq("source_player_id", row.sourcePlayerId)
        .eq("Season", season)
        .select("id");

      if (error) {
        result.errors.push(`${row.sourcePlayerId}: ${error.message}`);
      } else if (!data || data.length === 0) {
        result.notFound++;
      } else {
        result.updated++;
      }
    }));
  }

  console.log(`[importEv90] Done! Updated: ${result.updated}, Not found: ${result.notFound}`);
  return result;
}
