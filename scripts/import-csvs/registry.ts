export type CsvType =
  | "hitter_master"
  | "pitching_master"
  | "pitcher_stuff_inputs"
  | "pitch_arsenal"
  | "class_data"
  | "conference_stats"
  | "park_factors"
  | "nil";

export type RegistryEntry = {
  type: CsvType;
  label: string;
  /** Columns that MUST be present (case-insensitive). All required for a match. */
  required: string[];
  /** Columns that boost confidence when present. */
  signature: string[];
  /** Filename regex hints used as tiebreaker. */
  filenameHints: RegExp[];
  /** Downstream pipeline steps triggered when this CSV is imported. */
  downstream: PipelineStep[];
  /** Short summary of what the importer does (shown in dry-run). */
  description: string;
  /**
   * If true, multiple files of this type are expected in one batch (e.g.
   * Stuff+ Inputs has 16 files for 8 pitches × 2 hands). If false/undefined,
   * only the newest file of this type is imported and older ones are marked
   * superseded.
   */
  multiFile?: boolean;
};

export type PipelineStep =
  | "sync_master_to_players"
  | "add_missing_players"
  | "create_predictions"
  | "velo_diff"
  | "reclassify"
  | "stuff_plus_recompute"
  | "rollup_stuff_plus"
  | "ncaa_averages"
  | "compute_scores"
  | "recalculate";

export const PIPELINE_LABELS: Record<PipelineStep, string> = {
  sync_master_to_players: "Sync master → players",
  add_missing_players: "Add missing players",
  create_predictions: "Create predictions for new players",
  velo_diff: "Compute FB↔Change-up velo diff",
  reclassify: "Reclassify breaking balls",
  stuff_plus_recompute: "Recompute per-pitch Stuff+ scores",
  rollup_stuff_plus: "Rollup Stuff+ → Pitching Master",
  ncaa_averages: "Refresh NCAA averages",
  compute_scores: "Recompute power-rating scores",
  recalculate: "Bulk-recalculate predictions",
};

