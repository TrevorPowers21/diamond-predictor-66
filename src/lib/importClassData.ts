import { supabase } from "@/integrations/supabase/client";

type ImportResult = {
  rowsParsed: number;
  playersUpdated: number;
  predictionsUpdated: number;
  notFound: number;
  noChange: number;
  errors: string[];
};

const CLASS_TO_TRANSITION: Record<string, "FS" | "SJ" | "JS" | "GR"> = {
  FR: "FS",
  SO: "SJ",
  JR: "JS",
  SR: "GR",
  GR: "GR",
};

type Row = {
  sourcePlayerId: string;
  classYear: string | null;
  batsHand: string | null;
  throwsHand: string | null;
};

function normalizeClass(v: string | undefined): string | null {
  if (!v) return null;
  let x = v.trim().toUpperCase();
  if (!x) return null;
  // Strip redshirt prefixes: "R-JR", "RS-JR", "R JR" → "JR".
  // Redshirt status doesn't change school year for projection purposes.
  x = x.replace(/^(RS?-?\s*)+/, "").trim();
  if (x === "FR" || x === "SO" || x === "JR" || x === "SR" || x === "GR") return x;
  if (x === "FRESHMAN" || x === "FRESH") return "FR";
  if (x === "SOPHOMORE" || x === "SOPH") return "SO";
  if (x === "JUNIOR") return "JR";
  if (x === "SENIOR") return "SR";
  if (x === "GRADUATE" || x === "GRAD" || x === "GS") return "GR";
  return x;
}

function normalizeHand(v: string | undefined): string | null {
  if (!v) return null;
  const x = v.trim().toUpperCase();
  if (x === "R" || x === "L" || x === "S" || x === "B") return x;
  if (x === "RIGHT") return "R";
  if (x === "LEFT") return "L";
  if (x === "SWITCH") return "S";
  return null;
}

export async function importClassDataFromCsv(csvText: string): Promise<ImportResult> {
  const result: ImportResult = { rowsParsed: 0, playersUpdated: 0, predictionsUpdated: 0, notFound: 0, noChange: 0, errors: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    result.errors.push("CSV has no data rows");
    return result;
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("playerid");
  const classIdx = header.indexOf("classyear");
  const batsIdx = header.indexOf("batshand");
  const throwsIdx = header.indexOf("throwshand");

  if (idIdx === -1) {
    result.errors.push(`Missing required column "playerId". Found: ${header.join(", ")}`);
    return result;
  }
  if (classIdx === -1 && batsIdx === -1 && throwsIdx === -1) {
    result.errors.push(`Need at least one of: ClassYear, batsHand, throwsHand`);
    return result;
  }

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const sourcePlayerId = cols[idIdx];
    if (!sourcePlayerId) continue;
    rows.push({
      sourcePlayerId,
      classYear: classIdx >= 0 ? normalizeClass(cols[classIdx]) : null,
      batsHand: batsIdx >= 0 ? normalizeHand(cols[batsIdx]) : null,
      throwsHand: throwsIdx >= 0 ? normalizeHand(cols[throwsIdx]) : null,
    });
  }
  result.rowsParsed = rows.length;
  console.log(`[importClassData] Parsed ${rows.length} rows from CSV`);

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (row) => {
        const update: Record<string, string | null> = {};
        if (row.classYear) update.class_year = row.classYear;
        if (row.batsHand) update.bats_hand = row.batsHand;
        if (row.throwsHand) update.throws_hand = row.throwsHand;
        if (Object.keys(update).length === 0) {
          result.noChange++;
          return;
        }

        const { data, error } = await supabase
          .from("players")
          .update(update)
          .eq("source_player_id", row.sourcePlayerId)
          .select("id");

        if (error) {
          result.errors.push(`${row.sourcePlayerId}: ${error.message}`);
        } else if (!data || data.length === 0) {
          result.notFound++;
        } else {
          result.playersUpdated += data.length;

          // Propagate class_year to class_transition on every prediction for
          // this player. The CSV is the source of truth, so this overrides any
          // prior auto-inferred or manually-set transitions.
          //
          // Locked predictions: the protect_locked_predictions trigger silently
          // drops writes to locked rows, so we unlock-then-update-then-relock
          // (mirrors inferAllClassTransitions). Without this, ~3% of predictions
          // silently fail to update on import.
          if (row.classYear) {
            const transition = CLASS_TO_TRANSITION[row.classYear];
            if (transition) {
              const playerIds = data.map((r: any) => r.id).filter(Boolean);
              for (const pid of playerIds) {
                const { data: predRows, error: predFetchErr } = await supabase
                  .from("player_predictions")
                  .select("id, locked")
                  .eq("player_id", pid);
                if (predFetchErr) {
                  result.errors.push(`pred-fetch ${row.sourcePlayerId}: ${predFetchErr.message}`);
                  continue;
                }
                if (!predRows || predRows.length === 0) continue;
                for (const pred of predRows as any[]) {
                  const wasLocked = !!pred.locked;
                  if (wasLocked) {
                    const { error: unlockErr } = await supabase
                      .from("player_predictions")
                      .update({ locked: false })
                      .eq("id", pred.id);
                    if (unlockErr) {
                      result.errors.push(`unlock ${row.sourcePlayerId}: ${unlockErr.message}`);
                      continue;
                    }
                  }
                  const { error: updErr } = await supabase
                    .from("player_predictions")
                    .update({ class_transition: transition, locked: wasLocked })
                    .eq("id", pred.id);
                  if (updErr) {
                    result.errors.push(`update ${row.sourcePlayerId}: ${updErr.message}`);
                  } else {
                    result.predictionsUpdated++;
                  }
                }
              }
            }
          }
        }
      })
    );
  }

  console.log(`[importClassData] Done`, result);
  return result;
}
