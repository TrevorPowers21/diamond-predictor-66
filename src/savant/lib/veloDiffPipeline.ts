import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PitchRow {
  id: string;
  source_player_id: string;
  pitch_type: string;
  hand: string;
  pitches: number | null;
  velocity: number | null;
}

export interface VeloDiffReport {
  totalChangeupRows: number;
  fbFromBoth: number;
  fbFrom4SOnly: number;
  fbFromSinkerOnly: number;
  noFastballFound: number;
  negativeVeloDiff: number;
  rhpMean: number | null;
  rhpSd: number | null;
  lhpMean: number | null;
  lhpSd: number | null;
  written: number;
}

// ─── Paginated fetch ────────────────────────────────────────────────────────

async function fetchAll<T>(
  table: string,
  select: string,
  filters: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let q = (supabase as any).from(table).select(select).range(offset, offset + PAGE - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function runVeloDiffPipeline(
  season: number = 2026,
): Promise<{ report: VeloDiffReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[VeloDiff] TOTAL");

  // ── Step 1: Pull all relevant rows ─────────────────────────────────────
  console.time("[VeloDiff] 1. fetch pitch rows");
  const allRows = await fetchAll<PitchRow>(
    "pitcher_stuff_plus_inputs",
    "id, source_player_id, pitch_type, hand, pitches, velocity",
    (q: any) => q.eq("season", season).in("pitch_type", ["4S FB", "Sinker", "Change-up"]),
  );
  console.timeEnd("[VeloDiff] 1. fetch pitch rows");

  // Group by player
  const playerMap = new Map<string, PitchRow[]>();
  for (const row of allRows) {
    if (!playerMap.has(row.source_player_id)) playerMap.set(row.source_player_id, []);
    playerMap.get(row.source_player_id)!.push(row);
  }

  // ── Step 2: Calculate fb_ch_velo_diff per player ───────────────────────
  console.time("[VeloDiff] 2. compute fb_ch_velo_diff");
  let totalChangeupRows = 0;
  let fbFromBoth = 0;
  let fbFrom4SOnly = 0;
  let fbFromSinkerOnly = 0;
  let noFastballFound = 0;
  let negativeVeloDiff = 0;

  // Collect updates: { id, fb_ch_velo_diff, needs_review? }
  const updates: Array<{ id: string; fb_ch_velo_diff: number | null; hand: string; pitches: number }> = [];
  const flaggedIds: string[] = [];

  for (const [, rows] of playerMap) {
    const changeups = rows.filter((r) => r.pitch_type === "Change-up");
    if (changeups.length === 0) continue;

    const fb4s = rows.find((r) => r.pitch_type === "4S FB");
    const sinker = rows.find((r) => r.pitch_type === "Sinker");

    let fbVelo: number | null = null;

    if (fb4s?.velocity != null && sinker?.velocity != null) {
      // Weighted average
      const fb4sP = fb4s.pitches ?? 0;
      const sinkerP = sinker.pitches ?? 0;
      const totalP = fb4sP + sinkerP;
      if (totalP > 0) {
        fbVelo = ((fb4s.velocity * fb4sP) + (sinker.velocity * sinkerP)) / totalP;
      }
      fbFromBoth++;
    } else if (fb4s?.velocity != null) {
      fbVelo = fb4s.velocity;
      fbFrom4SOnly++;
    } else if (sinker?.velocity != null) {
      fbVelo = sinker.velocity;
      fbFromSinkerOnly++;
    } else {
      noFastballFound++;
    }

    for (const ch of changeups) {
      totalChangeupRows++;

      if (fbVelo == null || ch.velocity == null) {
        updates.push({ id: ch.id, fb_ch_velo_diff: null, hand: ch.hand, pitches: ch.pitches ?? 0 });
        if (fbVelo == null) flaggedIds.push(ch.id);
        continue;
      }

      const diff = Math.round((fbVelo - ch.velocity) * 100) / 100;
      updates.push({ id: ch.id, fb_ch_velo_diff: diff, hand: ch.hand, pitches: ch.pitches ?? 0 });

      if (diff < 0) {
        negativeVeloDiff++;
        flaggedIds.push(ch.id);
      }
    }
  }

  console.timeEnd("[VeloDiff] 2. compute fb_ch_velo_diff");

  // ── Step 3: Write fb_ch_velo_diff to pitcher_stuff_plus_inputs ─────────
  console.time("[VeloDiff] 3. write fb_ch_velo_diff");
  // Group by diff value for efficient batch updates
  const diffGroups = new Map<string, string[]>();
  for (const u of updates) {
    const key = u.fb_ch_velo_diff == null ? "__null__" : String(u.fb_ch_velo_diff);
    if (!diffGroups.has(key)) diffGroups.set(key, []);
    diffGroups.get(key)!.push(u.id);
  }

  let written = 0;
  for (const [diffStr, ids] of diffGroups) {
    const diffVal = diffStr === "__null__" ? null : Number(diffStr);
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ fb_ch_velo_diff: diffVal })
        .in("id", batch);

      if (error) {
        errors.push(`Update batch: ${error.message}`);
      } else {
        written += batch.length;
      }
    }
  }

  // Flag needs_review on negative/no-fastball rows
  if (flaggedIds.length > 0) {
    for (let i = 0; i < flaggedIds.length; i += 500) {
      const batch = flaggedIds.slice(i, i + 500);
      await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ needs_review: true, review_note: "negative velo diff or no fastball found" })
        .in("id", batch);
    }
  }

  console.timeEnd("[VeloDiff] 3. write fb_ch_velo_diff");

  // ── Step 4: Calculate weighted mean and SD per hand ────────────────────
  console.time("[VeloDiff] 4. weighted stats + write to ncaa table");
  function calcWeightedStats(rows: Array<{ diff: number; p: number }>): { mean: number; sd: number } | null {
    if (rows.length === 0) return null;
    const totalP = rows.reduce((s, r) => s + r.p, 0);
    if (totalP === 0) return null;
    const mean = rows.reduce((s, r) => s + r.diff * r.p, 0) / totalP;
    const variance = rows.reduce((s, r) => s + r.p * (r.diff - mean) ** 2, 0) / totalP;
    return {
      mean: Math.round(mean * 100) / 100,
      sd: Math.round(Math.sqrt(variance) * 1000) / 1000,
    };
  }

  const validUpdates = updates.filter((u) => u.fb_ch_velo_diff != null && !flaggedIds.includes(u.id));
  const rhpData = validUpdates.filter((u) => u.hand === "R").map((u) => ({ diff: u.fb_ch_velo_diff!, p: u.pitches }));
  const lhpData = validUpdates.filter((u) => u.hand === "L").map((u) => ({ diff: u.fb_ch_velo_diff!, p: u.pitches }));

  const rhpStats = calcWeightedStats(rhpData);
  const lhpStats = calcWeightedStats(lhpData);

  // Write to pitcher_stuff_plus_ncaa
  if (rhpStats) {
    const { error } = await (supabase as any)
      .from("pitcher_stuff_plus_ncaa")
      .update({ velo_diff: rhpStats.mean, velo_diff_sd: rhpStats.sd })
      .eq("season", season)
      .eq("pitch_type", "Change-up")
      .eq("hand", "R");

    if (error) errors.push(`NCAA RHP update: ${error.message}`);
  }

  if (lhpStats) {
    const { error } = await (supabase as any)
      .from("pitcher_stuff_plus_ncaa")
      .update({ velo_diff: lhpStats.mean, velo_diff_sd: lhpStats.sd })
      .eq("season", season)
      .eq("pitch_type", "Change-up")
      .eq("hand", "L");

    if (error) errors.push(`NCAA LHP update: ${error.message}`);
  }

  console.timeEnd("[VeloDiff] 4. weighted stats + write to ncaa table");
  console.timeEnd("[VeloDiff] TOTAL");

  // ── Step 5: Report ─────────────────────────────────────────────────────
  return {
    report: {
      totalChangeupRows,
      fbFromBoth,
      fbFrom4SOnly,
      fbFromSinkerOnly,
      noFastballFound,
      negativeVeloDiff,
      rhpMean: rhpStats?.mean ?? null,
      rhpSd: rhpStats?.sd ?? null,
      lhpMean: lhpStats?.mean ?? null,
      lhpSd: lhpStats?.sd ?? null,
      written,
    },
    errors,
  };
}