export const REGISTRY: RegistryEntry[] = [
  {
    type: "hitter_master",
    label: "Hitter Master",
    required: ["playerId", "playerFullName"],
    signature: [
      "PA",
      "AB",
      "BA",
      "AVG",
      "OBP",
      "SLG",
      "ISO",
      "BB%",
      "Chase%",
      "Contact%",
      "Barrel%",
      "ExitVel",
      "90thExitVel",
      "Line%",
      "Ground%",
      "newestTeamLocation",
      "batsHand",
    ],
    filenameHints: [/hitter/i, /batter/i, /\bhm[_\-]/i, /hitting/i],
    downstream: [
      "sync_master_to_players",
      "add_missing_players",
      "create_predictions",
      "ncaa_averages",
      "compute_scores",
      "recalculate",
    ],
    description: "Full-replace season snapshot of D1 hitter stats (TruMedia export includes PA/AB).",
  },
  {
    type: "pitching_master",
    label: "Pitching Master",
    required: ["playerId", "playerFullName"],
    signature: [
      "IP",
      "G",
      "GS",
      "ERA",
      "FIP",
      "WHIP",
      "K/9",
      "BB/9",
      "HR/9",
      "Miss%",
      "InZoneWhiff%",
      "InZone%",
      "HardHit%",
      "Chase%",
      "Barrel%",
      "ExitVel",
      "90thExitVel",
      "Line%",
      "Ground%",
      "HPull%",
      "LA10-30%",
      "throwsHand",
    ],
    filenameHints: [/pitch/i, /pitching/i, /\bpm[_\-]/i],
    downstream: [
      "sync_master_to_players",
      "add_missing_players",
      "create_predictions",
      "ncaa_averages",
      "compute_scores",
      "recalculate",
    ],
    description: "Full-replace season snapshot of D1 pitcher stats. Role + Stuff+ are populated by separate pipelines (depth chart for Role, Stuff+ Inputs rollup for stuff_plus).",
  },
  {
    type: "pitcher_stuff_inputs",
    label: "Stuff+ Inputs (per-pitch / per-hand)",
    // pitch_type + hand come from the FILENAME ("4S FB RHP.csv" pattern),
    // not from CSV columns — TruMedia's per-pitch export doesn't include
    // a Pitch Type column. The filename hints below + signature columns
    // are how we detect the file as Stuff+ Inputs.
    required: ["playerId", "playerFullName"],
    signature: [
      "Vel",
      "IndVertBrk",
      "HorzBrk",
      "RelHeight",
      "RelSide",
      "Extension",
      "Spin",
      "VertApprAngle",
      "Miss%",
    ],
    filenameHints: [
      /stuff/i,
      /\brhp\b/i,
      /\blhp\b/i,
      /4s\s*fb/i,
      /sinker/i,
      /cutter/i,
      /slider/i,
      /curveball/i,
      /change[\-\s]?up/i,
      /splitter/i,
      /sweeper/i,
    ],
    downstream: [
      "velo_diff",
      "reclassify",
      "stuff_plus_recompute",
      "rollup_stuff_plus",
      "ncaa_averages",
      "compute_scores",
      "recalculate",
    ],
    description: "Raw per-pitch-per-hand inputs (one file per pitch type × hand). Writes pitcher_stuff_plus_inputs, then velo-diff → reclassify → Stuff+ score → rollup → recalc.",
    multiFile: true,
  },
  {
    type: "pitch_arsenal",
    label: "Pitch Arsenal (legacy all-in-one)",
    required: ["Player ID", "Player Name"],
    signature: [
      "Total Pitches",
      "Overall Stuff+",
      "4S FB RHP",
      "4S FB LHP",
      "Slider RHP",
      "Curveball RHP",
      "Change-Up RHP",
      "Sweeper RHP",
    ],
    filenameHints: [/arsenal/i, /pitch[_\-]?type/i],
    downstream: ["rollup_stuff_plus", "compute_scores", "recalculate"],
    description: "Legacy single-CSV pitch arsenal format. Use Stuff+ Inputs split-file format instead.",
  },
  {
    type: "class_data",
    label: "Class Data",
    required: ["playerId"],
    signature: ["classYear", "batsHand", "throwsHand"],
    filenameHints: [/class/i, /classyear/i, /roster/i],
    downstream: ["recalculate"],
    description: "Updates class year + hand on players. Auto-relocks predictions.",
  },
  {
    type: "conference_stats",
    label: "Conference Stats",
    required: ["conference"],
    signature: [
      "AVG",
      "OBP",
      "SLG",
      "ISO",
      "ERA",
      "FIP",
      "WHIP",
      "BA+",
      "OBP+",
      "ERA+",
    ],
    filenameHints: [/conference/i, /\bconf[_\-]/i],
    downstream: ["ncaa_averages", "compute_scores", "recalculate"],
    description: "Per-conference aggregate stats. Importer not yet wired (Phase D).",
  },
  {
    type: "park_factors",
    label: "Park Factors",
    required: ["team"],
    signature: [
      "AVG_factor",
      "OBP_factor",
      "ISO_factor",
      "ERA_factor",
      "HR9_factor",
      "WHIP_factor",
    ],
    filenameHints: [/park[_\-]?factor/i, /\bpf[_\-]/i],
    downstream: ["recalculate"],
    description: "Per-team park adjustment multipliers. Importer not yet wired (Phase D).",
  },
  {
    type: "nil",
    label: "NIL",
    required: ["playerId"],
    signature: ["nil_value", "NIL", "nilValue", "valuation"],
    filenameHints: [/nil/i, /valuation/i],
    downstream: [],
    description: "Per-player NIL valuations. Display only — no recalc. Importer not yet wired (Phase D).",
  },
];
