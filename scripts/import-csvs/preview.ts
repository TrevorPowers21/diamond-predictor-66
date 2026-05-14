import type { DetectionResult } from "./detector.ts";
import { PIPELINE_LABELS, type PipelineStep } from "./registry.ts";

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function confidenceBadge(c: DetectionResult["confidence"]): string {
  switch (c) {
    case "high":
      return `${COLOR.green}✓${COLOR.reset}`;
    case "medium":
      return `${COLOR.yellow}~${COLOR.reset}`;
    case "low":
      return `${COLOR.yellow}?${COLOR.reset}`;
    case "none":
      return `${COLOR.red}✗${COLOR.reset}`;
  }
}

function fmtRows(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type PreviewInput = {
  results: DetectionResult[];
  season: number;
  inboxPath: string;
};

export function renderPreview({ results, season, inboxPath }: PreviewInput): string {
  const out: string[] = [];

  out.push("");
  out.push(`${COLOR.bold}${inboxPath}${COLOR.reset}  →  ${results.length} file${results.length === 1 ? "" : "s"} detected`);
  out.push("");

  if (results.length === 0) {
    out.push(`${COLOR.gray}  (inbox is empty)${COLOR.reset}`);
    out.push("");
    return out.join("\n");
  }

  // Per-file lines
  for (const r of results) {
    const superseded = r.supersededBy !== undefined;
    const badge = superseded ? `${COLOR.gray}—${COLOR.reset}` : confidenceBadge(r.confidence);
    const typeLabelRaw = r.match ? r.match.label : "Unknown";
    const typeLabel = superseded
      ? `${COLOR.gray}${typeLabelRaw} (superseded)${COLOR.reset}`
      : r.match
        ? typeLabelRaw
        : `${COLOR.red}Unknown${COLOR.reset}`;
    const rowCount = `${fmtRows(r.probe.rowCountEstimate)} rows`;
    const size = fmtBytes(r.probe.byteSize);
    const meta = `${rowCount}, ${size}, season ${season}`;
    const namePad = r.probe.fileName.padEnd(50);
    if (superseded) {
      out.push(`  ${badge}  ${COLOR.gray}${namePad}${COLOR.reset}  → ${typeLabel}  ${COLOR.dim}${meta}${COLOR.reset}`);
      out.push(`     ${COLOR.dim}skipped: newer ${r.supersededBy} will be imported instead${COLOR.reset}`);
      continue;
    }
    out.push(`  ${badge}  ${namePad}  → ${typeLabel.padEnd(28)}  ${COLOR.dim}${meta}${COLOR.reset}`);
    if (r.confidence === "medium" || r.confidence === "low") {
      out.push(`     ${COLOR.dim}${r.reason}${COLOR.reset}`);
    }
    if (!r.match) {
      out.push(`     ${COLOR.red}${r.reason}${COLOR.reset}`);
      if (r.alternates.length > 0) {
        const alts = r.alternates.map((a) => `${a.entry.label} (${a.score})`).join(", ");
        out.push(`     ${COLOR.dim}closest: ${alts}${COLOR.reset}`);
      }
    }
  }

  // Pipeline plan
  const pipeline = computePipelinePlan(results);
  if (pipeline.length > 0) {
    out.push("");
    out.push(`${COLOR.bold}Pipeline plan${COLOR.reset} (after imports):`);
    for (const step of pipeline) {
      out.push(`  • ${PIPELINE_LABELS[step]}`);
    }
  }

  // Skipped count
  const skipped = results.filter((r) => !r.match);
  if (skipped.length > 0) {
    out.push("");
    out.push(`${COLOR.yellow}${skipped.length} file${skipped.length === 1 ? "" : "s"} will be skipped${COLOR.reset} (moved to failed/ for inspection).`);
  }

  out.push("");
  return out.join("\n");
}

export function computePipelinePlan(results: DetectionResult[]): PipelineStep[] {
  const triggered = new Set<PipelineStep>();
  for (const r of results) {
    if (!r.match) continue;
    if (r.supersededBy !== undefined) continue;
    for (const step of r.match.downstream) triggered.add(step);
  }
  // Ordered canonical sequence: master imports run first, then Stuff+ chain
  // (velo_diff → reclassify → stuff_plus_recompute → rollup), then NCAA
  // averages + scores, then final recalc.
  const order: PipelineStep[] = [
    "sync_master_to_players",
    "add_missing_players",
    "create_predictions",
    "velo_diff",
    "reclassify",
    "stuff_plus_recompute",
    "rollup_stuff_plus",
    "ncaa_averages",
    "compute_scores",
    "recalculate",
  ];
  return order.filter((s) => triggered.has(s));
}
