/**
 * ★ ANCHOR SUITE — task zero of docs/AGENT_PHASE_ONE_SCOPE.md §2. THE GATE.
 *
 * WHY THIS EXISTS, WHEN EIGHT TEST FILES ALREADY DID
 * The others pin FORMULAS against hand-derived constants. Every one of them passed on 2026-09-01
 * while Helfrick rendered 2.32 instead of 4.94 and Neiswonger showed 1.14 pWAR instead of 3.329.
 * A rollup, filter, or centre change can leave every constant untouched and still move a real
 * player's numbers. These anchors pin REAL PLAYERS from prod.
 *
 * THE RULE (§2.2)
 *   An anchor failure means an output MOVED. Report the frozen-vs-actual delta — which player,
 *   which field, expected vs got.
 *   ⛔ NEVER edit anchors.fixture.json or loosen a tolerance to make a change pass.
 *   ⛔ Anchors green but you cannot explain WHY the change was safe = treat as a failure.
 *
 * ⛔ D1 IS THE CONSISTENCY BOUNDARY — every assertion here filters `division === "D1"` except the
 *   JUCO block. Measured on prod 2026-09-02, and the filter is the whole story:
 *
 *       D1 transfer/precomputed     18,505 / 18,917   97.8% reproduce
 *       NJCAA_D1 transfer            10 / 19,034       0.1% reproduce
 *       unfiltered                                    ~60%  ← MEANINGLESS
 *
 *   An unfiltered sample reports ~60% and supports a confident, wrong conclusion. That is cause C1
 *   repeating (477 JUCO rows were 27% of the calibration sample). Never measure across divisions.
 *
 * ⚠ COVERAGE IS PARTIAL — READ BEFORE TRUSTING A GREEN RUN (§7 residual risk)
 *   GATED:     D1 returner + D1 transfer identity, the pitcher chain, structural invariants.
 *   NOT GATED: the transfer projection's own inputs (conference env+, park) are not frozen, so this
 *              proves the stored row is self-consistent — NOT that the projection that produced it
 *              is right. JUCO is pinned as broken, not verified.
 *
 * Regenerate deliberately (reads PROD read-only): npx tsx scripts/build-anchor-fixtures.ts
 */
import { describe, it, expect } from "vitest";
import fixture from "./anchors.fixture.json";
import { computeOWar, computePWar, computeDWar, computeBsrWar, RUNS_PER_WIN } from "../../savant/lib/war";
import { computeProjRA9, computePrvPlus } from "../../lib/pitcherQuality";

type Row = Record<string, any>;
const shape = (k: string): Row[] => (fixture as any).shapes?.[k]?.rows ?? [];
const all = (): Row[] => Object.keys((fixture as any).shapes).flatMap(shape);
const name = (r: Row) => `${r.first_name ?? "?"} ${r.last_name ?? "?"}`.trim();

/** Per-field and DELIBERATE. Tightening is fine; loosening one to make a change pass is not. */
const TOL = { war: 0.005, rating: 0.51 };

