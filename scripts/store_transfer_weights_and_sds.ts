// 1e: store re-tuned transfer weights + cross-conf/park SD mirror into model_config
// (admin_ui, season 2026). Hitter t_* weights ALREADY exist there (old values) and
// OVERRIDE code → must update. Pitcher transfer_* + SDs are new inserts. Values match
// code (transferWeightDefaults.ts / pitchingEquations.ts). Default dry-run; --apply to write.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const SEASON = 2026, MT = "admin_ui";
const APPLY = process.argv.includes("--apply");

const rows: Record<string, number> = {
  // Hitter weights (UPDATE existing) — must match transferWeightDefaults.ts
  t_ba_conference_weight: 0.256, t_obp_conference_weight: 0.288, t_iso_conference_weight: 0.080,
  t_ba_pitching_weight: 1.15, t_obp_pitching_weight: 0.98, t_iso_pitching_weight: 0.86,
  t_ba_park_weight: 0.270, t_obp_park_weight: 0.324, t_iso_park_weight: 0.111,
  // Pitcher weights (INSERT) — must match pitchingEquations.ts DEFAULT_PITCHING_WEIGHTS
  transfer_era_conference_weight: 0.106, transfer_era_competition_weight: 0.262, transfer_era_park_weight: 0.135,
  transfer_fip_conference_weight: 0.137, transfer_fip_competition_weight: 0.262, transfer_fip_park_weight: 0.135,
  transfer_whip_conference_weight: 0.175, transfer_whip_competition_weight: 0.238, transfer_whip_park_weight: 0.324,
  transfer_k9_conference_weight: 0.115, transfer_k9_competition_weight: 0.297,
  transfer_bb9_conference_weight: 0.097, transfer_bb9_competition_weight: 0.297,
  transfer_hr9_conference_weight: 0.043, transfer_hr9_competition_weight: 0.297, transfer_hr9_park_weight: 0.111,
  // Cross-conf env+ SDs (traceable mirror — the numbers the weights derive from)
  conf_env_sd_era_plus: 9.46, conf_env_sd_fip_plus: 7.28, conf_env_sd_whip_plus: 5.72,
  conf_env_sd_k9_plus: 8.72, conf_env_sd_bb9_plus: 10.29, conf_env_sd_hr9_plus: 23.38,
  conf_env_sd_ba_plus: 3.91, conf_env_sd_obp_plus: 3.47, conf_env_sd_iso_plus: 12.47,
  conf_comp_sd_stuff_plus: 3.48, conf_comp_sd_htp: 14.31,
  // Park SDs (cross-team, per metric)
  park_sd_avg: 5.56, park_sd_obp: 4.63, park_sd_iso: 17.97,
  park_sd_rg: 12.95, park_sd_whip: 4.63, park_sd_hr9: 17.97,
};

console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — ${Object.keys(rows).length} model_config keys (${MT}, season ${SEASON}):`);
let ins = 0, upd = 0;
for (const [config_key, config_value] of Object.entries(rows)) {
  const { data: existing } = await (sb as any).from("model_config").select("id,config_value")
    .eq("model_type", MT).eq("season", SEASON).eq("config_key", config_key).maybeSingle();
  const action = existing ? `UPDATE ${existing.config_value}→${config_value}` : `INSERT ${config_value}`;
  console.log(`  ${config_key.padEnd(34)} ${action}`);
  if (existing) upd++; else ins++;
  if (APPLY) {
    if (existing) {
      const { error } = await (sb as any).from("model_config").update({ config_value }).eq("id", existing.id);
      if (error) console.log(`    ERR: ${error.message}`);
    } else {
      const { error } = await (sb as any).from("model_config").insert({ model_type: MT, season: SEASON, config_key, config_value });
      if (error) console.log(`    ERR: ${error.message}`);
    }
  }
}
console.log(`\n${APPLY ? "APPLIED" : "would"}: ${upd} updates, ${ins} inserts.`);
