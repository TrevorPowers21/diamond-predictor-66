import { describe, it, expect } from "vitest";
import {
  applyJucoOutlierRegression,
  JUCO_REGRESSION_CONFIG,
  transferWeightsForSource,
  TRANSFER_WEIGHT_DEFAULTS,
  JUCO_TRANSFER_WEIGHTS,
  jucoDistrictNameFromConference,
  JUCO_DISTRICT_HTP_OVERRIDE,
} from "./transferWeightDefaults";

// ── applyJucoOutlierRegression ────────────────────────────────────────────────

describe("applyJucoOutlierRegression", () => {
  const { avg, obp, iso } = JUCO_REGRESSION_CONFIG;

  describe("below or at threshold → pass through unchanged", () => {
    it("AVG .300 (below .350 threshold)", () => {
      expect(applyJucoOutlierRegression(0.300, avg.mean, avg.threshold, avg.slope, avg.maxR)).toBe(0.300);
    });
    it("OBP .400 (below .450 threshold)", () => {
      expect(applyJucoOutlierRegression(0.400, obp.mean, obp.threshold, obp.slope, obp.maxR)).toBe(0.400);
    });
    it("ISO .200 (below .280 threshold)", () => {
      expect(applyJucoOutlierRegression(0.200, iso.mean, iso.threshold, iso.slope, iso.maxR)).toBe(0.200);
    });
    it("exactly at AVG threshold (.350)", () => {
      expect(applyJucoOutlierRegression(avg.threshold, avg.mean, avg.threshold, avg.slope, avg.maxR)).toBe(avg.threshold);
    });
    it("exactly at OBP threshold (.450)", () => {
      expect(applyJucoOutlierRegression(obp.threshold, obp.mean, obp.threshold, obp.slope, obp.maxR)).toBe(obp.threshold);
    });
  });

  describe("above threshold → pulls toward mean (weighted blend)", () => {
    it("AVG .400: pulled down but stays above NCAA mean (.280)", () => {
      const result = applyJucoOutlierRegression(0.400, avg.mean, avg.threshold, avg.slope, avg.maxR);
      expect(result).toBeLessThan(0.400);
      expect(result).toBeGreaterThan(avg.mean);
    });

    it("AVG .400: exact blend formula — r = min(maxR, (0.400-0.350)*1.12) = 0.056", () => {
      const rawStat = 0.400;
      const r = Math.min(avg.maxR, (rawStat - avg.threshold) * avg.slope); // 0.056
      const expected = rawStat * (1 - r) + avg.mean * r;
      const result = applyJucoOutlierRegression(rawStat, avg.mean, avg.threshold, avg.slope, avg.maxR);
      expect(result).toBeCloseTo(expected, 8);
    });

    it("OBP .500: exact blend formula", () => {
      const rawStat = 0.500;
      const r = Math.min(obp.maxR, (rawStat - obp.threshold) * obp.slope);
      const expected = rawStat * (1 - r) + obp.mean * r;
      expect(applyJucoOutlierRegression(rawStat, obp.mean, obp.threshold, obp.slope, obp.maxR)).toBeCloseTo(expected, 8);
    });

    it("ISO .350: exact blend formula", () => {
      const rawStat = 0.350;
      const r = Math.min(iso.maxR, (rawStat - iso.threshold) * iso.slope);
      const expected = rawStat * (1 - r) + iso.mean * r;
      expect(applyJucoOutlierRegression(rawStat, iso.mean, iso.threshold, iso.slope, iso.maxR)).toBeCloseTo(expected, 8);
    });
  });

  describe("regression caps at maxR for extreme outliers", () => {
    it("AVG .500 caps at maxR=0.10 (r would be 0.168 uncapped)", () => {
      const rawStat = 0.500;
      // uncapped r = (0.500-0.350)*1.12 = 0.168, capped at 0.10
      const expected = rawStat * (1 - avg.maxR) + avg.mean * avg.maxR;
      expect(applyJucoOutlierRegression(rawStat, avg.mean, avg.threshold, avg.slope, avg.maxR)).toBeCloseTo(expected, 8);
    });

    it("ISO .500 caps at maxR=0.15", () => {
      const rawStat = 0.500;
      // uncapped r = (0.500-0.280)*1.50 = 0.33, capped at 0.15
      const expected = rawStat * (1 - iso.maxR) + iso.mean * iso.maxR;
      expect(applyJucoOutlierRegression(rawStat, iso.mean, iso.threshold, iso.slope, iso.maxR)).toBeCloseTo(expected, 8);
    });
  });

  describe("non-finite inputs", () => {
    it("NaN passes through (non-finite guard)", () => {
      const result = applyJucoOutlierRegression(NaN, avg.mean, avg.threshold, avg.slope, avg.maxR);
      expect(Number.isNaN(result)).toBe(true);
    });
    it("Infinity passes through (non-finite guard)", () => {
      const result = applyJucoOutlierRegression(Infinity, avg.mean, avg.threshold, avg.slope, avg.maxR);
      expect(result).toBe(Infinity);
    });
  });

  describe("regression config constants sanity checks", () => {
    it("all maxR values are positive and ≤ 1", () => {
      for (const [, cfg] of Object.entries(JUCO_REGRESSION_CONFIG)) {
        expect(cfg.maxR).toBeGreaterThan(0);
        expect(cfg.maxR).toBeLessThanOrEqual(1);
      }
    });
    it("all means are below their thresholds (mean < threshold)", () => {
      expect(avg.mean).toBeLessThan(avg.threshold);
      expect(obp.mean).toBeLessThan(obp.threshold);
      expect(iso.mean).toBeLessThan(iso.threshold);
    });
    it("ISO allows more regression than AVG or OBP (higher maxR)", () => {
      expect(iso.maxR).toBeGreaterThan(avg.maxR);
      expect(iso.maxR).toBeGreaterThan(obp.maxR);
    });
  });
});

