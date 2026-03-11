const normalize = (value: string | null | undefined) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getConferenceAliases = (conference: string | null | undefined): string[] => {
  const key = normalize(conference);
  if (!key) return [];

  const keyNoYear = key.replace(/\b(20\d{2}|25)\b/g, " ").replace(/\s+/g, " ").trim();
  const compact = keyNoYear.replace(/\s+/g, "");

  const aliases = new Set<string>([
    key,
    keyNoYear,
    key.replace(" conference", "").trim(),
    keyNoYear.replace(" conference", "").trim(),
  ]);

  if (keyNoYear === "sec" || keyNoYear.includes("southeastern")) aliases.add("southeastern conference");
  if (keyNoYear === "acc" || keyNoYear.includes("atlantic coast")) aliases.add("atlantic coast conference");
  if (keyNoYear === "big 12" || keyNoYear === "big12" || keyNoYear.includes("big 12")) aliases.add("big 12");
  if (
    keyNoYear === "big ten" ||
    keyNoYear === "big10" ||
    keyNoYear === "big 10" ||
    keyNoYear.includes("big ten") ||
    keyNoYear.includes("big 10")
  ) {
    aliases.add("big ten");
    aliases.add("big10");
    aliases.add("big 10");
  }
  if (keyNoYear === "aac" || keyNoYear.includes("american athletic")) aliases.add("american athletic conference");
  if (
    keyNoYear === "a 10" ||
    keyNoYear === "a10" ||
    keyNoYear === "a-10" ||
    keyNoYear.includes("atlantic 10") ||
    keyNoYear.includes("atlantic ten") ||
    compact === "atlantic10"
  ) {
    aliases.add("atlantic 10");
    aliases.add("a 10");
    aliases.add("a10");
  }
  if (keyNoYear === "caa" || keyNoYear.includes("coastal athletic")) aliases.add("coastal athletic association");
  if (keyNoYear === "mac" || keyNoYear.includes("mid american")) aliases.add("mid american conference");
  if (keyNoYear === "mvc" || keyNoYear.includes("missouri valley")) aliases.add("missouri valley conference");
  if (keyNoYear === "nec" || keyNoYear.includes("northeast")) aliases.add("northeast conference");
  if (keyNoYear === "wac" || keyNoYear.includes("western athletic")) aliases.add("western athletic conference");
  if (keyNoYear === "wcc" || keyNoYear.includes("west coast")) aliases.add("west coast conference");
  if (keyNoYear === "cusa" || keyNoYear.includes("conference usa")) aliases.add("conference usa");
  if (keyNoYear === "mwc" || keyNoYear.includes("mountain west") || compact.includes("mountainwest")) {
    aliases.add("mountain west");
    aliases.add("mwc");
    aliases.add("mountain west conference");
  }
  if (keyNoYear === "big west" || keyNoYear.includes("big west")) aliases.add("big west");
  if (keyNoYear === "sun belt" || keyNoYear.includes("sun belt")) aliases.add("sun belt");
  if (keyNoYear === "asun" || keyNoYear.includes("atlantic sun")) aliases.add("atlantic sun conference");
  if (
    keyNoYear === "a east" ||
    keyNoYear === "ae" ||
    keyNoYear === "aec" ||
    keyNoYear.includes("america east") ||
    keyNoYear.includes("american east")
  ) {
    aliases.add("america east");
    aliases.add("american east");
  }
  if (keyNoYear === "bsc" || keyNoYear.includes("big south")) aliases.add("big south conference");
  if (keyNoYear === "be" || keyNoYear.includes("big east")) aliases.add("big east conference");
  if (keyNoYear === "maac" || keyNoYear.includes("metro atlantic")) aliases.add("metro atlantic athletic conference");
  if (keyNoYear === "patriot" || keyNoYear.includes("patriot league")) aliases.add("patriot league");
  if (keyNoYear === "ivy" || keyNoYear.includes("ivy league")) aliases.add("ivy league");
  if (keyNoYear === "summit" || keyNoYear.includes("summit league")) aliases.add("summit league");
  if (keyNoYear.includes("southland")) aliases.add("southland conference");
  if (keyNoYear === "socon" || keyNoYear.includes("southern conference")) aliases.add("southern conference");
  if (keyNoYear === "ovc" || keyNoYear.includes("ohio valley")) aliases.add("ohio valley conference");
  if (keyNoYear === "swac" || keyNoYear.includes("southwestern athletic")) aliases.add("southwestern athletic conference");

  return Array.from(aliases);
};

