import { describe, it, expect } from "vitest";
import { classTransitionFromYear, classTransitionFromYearOrDefault } from "./classTransitionUtils";

describe("classTransitionFromYear", () => {
  describe("Freshman → FS", () => {
    it.each(["FR", "fr", "Freshman", "FRESHMAN", "FRESH"])(
      'maps "%s" to FS',
      (input) => expect(classTransitionFromYear(input)).toBe("FS"),
    );
  });

  describe("Sophomore → SJ", () => {
    it.each(["SO", "so", "Sophomore", "SOPHOMORE", "SOPH"])(
      'maps "%s" to SJ',
      (input) => expect(classTransitionFromYear(input)).toBe("SJ"),
    );
  });

  describe("Junior → JS", () => {
    it.each(["JR", "jr", "Junior", "JUNIOR"])(
      'maps "%s" to JS',
      (input) => expect(classTransitionFromYear(input)).toBe("JS"),
    );
  });

  describe("Senior / Graduate → GR", () => {
    it.each(["SR", "sr", "Senior", "SENIOR", "GR", "Graduate", "GRADUATE", "GRAD", "GS"])(
      'maps "%s" to GR',
      (input) => expect(classTransitionFromYear(input)).toBe("GR"),
    );
  });

  describe("Redshirt prefix stripping (R-, RS-, RS )", () => {
    it("R-FR → FS", () => expect(classTransitionFromYear("R-FR")).toBe("FS"));
    it("RS-FR → FS", () => expect(classTransitionFromYear("RS-FR")).toBe("FS"));
    it("R-SO → SJ", () => expect(classTransitionFromYear("R-SO")).toBe("SJ"));
    it("RS-JR → JS", () => expect(classTransitionFromYear("RS-JR")).toBe("JS"));
    it("R-SR → GR", () => expect(classTransitionFromYear("R-SR")).toBe("GR"));
    it("RS-SR → GR", () => expect(classTransitionFromYear("RS-SR")).toBe("GR"));
  });

  describe("unknown / empty → null", () => {
    it.each([null, undefined, "", "  ", "5th Year", "GRAD TRANSFER", "U23"])(
      'returns null for "%s"',
      (input) => expect(classTransitionFromYear(input)).toBeNull(),
    );
  });
});

describe("classTransitionFromYearOrDefault", () => {
  it("returns the mapped transition when class is known", () => {
    expect(classTransitionFromYearOrDefault("FR")).toBe("FS");
    expect(classTransitionFromYearOrDefault("SR")).toBe("GR");
  });

  it("returns default 'SJ' when class is unknown (preserves legacy behavior)", () => {
    expect(classTransitionFromYearOrDefault(null)).toBe("SJ");
    expect(classTransitionFromYearOrDefault("")).toBe("SJ");
    expect(classTransitionFromYearOrDefault("5th Year")).toBe("SJ");
  });

  it("accepts a custom fallback", () => {
    expect(classTransitionFromYearOrDefault(null, "GR")).toBe("GR");
    expect(classTransitionFromYearOrDefault(undefined, "FS")).toBe("FS");
  });
});
