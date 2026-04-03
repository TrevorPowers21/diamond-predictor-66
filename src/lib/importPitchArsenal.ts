import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  pitchesImported: number;
  playersProcessed: number;
  stuffPlusUpdated: number;
  errors: string[];
};

// Pitch type column patterns — each pitch has 4 columns: label, total, whiff%, stuff+
const PITCH_TYPES = [
  { name: "4S FB", rhpStart: "4S FB RHP", lhpStart: "4S FB LHP" },
  { name: "Sinker", rhpStart: "Sinker RHP", lhpStart: "Sinker LHP" },
  { name: "Cutter", rhpStart: "Cutter RHP", lhpStart: "Cutter LHP" },
  { name: "Slider", rhpStart: "Slider RHP", lhpStart: "Slider LHP" },
  { name: "Curveball", rhpStart: "Curveball RHP", lhpStart: "Curveball LHP" },
  { name: "Change-Up", rhpStart: "Change-Up RHP", lhpStart: "Change-Up LHP" },
  { name: "Splitter", rhpStart: "Splitter RHP", lhpStart: "Splitter LHP" },
  { name: "Sweeper", rhpStart: "Sweeper RHP", lhpStart: "Sweeper LHP" },
];

function parseNum(v: string | undefined): number | null {
  if (!v || v === "-" || v.trim() === "") return null;
  const cleaned = v.replace(/[%,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function importPitchArsenalFromCsv(csvText: string, season = 2025): Promise<ImportResult> {
  const result: ImportResult = { pitchesImported: 0, playersProcessed: 0, stuffPlusUpdated: 0, errors: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { result.errors.push("No data rows"); return result; }

  const header = lines[0].split(",").map((h) => h.trim());

  // Find column indices for each pitch type
  const pitchColMap: Array<{
    pitchType: string;
    hand: "RHP" | "LHP";
    labelIdx: number;
    totalIdx: number;
    whiffIdx: number;
    stuffIdx: number;
  }> = [];

  for (const pt of PITCH_TYPES) {
    for (const variant of [
      { hand: "RHP" as const, label: pt.rhpStart },
      { hand: "LHP" as const, label: pt.lhpStart },
    ]) {
      const labelIdx = header.indexOf(variant.label);
      if (labelIdx >= 0) {
        pitchColMap.push({
          pitchType: pt.name,
          hand: variant.hand,
          labelIdx,
          totalIdx: labelIdx + 1,
          whiffIdx: labelIdx + 2,
          stuffIdx: labelIdx + 3,
        });
      }
    }
  }

  // Find Player ID, Player Name, Total Pitches, Overall Stuff+ columns
  const playerIdIdx = header.indexOf("Player ID");
  const playerNameIdx = header.indexOf("Player Name");
  const totalPitchesIdx = header.indexOf("Total Pitches");
  const overallStuffIdx = header.indexOf("Overall Stuff+");

  if (playerNameIdx === -1) { result.errors.push("Missing 'Player Name' column"); return result; }

  // Clear existing data for this season
  console.log("[importArsenal] Clearing existing pitch arsenal data...");
  await supabase.from("Pitch Arsenal").delete().eq("season", season);

  // Parse and insert
  const allRows: any[] = [];
  const stuffPlusUpdates: Array<{ sourcePlayerId: string; overallStuffPlus: number }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const playerName = cols[playerNameIdx];
    const playerId = playerIdIdx >= 0 ? cols[playerIdIdx] : null;
    const totalPitchesAll = totalPitchesIdx >= 0 ? parseNum(cols[totalPitchesIdx]) : null;
    const overallStuff = overallStuffIdx >= 0 ? parseNum(cols[overallStuffIdx]) : null;

    if (!playerName) continue;

    // Track for Pitching Master update
    if (playerId && overallStuff != null) {
      stuffPlusUpdates.push({ sourcePlayerId: playerId, overallStuffPlus: overallStuff });
    }

    // Extract each pitch type
    for (const pc of pitchColMap) {
      const label = cols[pc.labelIdx];
      if (!label || label.trim() === "") continue; // Skip empty pitch types

      const total = parseNum(cols[pc.totalIdx]);
      const whiff = parseNum(cols[pc.whiffIdx]);
      const stuff = parseNum(cols[pc.stuffIdx]);

      if (total == null && whiff == null && stuff == null) continue;

      allRows.push({
        source_player_id: playerId,
        player_name: playerName,
        season,
        pitch_type: pc.pitchType,
        hand: pc.hand,
        total_pitches: total,
        whiff_pct: whiff,
        stuff_plus: stuff,
        overall_stuff_plus: overallStuff,
        total_pitches_all: totalPitchesAll ? Math.round(totalPitchesAll) : null,
      });
    }
    result.playersProcessed++;
  }

  console.log(`[importArsenal] Inserting ${allRows.length} pitch rows for ${result.playersProcessed} players...`);

  // Insert in chunks
  const CHUNK = 200;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("Pitch Arsenal").insert(chunk);
    if (error) {
      result.errors.push(`Chunk ${i}: ${error.message}`);
    } else {
      result.pitchesImported += chunk.length;
    }
  }

  // Update Pitching Master with Overall Stuff+
  console.log(`[importArsenal] Updating ${stuffPlusUpdates.length} pitchers with Overall Stuff+ on Pitching Master...`);
  const BATCH_SP = 50;
  for (let i = 0; i < stuffPlusUpdates.length; i += BATCH_SP) {
    const batch = stuffPlusUpdates.slice(i, i + BATCH_SP);
    await Promise.all(batch.map(async (row) => {
      const { error } = await supabase
        .from("Pitching Master")
        .update({ stuff_plus: row.overallStuffPlus })
        .eq("source_player_id", row.sourcePlayerId)
        .eq("Season", season);
      if (error) {
        result.errors.push(`PM ${row.sourcePlayerId}: ${error.message}`);
      } else {
        result.stuffPlusUpdated++;
      }
    }));
  }

  console.log(`[importArsenal] Done! ${result.stuffPlusUpdated} Pitching Master rows updated with Stuff+`, result);
  return result;
}
