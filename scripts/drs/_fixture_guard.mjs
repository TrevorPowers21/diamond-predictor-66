/**
 * Population-consistency guard for the WAR fixture chain.
 *
 * The offensive baseline seam (2026-08-10) happened because two fixtures were centered on two
 * different populations (RE24-sample vs pa_total) and nothing structural stopped it from shipping.
 * This moves the tripwire to the grain where the bug class lives: every derived fixture carries
 * `_meta.centering_population`, and any code that COMBINES fixtures asserts they agree before use.
 * One field, one assertion — seams of this class can't ship silently.
 *
 *   import { assertCentering } from "./_fixture_guard.mjs";
 *   assertCentering("all-D1", { name: "descriptive_constants", meta: C._meta }, { name: "woba_weights", meta: W._meta });
 */
export function assertCentering(expected, ...fixtures) {
  const bad = [];
  for (const f of fixtures) {
    const pop = f?.meta?.centering_population;
    if (pop !== expected) bad.push(`${f?.name ?? "?"}: centering_population=${pop ?? "MISSING"} (expected ${expected})`);
  }
  if (bad.length) {
    throw new Error(
      `FIXTURE POPULATION SEAM — combining fixtures centered on different populations:\n  ` +
      bad.join("\n  ") +
      `\nAll fixtures that combine into one WAR number must share centering_population. ` +
      `Re-center on the intended population (see scripts/drs/_recenter_check.mjs) before proceeding.`
    );
  }
}
