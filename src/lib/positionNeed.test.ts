import { describe, it, expect } from "vitest";
import {
  canonPosition,
  needMultiplierForPosition,
  championshipBarForPosition,
  rosterPositionState,
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
