import { describe, it, expect } from "vitest";
import {
  canonPosition,
  needMultiplierForPosition,
  championshipBarForPosition,
  rosterPositionState,
  computeRosterNeeds,
  needMultiplierForTarget,
  CHAMPIONSHIP_STARTER_BAR,
} from "./positionNeed";

describe("canonPosition", () => {
  it("normalizes specific + verbose labels", () => {
    expect(canonPosition("catcher")).toBe("C");
    expect(canonPosition("Center Field")).toBe("CF");
    expect(canonPosition("shortstop")).toBe("SS");
    expect(canonPosition("1B")).toBe("1B");
  });
  it("keeps generic pitch-log labels generic", () => {
    expect(canonPosition("OF")).toBe("OF");
    expect(canonPosition("IF")).toBe("IF");
    expect(canonPosition("INF")).toBe("IF");
  });
  it("returns null for unknown", () => {
    expect(canonPosition("")).toBeNull();
    expect(canonPosition("PH")).toBeNull();
  });
});

describe("needMultiplierForPosition (the ladder)", () => {
  it("premium 1.3 for C, SS, and weekend starters", () => {
    expect(needMultiplierForPosition("C")).toBe(1.3);
    expect(needMultiplierForPosition("SS")).toBe(1.3);
    expect(needMultiplierForPosition("P", { isWeekendStarter: true })).toBe(1.3);
  });
  it("moderate 1.1 for all OF (incl CF), 2B, 3B, and generic OF/IF", () => {
    for (const p of ["LF", "CF", "RF", "OF", "2B", "3B", "IF"]) {
      expect(needMultiplierForPosition(p)).toBe(1.1);
    }
  });
  it("generic IF is 1.1, never auto-credited SS's 1.3", () => {
    expect(needMultiplierForPosition("IF")).toBe(1.1);
  });
  it("neutral 1.0 for 1B, DH, relievers, unknown", () => {
    expect(needMultiplierForPosition("1B")).toBe(1.0);
    expect(needMultiplierForPosition("DH")).toBe(1.0);
    expect(needMultiplierForPosition("P")).toBe(1.0); // non-weekend-starter
    expect(needMultiplierForPosition("weird")).toBe(1.0);
  });
});

describe("championshipBarForPosition", () => {
  it("returns the stamped per-position bar", () => {
    expect(championshipBarForPosition("C")).toBe(CHAMPIONSHIP_STARTER_BAR.C);
    expect(championshipBarForPosition("SS")).toBe(1.42);
    expect(championshipBarForPosition("RF")).toBe(1.88);
  });
  it("weekend starter gets the wSP bar; other pitchers get none", () => {
    expect(championshipBarForPosition("P", { isWeekendStarter: true })).toBe(3.06);
    expect(championshipBarForPosition("P")).toBeNull();
  });
  it("generic OF/IF use the group average", () => {
    expect(championshipBarForPosition("OF")).toBeCloseTo((1.7 + 1.74 + 1.88) / 3, 5);
    expect(championshipBarForPosition("IF")).toBeCloseTo((1.42 + 1.48 + 1.57) / 3, 5);
  });
});

describe("rosterPositionState", () => {
  it("solid when a slotted player clears the bar", () => {
    expect(rosterPositionState(1.42, [0.5, 1.6, null])).toBe("solid");
  });
  it("hole when nobody clears (empty or thin both price as hole)", () => {
    expect(rosterPositionState(1.42, [])).toBe("hole"); // empty
    expect(rosterPositionState(1.42, [0.3, 1.1])).toBe("hole"); // thin
  });
  it("freshman / no-history (0 or null) does not clear", () => {
    expect(rosterPositionState(1.42, [0, null, undefined])).toBe("hole");
  });
  it("no bar (reliever) is never a need", () => {
    expect(rosterPositionState(null, [])).toBe("solid");
  });
});

describe("computeRosterNeeds + needMultiplierForTarget", () => {
  it("a spot with a championship-caliber returner is not a hole (no premium)", () => {
    const holes = computeRosterNeeds([{ position: "C", war: 2.5 }]); // > C bar 2.11
    expect(holes.has("C")).toBe(false);
    expect(needMultiplierForTarget(holes, "C")).toBe(1.0);
  });
  it("a below-bar or empty spot is a hole → full ladder premium", () => {
    const holes = computeRosterNeeds([{ position: "C", war: 1.0 }]); // < 2.11
    expect(holes.has("C")).toBe(true);
    expect(needMultiplierForTarget(holes, "C")).toBe(1.3);
    // SS never slotted → hole → 1.3
    expect(holes.has("SS")).toBe(true);
    expect(needMultiplierForTarget(holes, "SS")).toBe(1.3);
    // an OF target on an empty OF → 1.1
    expect(needMultiplierForTarget(holes, "CF")).toBe(1.1);
  });
  it("generic OF returner covers all OF spots; generic IF covers 2B/3B but NOT SS", () => {
    const holes = computeRosterNeeds([
      { position: "OF", war: 3.0 }, // clears every OF bar → LF/CF/RF solid
      { position: "IF", war: 3.0 }, // clears 2B/3B bars, but must NOT cover SS
    ]);
    expect(needMultiplierForTarget(holes, "CF")).toBe(1.0); // OF covered
    expect(needMultiplierForTarget(holes, "2B")).toBe(1.0); // IF covers 2B
    expect(holes.has("SS")).toBe(true); // SS still a hole (IF didn't cover it)
    expect(needMultiplierForTarget(holes, "SS")).toBe(1.3);
  });
  it("1B/DH targets never get a premium even when empty", () => {
    const holes = computeRosterNeeds([]);
    expect(needMultiplierForTarget(holes, "1B")).toBe(1.0);
    expect(needMultiplierForTarget(holes, "DH")).toBe(1.0);
  });
  it("weekend SP: hole only counts flagged weekend starters; target needs the flag", () => {
    const holeNoWsp = computeRosterNeeds([{ position: "P", war: 4.0, isWeekendStarter: false }]);
    expect(holeNoWsp.has("weekend_SP")).toBe(true); // the 4.0 arm wasn't flagged wSP
    expect(needMultiplierForTarget(holeNoWsp, "P", { isWeekendStarter: true })).toBe(1.3);
    const solidWsp = computeRosterNeeds([{ position: "P", war: 3.5, isWeekendStarter: true }]);
    expect(solidWsp.has("weekend_SP")).toBe(false); // clears 3.06
    expect(needMultiplierForTarget(solidWsp, "P", { isWeekendStarter: true })).toBe(1.0);
    // a reliever target (not flagged) never gets the premium
    expect(needMultiplierForTarget(holeNoWsp, "P")).toBe(1.0);
  });
});
