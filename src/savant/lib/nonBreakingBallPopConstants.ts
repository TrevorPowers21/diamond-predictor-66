import { supabase } from "@/integrations/supabase/client";

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

const NON_BREAKING_BALLS = ["4S FB", "Sinker", "Cutter", "Change-up", "Splitter"];

interface PitchInput {
  source_player_id: string;
  pitch_type: string;
  hand: string;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  whiff_pct: number | null;
}

export interface NonBbPopReport {
  pitchTypesProcessed: number;
  rowsWritten: number;
  results: Array<{
    pitch_type: string;
    hand: string;
    n_pitchers: number;
    pitches: number;
    velocity: number | null;
    velocity_sd: number | null;
    ivb: number | null;
    ivb_sd: number | null;
    hb: number | null;
    hb_sd: number | null;
  }>;
}

async function fetchAll(season: number): Promise<PitchInput[]> {
  const PAGE = 1000;
  const all: PitchInput[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("pitcher_stuff_plus_inputs")
      .select(
        "source_player_id, pitch_type, hand, pitches, velocity, ivb, hb, rel_height, rel_side, extension, spin, whiff_pct",
      )
      .eq("season", season)
      .in("pitch_type", NON_BREAKING_BALLS)
      .gt("pitches", 0)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as PitchInput[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function computeNonBreakingBallPopConstants(
  season: number,
): Promise<{ report: NonBbPopReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[NonBBPop] TOTAL");

  console.time("[NonBBPop] 1. fetch pitches");
  const rows = await fetchAll(season);
  console.timeEnd("[NonBBPop] 1. fetch pitches");
  console.log(`[NonBBPop] ${rows.length} non-breaking-ball pitch rows for ${season}`);

  // Group by pitch_type::hand
  console.time("[NonBBPop] 2. compute weighted stats");
  const groups = new Map<string, PitchInput[]>();
  for (const r of rows) {
    if (!r.ivb || !r.hb) continue; // require movement
    const key = `${r.pitch_type}::${r.hand}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  type StatRow = {
    pitch_type: string;
    hand: string;
    season: number;
    n_pitchers: number;
    pitches: number;
    velocity: number | null;
    velocity_sd: number | null;
    ivb: number | null;
    ivb_sd: number | null;
    hb: number | null;
    hb_sd: number | null;
    rel_height: number | null;
    rel_height_sd: number | null;
    rel_side: number | null;
    rel_side_sd: number | null;
    extension: number | null;
    extension_sd: number | null;
    spin: number | null;
    spin_sd: number | null;
    whiff_pct: number | null;
    whiff_pct_sd: number | null;
  };

  const results: StatRow[] = [];

  for (const [key, group] of groups) {
    const [pitch_type, hand] = key.split("::");
    const totalP = group.reduce((s, r) => s + (r.pitches ?? 0), 0);
    if (totalP === 0) continue;

    const wMean = (getter: (r: PitchInput) => number | null): number | null => {
      let sumW = 0, sumV = 0;
      for (const r of group) {
        const v = getter(r);
        const p = r.pitches ?? 0;
        if (v == null || p === 0) continue;
        sumV += v * p;
        sumW += p;
      }
      return sumW > 0 ? sumV / sumW : null;
    };

    const wSd = (getter: (r: PitchInput) => number | null, mean: number | null): number | null => {
      if (mean == null) return null;
      let sumW = 0, sumSq = 0;
      for (const r of group) {
        const v = getter(r);
        const p = r.pitches ?? 0;
        if (v == null || p === 0) continue;
        sumSq += p * (v - mean) * (v - mean);
        sumW += p;
      }
      return sumW > 0 ? Math.sqrt(sumSq / sumW) : null;
    };

    const velMean = wMean((r) => r.velocity);
    const ivbMean = wMean((r) => r.ivb);
    const hbMean = wMean((r) => r.hb);
    const relHMean = wMean((r) => r.rel_height);
    const relSMean = wMean((r) => r.rel_side);
    const extMean = wMean((r) => r.extension);
    const spinMean = wMean((r) => r.spin);
    const whiffMean = wMean((r) => r.whiff_pct);

    results.push({
      pitch_type,
      hand,
      season,
      n_pitchers: group.length,
      pitches: totalP,
      velocity: round2(velMean),
      velocity_sd: round2(wSd((r) => r.velocity, velMean)),
      ivb: round2(ivbMean),
      ivb_sd: round2(wSd((r) => r.ivb, ivbMean)),
      hb: round2(hbMean),
      hb_sd: round2(wSd((r) => r.hb, hbMean)),
      rel_height: round2(relHMean),
      rel_height_sd: round2(wSd((r) => r.rel_height, relHMean)),
      rel_side: round2(relSMean),
      rel_side_sd: round2(wSd((r) => r.rel_side, relSMean)),
      extension: round2(extMean),
      extension_sd: round2(wSd((r) => r.extension, extMean)),
      spin: round2(spinMean),
      spin_sd: round2(wSd((r) => r.spin, spinMean)),
      whiff_pct: round2(whiffMean),
      whiff_pct_sd: round2(wSd((r) => r.whiff_pct, whiffMean)),
    });
  }
  console.timeEnd("[NonBBPop] 2. compute weighted stats");

  // Upsert
  console.time("[NonBBPop] 3. upsert pop constants");
  let written = 0;
  for (const r of results) {
    const { error } = await (supabase as any)
      .from("pitcher_stuff_plus_ncaa")
      .upsert(r, { onConflict: "pitch_type,hand,season" });
    if (error) errors.push(`Upsert ${r.pitch_type}/${r.hand}: ${error.message}`);
    else written++;
  }
  console.timeEnd("[NonBBPop] 3. upsert pop constants");
  console.timeEnd("[NonBBPop] TOTAL");

  return {
    report: {
      pitchTypesProcessed: results.length,
      rowsWritten: written,
      results: results.map((r) => ({
        pitch_type: r.pitch_type,
        hand: r.hand,
        n_pitchers: r.n_pitchers,
        pitches: r.pitches,
        velocity: r.velocity,
        velocity_sd: r.velocity_sd,
        ivb: r.ivb,
        ivb_sd: r.ivb_sd,
        hb: r.hb,
        hb_sd: r.hb_sd,
      })),
    },
    errors,
  };
}
