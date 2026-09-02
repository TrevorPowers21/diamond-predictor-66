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
 * ⚠ COVERAGE IS PARTIAL — READ THIS BEFORE TRUSTING A GREEN RUN (§7 residual risk)
 *   GATED:     the returner path identity, the full pitcher chain, and structural invariants.
 *   NOT GATED: the TRANSFER path's oWAR. Measured 2026-09-02 on prod: returner/regular reproduces
 *              454/454 (100%), transfer/precomputed only 4,597/7,546 (60.9%). The divergence is
 *              systematic — see "transfer-path divergence" below. Gating it needs the transfer
 *              projection's conference/park inputs frozen too, which this fixture does not yet
 *              carry. Anchor-green does NOT mean the transfer path is verified.
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
    (r) => r.model_type === "returner" && r.o_war != null && r.p_wrc_plus != null
      && r.projected_pa > 0 && r.hitter_depth_role != null,
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

describe("⚠ anchor — NULL depth role: projected_pa is NOT the PA the math used", () => {
  /**
   * FINDING, 2026-09-02, surfaced by this suite on its first run.
   *
   * When `hitter_depth_role` is NULL, stored oWAR does not reproduce from `projected_pa` — solving
   * for the PA that fits gives a different number (Magill 176.5 vs a stored 196; Clapp 199 vs 221).
   * This is the depth-role rule showing up from the data side: **PA/IP come from the depth role,
   * and the stored `projected_pa` / `projected_ip` column is not what the projection used.**
   *
   * Pinned so the population cannot quietly change. Not a bug report — whether a null depth role
   * should be possible at all is a modelling question (§4.6).
   */
  const nullRole = all().filter(
    (r) => r.o_war != null && r.p_wrc_plus != null && r.projected_pa > 0 && r.hitter_depth_role == null,
  );

  it("the null-depth-role population exists in the fixture", () => {
    expect(nullRole.length).toBeGreaterThan(0);
  });

  it("does NOT satisfy the canonical identity — pinned as a known divergence", () => {
    // If one of these starts reproducing, the population changed. That deserves a conversation,
    // not a silent pass.
    for (const r of nullRole) {
      const canonical = computeOWar(r.p_wrc_plus, r.projected_pa) as number;
      expect(
        Math.abs(canonical - r.o_war) >= TOL.war,
        `${name(r)} now REPRODUCES (stored ${r.o_war}, canonical ${canonical.toFixed(4)}) — ` +
        `the null-depth-role divergence may have been fixed. Re-freeze deliberately.`,
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
describe("⚠ anchor — TRANSFER-PATH DIVERGENCE (pinned, NOT endorsed)", () => {
  /**
   * FINDING, 2026-09-02, surfaced by this suite on its first run.
   *
   * On prod, `o_war` on transfer/precomputed rows does NOT reproduce from
   * computeOWar(p_wrc_plus, projected_pa), while returner rows reproduce 454/454.
   *
   * The divergence is systematic, not noise. Solving for the wRC+ that WOULD produce the stored
   * oWAR gives a value consistently HIGHER than the stored p_wrc_plus, with the gap widening as
   * wRC+ falls:  +5.4 at wRC+ 99  ·  +19.2 at 75  ·  +30.1 at 56.
   *
   * That shape is regression toward the mean. HYPOTHESIS (NOT CONFIRMED): the transfer path derives
   * oWAR from a pulled-back wRC+ while storing the unregressed projection in p_wrc_plus — plausibly
   * the small-sample pullback. If so it is BY DESIGN, and the consequence is still worth stating:
   * o_war and p_wrc_plus on the same transfer row are not consistent with each other under the
   * canonical formula, so any surface deriving one from the other will disagree with the stored value.
   *
   * ⛔ NOT a bug report, and NOT the agent's call — this is a modeling question (§4.6). Trevor decides.
   *
   * These tests pin the divergence AS IT IS so it cannot change silently in either direction.
   */
  const transfers = all().filter(
    (r) => r.model_type === "transfer" && r.o_war != null && r.p_wrc_plus != null && r.projected_pa > 0,
  );

  it("transfer rows exist in the fixture", () => {
    expect(transfers.length).toBeGreaterThan(0);
  });

  it("stored transfer oWAR is >= the canonical formula (pullback only ever helps)", () => {
    // If this ever fails, the pullback hypothesis is wrong and the finding needs re-opening.
    for (const r of transfers) {
      const canonical = computeOWar(r.p_wrc_plus, r.projected_pa) as number;
      expect(
        r.o_war >= canonical - TOL.war,
        `${name(r)}: stored ${r.o_war} < canonical ${canonical.toFixed(4)}`,
      ).toBe(true);
    }
  });

  it("below-average transfer hitters diverge; near-average ones barely do", () => {
    const gap = (r: Row) => r.o_war - (computeOWar(r.p_wrc_plus, r.projected_pa) as number);
    const low = transfers.filter((r) => r.p_wrc_plus < 90);
    const near = transfers.filter((r) => r.p_wrc_plus >= 95);
    if (low.length && near.length) {
      const avg = (xs: Row[]) => xs.reduce((a, r) => a + gap(r), 0) / xs.length;
      expect(avg(low), "below-average gap should exceed near-average gap").toBeGreaterThan(avg(near));
    }
  });
});

describe("⚠ anchor — JUCO pinned at CURRENT behaviour, not correct behaviour", () => {
  // ~62% of prod JUCO transfer rows are stale (the no_from_conf guard blocks them, and blocked rows
  // are never rewritten). Pinned so that fixing JUCO shows up as an explicit, reviewable diff rather
  // than passing silently. EXPECT THESE TO FAIL when workstream C lands — that is the anchor working.
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
});