// ── transferWeightsForSource ──────────────────────────────────────────────────

describe("transferWeightsForSource", () => {
  it("returns JUCO weights for NJCAA_D1 division", () => {
    expect(transferWeightsForSource("NJCAA_D1")).toBe(JUCO_TRANSFER_WEIGHTS);
  });
  it("returns D1 defaults for null", () => {
    expect(transferWeightsForSource(null)).toBe(TRANSFER_WEIGHT_DEFAULTS);
  });
  it("returns D1 defaults for undefined", () => {
    expect(transferWeightsForSource(undefined)).toBe(TRANSFER_WEIGHT_DEFAULTS);
  });
  it("returns D1 defaults for empty string", () => {
    expect(transferWeightsForSource("")).toBe(TRANSFER_WEIGHT_DEFAULTS);
  });
  it("returns D1 defaults for any other D1 division string", () => {
    expect(transferWeightsForSource("NCAA_D1")).toBe(TRANSFER_WEIGHT_DEFAULTS);
    expect(transferWeightsForSource("D2")).toBe(TRANSFER_WEIGHT_DEFAULTS);
  });

  describe("JUCO weights vs D1 weights structural differences", () => {
    it("JUCO has zero park weights (no park factor data)", () => {
      expect(JUCO_TRANSFER_WEIGHTS.t_ba_park_weight).toBe(0);
      expect(JUCO_TRANSFER_WEIGHTS.t_obp_park_weight).toBe(0);
      expect(JUCO_TRANSFER_WEIGHTS.t_iso_park_weight).toBe(0);
    });
    it("D1 has non-zero park weights", () => {
      expect(TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight).toBeGreaterThan(0);
      expect(TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight).toBeGreaterThan(0);
      expect(TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight).toBeGreaterThan(0);
    });
    it("JUCO has higher conference weights to compensate for zero park", () => {
      expect(JUCO_TRANSFER_WEIGHTS.t_ba_conference_weight).toBeGreaterThan(
        TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight,
      );
    });
    it("JUCO has higher pitching weights (stronger adjustment for competition gap)", () => {
      expect(JUCO_TRANSFER_WEIGHTS.t_ba_pitching_weight).toBeGreaterThan(
        TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight,
      );
    });
    it("JUCO has zero power weights (no PR blend)", () => {
      expect(JUCO_TRANSFER_WEIGHTS.t_ba_power_weight).toBe(0);
      expect(JUCO_TRANSFER_WEIGHTS.t_obp_power_weight).toBe(0);
      expect(JUCO_TRANSFER_WEIGHTS.t_iso_power_weight).toBe(0);
    });
    it("D1 has non-zero power weights (70% PR blend)", () => {
      expect(TRANSFER_WEIGHT_DEFAULTS.t_ba_power_weight).toBe(0.70);
      expect(TRANSFER_WEIGHT_DEFAULTS.t_obp_power_weight).toBe(0.70);
      expect(TRANSFER_WEIGHT_DEFAULTS.t_iso_power_weight).toBe(0.70);
    });
  });
});

