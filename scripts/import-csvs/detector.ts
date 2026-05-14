import type { CsvProbe } from "./csv.ts";
import { REGISTRY, type CsvType, type RegistryEntry } from "./registry.ts";

export type DetectionResult = {
  probe: CsvProbe;
  match: RegistryEntry | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
  alternates: Array<{ entry: RegistryEntry; score: number }>;
  /**
   * Set when another file of the same single-instance type has a newer
   * mtime — this file would be overwritten and is excluded from the queue.
   */
  supersededBy?: string;
};

type Scored = { entry: RegistryEntry; required: number; signature: number; filename: boolean };

function hasColumnCI(header: string[], target: string): boolean {
  const t = target.toLowerCase();
  return header.some((h) => h.toLowerCase() === t);
}

function scoreEntry(probe: CsvProbe, entry: RegistryEntry): Scored {
  const requiredMatched = entry.required.filter((r) => hasColumnCI(probe.header, r)).length;
  const signatureMatched = entry.signature.filter((s) => hasColumnCI(probe.header, s)).length;
  const filenameMatched = entry.filenameHints.some((rx) => rx.test(probe.fileName));
  return {
    entry,
    required: requiredMatched,
    signature: signatureMatched,
    filename: filenameMatched,
  };
}

function compositeScore(s: Scored): number {
  // required is gated separately — entries missing required are eliminated upstream.
  // Within remaining entries, sort by signature count (with filename hint as a small bump).
  return s.signature * 10 + (s.filename ? 5 : 0);
}

export function detect(probe: CsvProbe): DetectionResult {
  if (probe.header.length === 0) {
    return {
      probe,
      match: null,
      confidence: "none",
      reason: "Empty file (no header row).",
      alternates: [],
    };
  }

  const scored = REGISTRY.map((entry) => scoreEntry(probe, entry));

  // Eliminate entries missing any required column
  const eligible = scored.filter((s) => s.required === s.entry.required.length);

  if (eligible.length === 0) {
    // Find the closest near-miss to explain
    const best = [...scored].sort((a, b) => b.required - a.required + (b.signature - a.signature) * 0.01)[0];
    const missing = best.entry.required.filter((r) => !hasColumnCI(probe.header, r));
    return {
      probe,
      match: null,
      confidence: "none",
      reason: `No registry entry matched. Closest: ${best.entry.label} (missing required: ${missing.join(", ")}).`,
      alternates: scored
        .map((s) => ({ entry: s.entry, score: compositeScore(s) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3),
    };
  }

  eligible.sort((a, b) => compositeScore(b) - compositeScore(a));
  const winner = eligible[0];
  const runnerUp = eligible[1];

  let confidence: DetectionResult["confidence"];
  const winnerSig = winner.signature;
  const winnerTotalSig = winner.entry.signature.length;
  const winnerRatio = winnerTotalSig === 0 ? 1 : winnerSig / winnerTotalSig;
  const margin = runnerUp ? compositeScore(winner) - compositeScore(runnerUp) : Infinity;

  if (winnerRatio >= 0.5 && margin >= 10) confidence = "high";
  else if (winnerRatio >= 0.3 && margin >= 5) confidence = "medium";
  else if (winnerRatio > 0) confidence = "low";
  else confidence = "none";

  const filenameNote = winner.filename ? " (filename hint matched)" : "";
  const reason = `Matched ${winnerSig}/${winnerTotalSig} signature columns${filenameNote}.`;

  return {
    probe,
    match: winner.entry,
    confidence,
    reason,
    alternates: eligible
      .slice(1, 4)
      .map((s) => ({ entry: s.entry, score: compositeScore(s) })),
  };
}

/**
 * For each non-multiFile type, keep only the file with the newest mtime;
 * mark all older files as superseded so the dry-run can flag them and the
 * import queue can skip them.
 */
export function dedupeResults(results: DetectionResult[]): DetectionResult[] {
  const byType = new Map<string, DetectionResult[]>();
  for (const r of results) {
    if (!r.match) continue;
    if (r.match.multiFile) continue;
    const arr = byType.get(r.match.type) ?? [];
    arr.push(r);
    byType.set(r.match.type, arr);
  }
  for (const [, arr] of byType) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.probe.mtimeMs - a.probe.mtimeMs);
    const winner = arr[0];
    for (let i = 1; i < arr.length; i++) {
      arr[i].supersededBy = winner.probe.fileName;
    }
  }
  return results;
}

export function inferSeasonFromName(fileName: string, fallback: number): number {
  // Look for 4-digit year between 2020 and 2030
  const match = fileName.match(/(20[2-3]\d)/);
  if (match) {
    const yr = Number(match[1]);
    if (yr >= 2020 && yr <= 2030) return yr;
  }
  return fallback;
}

export type { CsvType };
