/**
 * Bulk job: infer class_transition for all returner player_predictions based
 * on how many years a player has been in the system. Skips rows the coach has
 * manually overridden.
 *
 * Optimized: pre-fetches earliest-season per source_player_id from both master
 * tables in one paginated pass, then writes updates with bounded concurrency.
 */
import { supabase } from "@/integrations/supabase/client";

export type InferResult = {
  updated: number;
  skipped: number;
  errors: number;
};

type InferredClass = "FS" | "SJ" | "JS" | "GR";

function classFromSpan(span: number): InferredClass {
  if (span <= 1) return "FS";
  if (span === 2) return "SJ";
  if (span === 3) return "JS";
  return "GR";
}

async function fetchAllSeasons(table: "Hitter Master" | "Pitching Master") {
  const out: Array<{ source_player_id: string; Season: number }> = [];
  let from = 0;
  while (true) {
    // Must order for reliable pagination — without it Supabase can return
    // duplicated or skipped rows across pages.
    const { data, error } = await supabase
      .from(table)
      .select("source_player_id, Season")
      .order("source_player_id", { ascending: true })
      .order("Season", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      if (r.source_player_id != null && r.Season != null) {
        out.push({ source_player_id: r.source_player_id, Season: Number(r.Season) });
      }
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export async function inferAllClassTransitions(season = 2025): Promise<InferResult> {
  const result: InferResult = { updated: 0, skipped: 0, errors: 0 };

  // 1) Pre-fetch earliest season per source_player_id from BOTH master tables.
  console.log("[inferClass] Pre-fetching season history...");
  const [hitterSeasons, pitcherSeasons] = await Promise.all([
    fetchAllSeasons("Hitter Master"),
    fetchAllSeasons("Pitching Master"),
  ]);
  const earliestBySourceId = new Map<string, number>();
  for (const r of [...hitterSeasons, ...pitcherSeasons]) {
    const cur = earliestBySourceId.get(r.source_player_id);
    if (cur == null || r.Season < cur) earliestBySourceId.set(r.source_player_id, r.Season);
  }
  console.log(`[inferClass] Indexed ${earliestBySourceId.size} unique players`);

  // 2) Fetch all returner predictions joined with players.source_player_id, paginated.
  console.log("[inferClass] Fetching predictions...");
  const allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: rows, error } = await supabase
      .from("player_predictions")
      .select("id, class_transition, class_transition_overridden, players!inner(source_player_id)")
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .eq("season", season)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  console.log(`[inferClass] ${allRows.length} predictions to evaluate`);

  // 3) Build the update plan in memory (no DB calls).
  const updates: Array<{ id: string; cls: InferredClass }> = [];
  for (const row of allRows as any[]) {
    if (row.class_transition_overridden) { result.skipped++; continue; }
    const sourceId = row.players?.source_player_id;
    if (!sourceId) { result.skipped++; continue; }
    const earliest = earliestBySourceId.get(sourceId);
    if (earliest == null) { result.skipped++; continue; }
    const span = season - earliest + 1;
    const cls = classFromSpan(span);
    if (cls === row.class_transition) { result.skipped++; continue; }
    updates.push({ id: row.id, cls });
  }
  console.log(`[inferClass] ${updates.length} updates needed`);

  // 4) Write updates with unlock-then-update (the protect_locked_predictions
  // trigger silently drops writes to locked rows, so we must unlock first).
  await runWithConcurrency(updates, 25, async (u) => {
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: unlockErr } = await supabase
        .from("player_predictions")
        .update({ locked: false })
        .eq("id", u.id);
      if (unlockErr) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      const { error: updErr } = await supabase
        .from("player_predictions")
        .update({ class_transition: u.cls, locked: true })
        .eq("id", u.id);
      if (!updErr) { success = true; break; }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (success) {
      result.updated++;
    } else {
      console.error(`[inferClass] update failed for ${u.id}`);
      result.errors++;
    }
  });

  console.log(`[inferClass] Done.`, result);
  return result;
}
