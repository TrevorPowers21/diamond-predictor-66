/**
 * wRC+ for Savant — RE-EXPORTS the canonical `src/lib/wrc.ts` so there is exactly ONE formula.
 * `src/lib/wrc.ts` is dependency-free (pure math), so importing it does NOT drag the projection
 * engine into the Savant bundle — the isolation this file used to protect is preserved.
 * SAVANT_* names kept as aliases for existing importers.
 */
export {
  computeWrcRaw,
  computeWrcPlus,
  WRC_C1,
  NCAA_WRC_DENOM as SAVANT_NCAA_WRC,
  DEFAULT_WRC_WEIGHTS as SAVANT_WRC_WEIGHTS,
} from "@/lib/wrc";
import { WRC_C1 } from "@/lib/wrc";

export const SAVANT_WRC_INTERCEPT = WRC_C1.intercept;
