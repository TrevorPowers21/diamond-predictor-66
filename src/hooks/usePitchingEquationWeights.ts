import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Default pitching equation weights — used as fallback if Supabase has no value */
const DEFAULTS: Record<string, number> = {
  p_era_ncaa_avg_power_rating: 50,
  p_ncaa_avg_whip_power_rating: 50,
  p_ncaa_avg_k9_power_rating: 50,
  p_ncaa_avg_bb9_power_rating: 50,
  p_ncaa_avg_hr9_power_rating: 50,
  p_era_stuff_plus_weight: 0.21,
  p_era_whiff_pct_weight: 0.23,
  p_era_bb_pct_weight: 0.17,
  p_era_hh_pct_weight: 0.07,
  p_era_in_zone_whiff_pct_weight: 0.12,
  p_era_chase_pct_weight: 0.08,
  p_era_barrel_pct_weight: 0.12,
  p_fip_hr9_power_rating_plus_weight: 0.45,
  p_fip_bb9_power_rating_plus_weight: 0.30,
  p_fip_k9_power_rating_plus_weight: 0.25,
  p_whip_bb_pct_weight: 0.25,
  p_whip_ld_pct_weight: 0.20,
  p_whip_avg_ev_weight: 0.15,
  p_whip_whiff_pct_weight: 0.25,
  p_whip_gb_pct_weight: 0.10,
  p_whip_chase_pct_weight: 0.05,
  p_k9_whiff_pct_weight: 0.35,
  p_k9_stuff_plus_weight: 0.30,
  p_k9_in_zone_whiff_pct_weight: 0.25,
  p_k9_chase_pct_weight: 0.10,
  p_bb9_bb_pct_weight: 0.55,
  p_bb9_in_zone_pct_weight: 0.30,
  p_bb9_chase_pct_weight: 0.15,
  p_hr9_barrel_pct_weight: 0.32,
  p_hr9_ev90_weight: 0.24,
  p_hr9_gb_pct_weight: 0.18,
  p_hr9_pull_pct_weight: 0.14,
  p_hr9_la_10_30_pct_weight: 0.12,
  p_ncaa_avg_stuff_plus: 100,
  p_ncaa_avg_whiff_pct: 22.9,
  p_ncaa_avg_bb_pct: 11.3,
  p_ncaa_avg_hh_pct: 36.0,
  p_ncaa_avg_in_zone_whiff_pct: 16.4,
  p_ncaa_avg_chase_pct: 23.1,
  p_ncaa_avg_barrel_pct: 17.3,
  p_ncaa_avg_ld_pct: 20.9,
  p_ncaa_avg_avg_ev: 86.2,
  p_ncaa_avg_gb_pct: 43.2,
  p_ncaa_avg_in_zone_pct: 47.2,
  p_ncaa_avg_ev90: 103.1,
  p_ncaa_avg_pull_pct: 36.5,
  p_ncaa_avg_la_10_30_pct: 29.0,
  p_sd_stuff_plus: 3.967566764,
  p_sd_whiff_pct: 5.476169924,
  p_sd_bb_pct: 2.92040411,
  p_sd_hh_pct: 6.474203457,
  p_sd_in_zone_whiff_pct: 4.299203457,
  p_sd_chase_pct: 4.619392309,
  p_sd_barrel_pct: 4.988140199,
  p_sd_ld_pct: 3.580670928,
  p_sd_avg_ev: 2.362900608,
  p_sd_gb_pct: 6.958760046,
  p_sd_in_zone_pct: 3.325412065,
  p_sd_ev90: 1.767350585,
  p_sd_pull_pct: 5.356686254,
  p_sd_la_10_30_pct: 5.773803471,
};

/**
 * Reads pitching equation weights from Supabase model_config.
 * Returns a record of key → number with defaults filled in for any missing keys.
 * Cached for 30 minutes via TanStack Query.
 */
export function usePitchingEquationWeights() {
  const { data: weights = DEFAULTS } = useQuery({
    queryKey: ["pitching_equation_weights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("config_key, config_value")
        .eq("model_type", "admin_ui")
        .eq("season", 2025);
      if (error) throw error;

      const merged = { ...DEFAULTS };
      for (const row of data || []) {
        if (row.config_key?.startsWith("p_")) {
          const n = Number(row.config_value);
          if (Number.isFinite(n)) merged[row.config_key] = n;
        }
      }
      // Locked constant
      merged.p_whip_chase_pct_weight = 0.05;
      return merged;
    },
    staleTime: 30 * 60 * 1000,
  });

  return weights;
}

export { DEFAULTS as PITCHING_EQ_DEFAULTS };
