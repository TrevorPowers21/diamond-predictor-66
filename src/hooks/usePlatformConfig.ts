import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  NIL_CONFERENCE_TIER_MULTIPLIERS,
  JUCO_OUTLIER_REGRESSION,
  D1_TRANSFER_WEIGHTS,
  JUCO_TRANSFER_WEIGHTS,
  DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
} from "@/lib/config/platformDefaults";

type ConfigRow = { config_key: string; config_value: unknown };

function num(rows: ConfigRow[], key: string, fallback: number): number {
  const row = rows.find((r) => r.config_key === key);
  if (!row) return fallback;
  const v = Number(row.config_value);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Merges runtime DB overrides on top of the TypeScript defaults.
 * Any key absent from the DB uses the TS constant — the DB only holds
 * values that have been intentionally changed by an admin.
 *
 * Cached for 10 minutes; stale values revalidate in the background
 * (standard SWR pattern). Calculation functions should accept the
 * returned config object as a parameter rather than reading these
 * constants directly.
 */
export function usePlatformConfig() {
  const { data: rows = [] } = useQuery<ConfigRow[]>({
    queryKey: ["platform-config"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_config")
        .select("config_key, config_value");
      if (error) throw error;
      return (data ?? []) as ConfigRow[];
    },
  });

  const nilTiers = {
    sec:       num(rows, "nil.tier.sec",        NIL_CONFERENCE_TIER_MULTIPLIERS.sec),
    p4:        num(rows, "nil.tier.p4",         NIL_CONFERENCE_TIER_MULTIPLIERS.p4),
    bigTen:    num(rows, "nil.tier.big_ten",    NIL_CONFERENCE_TIER_MULTIPLIERS.bigTen),
    strongMid: num(rows, "nil.tier.strong_mid", NIL_CONFERENCE_TIER_MULTIPLIERS.strongMid),
    lowMajor:  num(rows, "nil.tier.low_major",  NIL_CONFERENCE_TIER_MULTIPLIERS.lowMajor),
  };

  const defaultProgramTotalPlayerScore = num(
    rows,
    "nil.default_program_total_player_score",
    DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
  );

  const d1TransferWeights = {
    conference: {
      avg: num(rows, "transfer.d1.conference.avg", D1_TRANSFER_WEIGHTS.conference.avg),
      obp: num(rows, "transfer.d1.conference.obp", D1_TRANSFER_WEIGHTS.conference.obp),
      iso: num(rows, "transfer.d1.conference.iso", D1_TRANSFER_WEIGHTS.conference.iso),
    },
    pitching: {
      avg: num(rows, "transfer.d1.pitching.avg", D1_TRANSFER_WEIGHTS.pitching.avg),
      obp: num(rows, "transfer.d1.pitching.obp", D1_TRANSFER_WEIGHTS.pitching.obp),
      iso: num(rows, "transfer.d1.pitching.iso", D1_TRANSFER_WEIGHTS.pitching.iso),
    },
    park: {
      avg: num(rows, "transfer.d1.park.avg", D1_TRANSFER_WEIGHTS.park.avg),
      obp: num(rows, "transfer.d1.park.obp", D1_TRANSFER_WEIGHTS.park.obp),
      iso: num(rows, "transfer.d1.park.iso", D1_TRANSFER_WEIGHTS.park.iso),
    },
    powerBlend: {
      avg: num(rows, "transfer.d1.power_blend", D1_TRANSFER_WEIGHTS.powerBlend.avg),
      obp: num(rows, "transfer.d1.power_blend", D1_TRANSFER_WEIGHTS.powerBlend.obp),
      iso: num(rows, "transfer.d1.power_blend", D1_TRANSFER_WEIGHTS.powerBlend.iso),
    },
  };

  const jucoTransferWeights = {
    conference: {
      avg: num(rows, "transfer.juco.conference.avg", JUCO_TRANSFER_WEIGHTS.conference.avg),
      obp: num(rows, "transfer.juco.conference.obp", JUCO_TRANSFER_WEIGHTS.conference.obp),
      iso: num(rows, "transfer.juco.conference.iso", JUCO_TRANSFER_WEIGHTS.conference.iso),
    },
    pitching: {
      avg: num(rows, "transfer.juco.pitching.avg", JUCO_TRANSFER_WEIGHTS.pitching.avg),
      obp: num(rows, "transfer.juco.pitching.obp", JUCO_TRANSFER_WEIGHTS.pitching.obp),
      iso: num(rows, "transfer.juco.pitching.iso", JUCO_TRANSFER_WEIGHTS.pitching.iso),
    },
    park:       { avg: 0, obp: 0, iso: 0 },     // always 0 for JUCO
    powerBlend: { avg: 0, obp: 0, iso: 0 },     // always 0 for JUCO
  };

  const jucoOutlierRegression = {
    avg: {
      mean:      JUCO_OUTLIER_REGRESSION.avg.mean,   // NCAA mean — not tunable
      threshold: num(rows, "juco.regression.avg.threshold", JUCO_OUTLIER_REGRESSION.avg.threshold),
      slope:     num(rows, "juco.regression.avg.slope",     JUCO_OUTLIER_REGRESSION.avg.slope),
      maxR:      num(rows, "juco.regression.avg.maxR",      JUCO_OUTLIER_REGRESSION.avg.maxR),
    },
    obp: {
      mean:      JUCO_OUTLIER_REGRESSION.obp.mean,
      threshold: num(rows, "juco.regression.obp.threshold", JUCO_OUTLIER_REGRESSION.obp.threshold),
      slope:     num(rows, "juco.regression.obp.slope",     JUCO_OUTLIER_REGRESSION.obp.slope),
      maxR:      num(rows, "juco.regression.obp.maxR",      JUCO_OUTLIER_REGRESSION.obp.maxR),
    },
    iso: {
      mean:      JUCO_OUTLIER_REGRESSION.iso.mean,
      threshold: num(rows, "juco.regression.iso.threshold", JUCO_OUTLIER_REGRESSION.iso.threshold),
      slope:     num(rows, "juco.regression.iso.slope",     JUCO_OUTLIER_REGRESSION.iso.slope),
      maxR:      num(rows, "juco.regression.iso.maxR",      JUCO_OUTLIER_REGRESSION.iso.maxR),
    },
  };

  return {
    nilTiers,
    defaultProgramTotalPlayerScore,
    d1TransferWeights,
    jucoTransferWeights,
    jucoOutlierRegression,
    /** True once the DB query has resolved at least once. */
    isReady: rows.length > 0,
  };
}
