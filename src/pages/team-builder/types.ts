export type TransferSnapshot = {
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_wrc_plus: number | null;
  p_era?: number | null;
  p_fip?: number | null;
  p_whip?: number | null;
  p_k9?: number | null;
  p_bb9?: number | null;
  p_hr9?: number | null;
  p_rv_plus?: number | null;
  p_war?: number | null;
  owar: number | null;
  nil_valuation: number | null;
  from_team: string | null;
  from_conference: string | null;
};

export type TeamMetricInputs = {
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la10_30: number | null;
  gb: number | null;
};

export type TeamPowerPlus = {
  baPlus: number | null;
  obpPlus: number | null;
  isoPlus: number | null;
  overallPlus: number | null;
};

export type BuildPlayer = {
  id?: string;
  player_id: string | null;
  source: "returner" | "portal";
  custom_name: string | null;
  position_slot: string | null;
  depth_order: number;
  nil_value: number;
  production_notes: string | null;
  roster_status?: "returner" | "leaving" | "target";
  depth_role?: "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" | "starter" | "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever";
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  class_transition_overridden?: boolean;
  dev_aggressiveness_overridden?: boolean;
  player?: {
    first_name: string;
    last_name: string;
    position: string | null;
    is_twp?: boolean | null;
    class_year?: string | null;
    throws_hand?: string | null;
    bats_hand?: string | null;
    team: string | null;
    from_team: string | null;
    conference: string | null;
  } | null;
  prediction?: {
    id?: string | null;
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_wrc_plus: number | null;
    p_era?: number | null;
    p_fip?: number | null;
    p_whip?: number | null;
    p_k9?: number | null;
    p_bb9?: number | null;
    p_hr9?: number | null;
    p_rv_plus?: number | null;
    p_war?: number | null;
    nil_valuation?: number | null;
    power_rating_plus: number | null;
    model_type: "returner" | "transfer" | string | null;
    status: string | null;
  } | null;
  nilVal?: number | null;
  nil_owar?: number | null;
  team_metrics?: TeamMetricInputs | null;
  team_power_plus?: TeamPowerPlus | null;
  transfer_snapshot?: TransferSnapshot | null;
};

export type TeamRow = {
  id: string;
  name: string;
  conference: string | null;
  park_factor: number | null;
  conference_id?: string | null;
  source_team_id?: string | null;
};

export type PitcherDepthRole =
  | "weekend_starter"
  | "weekday_starter"
  | "swing_starter"
  | "workhorse_reliever"
  | "high_leverage_reliever"
  | "mid_leverage_reliever"
  | "low_impact_reliever"
  | "specialist_reliever";

export type ConferenceStatsRow = {
  conference: string;
  conference_id: string | null;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
};
