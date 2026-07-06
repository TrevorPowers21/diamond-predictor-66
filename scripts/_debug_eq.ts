import { readPitchingWeights } from "../src/lib/pitchingEquations";

const eq = readPitchingWeights();
console.log("Pitching equation weights (sample):");
console.log(`  era_plus_ncaa_avg=${eq.era_plus_ncaa_avg}`);
console.log(`  era_plus_ncaa_sd=${eq.era_plus_ncaa_sd}`);
console.log(`  era_pr_sd=${eq.era_pr_sd}`);
console.log(`  fip_pr_sd=${eq.fip_pr_sd}`);
console.log(`  whip_pr_sd=${eq.whip_pr_sd}`);
console.log(`  k9_pr_sd=${eq.k9_pr_sd}`);
console.log(`  bb9_pr_sd=${eq.bb9_pr_sd}`);
console.log(`  hr9_pr_sd=${eq.hr9_pr_sd}`);
console.log(`  pwar_ip_sp=${eq.pwar_ip_sp}`);
console.log(`  pwar_ip_rp=${eq.pwar_ip_rp}`);
console.log(`  pwar_ip_sm=${eq.pwar_ip_sm}`);