// ── jucoDistrictNameFromConference ────────────────────────────────────────────

describe("jucoDistrictNameFromConference", () => {
  it.each([
    ["NJCAA D1 Midwest District", "Midwest"],
    ["NJCAA D1 South Atlantic District", "South Atlantic"],
    ["NJCAA D1 East District", "East"],
    ["NJCAA D1 Southwest District", "Southwest"],
  ])('strips prefix and suffix: "%s" → "%s"', (input, expected) => {
    expect(jucoDistrictNameFromConference(input)).toBe(expected);
  });

  it("strips prefix but not absent suffix", () => {
    expect(jucoDistrictNameFromConference("NJCAA D1 West")).toBe("West");
  });

  it("is case-insensitive for prefix stripping", () => {
    expect(jucoDistrictNameFromConference("njcaa d1 Midwest District")).toBe("Midwest");
  });

  it("returns null for null", () => {
    expect(jucoDistrictNameFromConference(null)).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(jucoDistrictNameFromConference("")).toBeNull();
  });
  it("returns null when result after stripping is empty", () => {
    expect(jucoDistrictNameFromConference("NJCAA D1 ")).toBeNull();
  });

  describe("all known JUCO districts map through to HTP override keys", () => {
    const knownDistricts = Object.keys(JUCO_DISTRICT_HTP_OVERRIDE);
    const conferences = knownDistricts.map((d) => `NJCAA D1 ${d} District`);

    it.each(conferences)('district from conference "%s" is a known HTP key', (conf) => {
      const district = jucoDistrictNameFromConference(conf);
      expect(district).not.toBeNull();
      expect(knownDistricts).toContain(district);
    });
  });
});

// ── JUCO_DISTRICT_HTP_OVERRIDE sanity ─────────────────────────────────────────

describe("JUCO_DISTRICT_HTP_OVERRIDE sanity checks", () => {
  it("all HTP values are between 60 and 110 (realistic JUCO range)", () => {
    for (const [district, htp] of Object.entries(JUCO_DISTRICT_HTP_OVERRIDE)) {
      expect(htp, `${district} HTP out of range`).toBeGreaterThanOrEqual(60);
      expect(htp, `${district} HTP out of range`).toBeLessThanOrEqual(110);
    }
  });
  it("South Atlantic (FL) has the highest HTP (strongest JUCO district)", () => {
    const values = Object.values(JUCO_DISTRICT_HTP_OVERRIDE);
    expect(JUCO_DISTRICT_HTP_OVERRIDE["South Atlantic"]).toBe(Math.max(...values));
  });
  it("East (NY/NJ/MD) has the lowest HTP (weakest JUCO district)", () => {
    const values = Object.values(JUCO_DISTRICT_HTP_OVERRIDE);
    expect(JUCO_DISTRICT_HTP_OVERRIDE["East"]).toBe(Math.min(...values));
  });
});