// ─────────────────────────────────────────────────────────────────────────────
describe("anchor fixture integrity", () => {
  it("came from prod and still carries every shape", () => {
    expect((fixture as any)._generated_from).toBe("prod");
    expect((fixture as any)._newest_updated_at).toBeTruthy();
    expect(Object.keys((fixture as any).shapes)).toEqual(expect.arrayContaining([
      "hitter_returner", "hitter_transfer", "starting_pitcher", "relief_pitcher",
      "two_way", "juco_transfer", "team_scoped_precomputed", "zero_scouting_inputs",
    ]));
    // A shape that silently empties is a coverage regression, not an inconvenience to route around.
    for (const k of Object.keys((fixture as any).shapes)) {
      expect(shape(k).length, `shape '${k}' has no rows`).toBeGreaterThan(0);
    }
  });

  it("stores numbers as numbers, never as strings", () => {
    // node-postgres returns numeric as STRING. An unconverted write once put strings into numeric
    // columns and the UI died on `.toFixed is not a function` (627 staging / 653 prod rows).
    for (const r of all()) {
      for (const f of ["o_war", "p_war", "p_wrc_plus", "p_avg", "market_value", "total_hitter_war"]) {
        if (r[f] != null) expect(typeof r[f], `${name(r)}.${f}`).toBe("number");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("anchor — RETURNER oWAR reproduces exactly, WHEN A DEPTH ROLE IS SET", () => {
  /**
   * Measured on prod 2026-09-02: returner rows WITH a hitter_depth_role reproduce 454/454 (100%).
   *
   * ⚠ The depth-role condition is NOT a tolerance being loosened to make a failure go away — it is
   * the actual invariant. Rows with a NULL depth role genuinely do not reproduce from
   * `projected_pa`, because PA comes from the DEPTH ROLE, not from the stored column. Three fixture
   * players demonstrate both sides of it: Spike Magill, Cooper Clapp and Jack Frankovic each have a
   * null-role row that diverges AND a role-bearing row that matches to the last digit. Pinning the
   * null-role rows is handled separately below, not swept in here.
   */
  const rows = all().filter(
    (r) => r.division === "D1" && r.model_type === "returner" && r.o_war != null
      && r.p_wrc_plus != null && r.projected_pa > 0 && r.hitter_depth_role != null,
  );

  it("the returner population is present in the fixture", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const r of rows) {
    it(`${name(r)} — oWAR ${r.o_war} @ wRC+ ${r.p_wrc_plus} / ${r.projected_pa} PA`, () => {
      const got = computeOWar(r.p_wrc_plus, r.projected_pa);
      expect(got).not.toBeNull();
      expect(Math.abs((got as number) - r.o_war)).toBeLessThan(TOL.war);
    });
  }
});

describe("anchor — every fixture row is FRESH (post-recalibration)", () => {
  /**
   * CORRECTED 2026-09-02. This suite first reported TWO findings — "the transfer path diverges at
   * 60%" and "NULL depth-role rows don't reproduce". Both were the SAME thing, and neither was a
   * model difference:
   *
   *   - the 60% came from an UNFILTERED sample; JUCO reproduces at 0.1% and swamped D1's 97.8%
   *   - the null-role rows were all `updated_at = 2026-08-31`, i.e. never re-baked on 09-01
   *
   * The 2026-09-01 recalibration populated `hitter_depth_role` AND rewrote oWAR together. Rows it
   * missed kept a NULL role and a stale value, so "null role" and "stale" are the same population
   * viewed two ways.
   *
   * ⇒ CORRECTED AGAIN, later the same day. There is no "never re-baked D1" population either.
   *   `player_predictions` is keyed on (player_id, customer_team_id, model_type, variant, SEASON),
   *   enforced by a unique index, and the precompute already UPSERTs on exactly that key. Grouped by
   *   the real key there are ZERO duplicates. Every "stale D1 row" is a season-2026 row whose only
   *   twin is the 2027 row — a different SEASON, not an old copy. Every read path filters
   *   `.eq("season", PROJECTION_SEASON)`, so nothing reads them by accident.
   *
   *   What remains genuinely stale is JUCO: ~33.9k season-2027 NJCAA_D1 rows blocked by the
   *   no_from_conf guard. That is workstream C, and it was already known.
   *
   * This guard exists so a stale row can never be frozen as an anchor again. Freezing one pins
   * PRE-recalibration behaviour as if it were correct — the quietest possible way for a gate to
   * certify the wrong thing. It caught exactly that on its first run (Spike Magill, 2026-08-31).
   */
  it("no fixture row predates the 2026-09-01 recalibration", () => {
    for (const r of all()) {
      if (!r.updated_at) continue;
      expect(
        new Date(r.updated_at) >= new Date("2026-09-01T00:00:00Z"),
        `${name(r)} updated_at ${r.updated_at} predates the recalibration — re-run ` +
        `npx tsx scripts/build-anchor-fixtures.ts rather than editing the fixture`,
      ).toBe(true);
    }
  });

  it("a depth role snaps PA to a canonical bucket — that is what 'PA comes from the role' means", () => {
    /**
     * Measured on prod 2026-09-02, FRESH D1 rows carrying an o_war:
     *   with a depth role   70,497 rows, projected_pa strictly within 25..245
     *   NULL depth role        236 rows (0.33%), raw unsnapped PA — 1, 2, 4, 6, 10, 17, 34 ...
     *
     * So the role does not merely label a player: it REPLACES raw PA with the bucket for that role.
     * bench 25 · utility 85 · platoon_starter 145 · everyday_starter 215 · cornerstone 245.
     *
     * ⚠ An earlier version of this test asserted every fresh D1 row carries a depth role. That was
     * too strong — Owen Pincince is fresh, D1, and roleless at 7 PA. A player with negligible
     * playing time legitimately has no role. Assert the bucket rule, which is what was measured.
     */
    const BUCKETS = [25, 85, 145, 215, 245];
    const withRole = all().filter(
      (r) => r.division === "D1" && r.hitter_depth_role != null && r.projected_pa > 0,
    );
    expect(withRole.length).toBeGreaterThan(0);
    for (const r of withRole) {
      expect(
        BUCKETS.includes(r.projected_pa),
        `${name(r)} role=${r.hitter_depth_role} has PA ${r.projected_pa}, not a canonical bucket`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("anchor — the PITCHER chain: rate line → projRA9 → pRV+ → pWAR", () => {
  const rows = [...shape("starting_pitcher"), ...shape("relief_pitcher")];

  for (const r of rows) {
    if (r.p_war == null || r.p_rv_plus == null || !r.projected_ip) continue;

    it(`${name(r)} — pWAR ${r.p_war} @ ${r.projected_ip} IP`, () => {
      const got = computePWar(r.p_rv_plus, r.projected_ip);
      expect(got).not.toBeNull();
      expect(Math.abs((got as number) - r.p_war)).toBeLessThan(TOL.war);
    });

    if (r.p_k9 != null && r.p_bb9 != null && r.p_hr9 != null) {
      it(`${name(r)} — pRV+ ${r.p_rv_plus} from K/BB/HR per 9`, () => {
        expect(computeProjRA9(r.p_k9, r.p_bb9, r.p_hr9)).not.toBeNull();
        const prv = computePrvPlus(r.p_k9, r.p_bb9, r.p_hr9) as number;
        expect(Math.abs(prv - r.p_rv_plus)).toBeLessThan(TOL.rating);
      });
    }
  }
});

describe("anchor — depth-role IP is what drives pWAR", () => {
  // The Neiswonger regression: pWAR read a stored projected_ip instead of the depth role,
  // giving 1.14 instead of 3.329 and $99k instead of $332,852.
  it("starters carry starter-scale IP, never collapsing to reliever scale", () => {
    const sps = shape("starting_pitcher");
    expect(sps.length).toBeGreaterThan(0);
    for (const r of sps) expect(r.projected_ip, name(r)).toBeGreaterThanOrEqual(60);
  });

  it("at a fixed pRV+, more IP means more pWAR", () => {
    const r = shape("starting_pitcher")[0];
    expect(computePWar(r.p_rv_plus, 100) as number).toBeGreaterThan(computePWar(r.p_rv_plus, 20) as number);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("anchor — two-way players carry both sides on ONE row", () => {
  const twps = shape("two_way");

  it("the shared market_value stays NULL; values live in the twp_* columns", () => {
    expect(twps.length).toBeGreaterThan(0);
    for (const r of twps) {
      expect(r.market_value, `${name(r)} has a shared market_value`).toBeNull();
      expect(
        r.twp_hitter_market_value != null || r.twp_pitcher_market_value != null,
        `${name(r)} has neither twp_* value`,
      ).toBe(true);
    }
  });

  it("is flagged is_twp — the flag routes the own-side lookup", () => {
    for (const r of twps) expect(r.is_twp, name(r)).toBe(true);
  });
});

describe("anchor — zero is missing, not a value", () => {
  it("the zero/null scouting-input population still exists and still projects", () => {
    const rows = shape("zero_scouting_inputs");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const zeroish = [r.ev_score, r.barrel_score, r.chase_score].some((v) => v === 0 || v == null);
      expect(zeroish, `${name(r)} no longer has a zero/null scouting input`).toBe(true);
      expect(r.p_wrc_plus, `${name(r)} lost its projection`).not.toBeNull();
    }
  });
});

describe("anchor — dWAR / bsrWAR convert runs at RUNS_PER_WIN", () => {
  it("13.1 runs is one win", () => {
    expect(RUNS_PER_WIN).toBe(13.1);
    expect(computeDWar(13.1)).toBeCloseTo(1.0, 6);
    expect(computeBsrWar(13.1)).toBeCloseTo(1.0, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("anchor — D1 TRANSFER oWAR reproduces", () => {
  /**
   * THE TRUTH, established 2026-09-02 after three wrong turns:
   *
   *   `player_predictions` is keyed on (player_id, customer_team_id, model_type, variant, SEASON),
   *   enforced by a UNIQUE INDEX, and the precompute already UPSERTs on exactly that key.
   *   Grouped by the real key there are ZERO duplicate rows. D1 transfer oWAR reproduces from
   *   computeOWar(p_wrc_plus, projected_pa) for the current projection season.
   *
   *   Rows carrying an older `updated_at` are SEASON-2026 rows. 2027 is the projection season;
   *   2026 is last season, is not re-baked, and is never read — every read path filters
   *   `.eq("season", PROJECTION_SEASON)`.
   *
   *   The one genuinely stale population is JUCO: ~33.9k season-2027 NJCAA_D1 rows blocked by the
   *   no_from_conf guard. Workstream C, already known.
   *
   * ⚠ HOW THIS SUITE GOT IT WRONG THREE TIMES — kept because the pattern matters more than the
   *   conclusion. Each error was the same shape: an aggregate grouped WITHOUT a key column.
   *
   *     grouped without `division`    JUCO reproduces at 0.1% and swamped D1's 97.8%; reported ~60%
   *                                   and built a "regression to the mean" theory on it. Cause C1,
   *                                   repeated — the same mistake that made ERAs run 4% low.
   *     grouped without `updated_at`  stale-looking rows read as an implementation disagreement
   *     grouped without `season`      2026 and 2027 rows read as duplicates; nearly recommended
   *                                   DELETING 7,255 legitimate season-2026 rows as "the safe option"
   *
   *   Each missing column was one query away. ⇒ READ A TABLE'S UNIQUE CONSTRAINTS BEFORE
   *   AGGREGATING OVER IT. See docs/PHILOSOPHY.md §17.
   */
  const rows = all().filter(
    (r) => r.division === "D1" && r.model_type === "transfer" && r.o_war != null
      && r.p_wrc_plus != null && r.projected_pa > 0 && r.hitter_depth_role != null,
  );

  it("D1 transfer rows are present in the fixture", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const r of rows) {
    it(`${name(r)} — oWAR ${r.o_war} @ wRC+ ${r.p_wrc_plus} / ${r.projected_pa} PA`, () => {
      const got = computeOWar(r.p_wrc_plus, r.projected_pa);
      expect(got).not.toBeNull();
      expect(Math.abs((got as number) - r.o_war)).toBeLessThan(TOL.war);
    });
  }
});

describe("⚠ anchor — JUCO pinned at CURRENT behaviour, not correct behaviour", () => {
  /**
   * MEASURED 2026-09-02: JUCO transfer oWAR reproduces on 10 of 19,034 rows — 0.1%. Not "62% stale";
   * effectively the whole population is wrong. The no_from_conf guard blocks JUCO sources whose
   * origin conference has no stored env+, and blocked rows are never rewritten.
   *
   * ⛔ JUCO IS EXCLUDED FROM EVERY OTHER ASSERTION IN THIS FILE. Including it silently drags any
   *    cross-division measurement to a meaningless middle — that is exactly what happened when the
   *    transfer path was first (wrongly) reported as 60% divergent.
   *
   * Pinned as BROKEN so a JUCO fix shows up as an explicit, reviewable diff. EXPECT THESE TO FAIL
   * when workstream C lands — that is the anchor doing its job.
   */
  const rows = shape("juco_transfer");

  it("JUCO rows are division NJCAA_D1 (not 'JUCO')", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.division).toBe("NJCAA_D1");
  });

  it("still carries a projection", () => {
    for (const r of rows) {
      expect(r.o_war != null || r.p_war != null, `${name(r)} lost both WAR values`).toBe(true);
    }
  });

  it("JUCO oWAR does NOT reproduce — pinned as broken, not endorsed", () => {
    const withPa = rows.filter((r) => r.o_war != null && r.p_wrc_plus != null && r.projected_pa > 0);
    if (!withPa.length) return;
    const reproduce = withPa.filter(
      (r) => Math.abs((computeOWar(r.p_wrc_plus, r.projected_pa) as number) - r.o_war) < TOL.war,
    );
    expect(
      reproduce.length < withPa.length,
      "JUCO now fully reproduces — workstream C may have landed. Re-freeze deliberately.",
    ).toBe(true);
  });
});
