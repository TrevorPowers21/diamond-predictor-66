import { describe, expect, it } from "vitest";
import { getConferenceAliases } from "@/lib/conferenceMapping";

describe("getConferenceAliases", () => {
  it("maps Atlantic 10 variants", () => {
    const aliases = getConferenceAliases("A-10 2025");
    expect(aliases).toContain("atlantic 10");
    expect(aliases).toContain("a10");
  });

  it("maps Mountain West variants", () => {
    const aliases = getConferenceAliases("MWC");
    expect(aliases).toContain("mountain west");
    expect(aliases).toContain("mwc");
  });

  it("maps America/American East variants", () => {
    const aliases = getConferenceAliases("American East");
    expect(aliases).toContain("american east");
    expect(aliases).toContain("america east");
  });
});

