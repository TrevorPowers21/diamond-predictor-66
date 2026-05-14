import { readFileSync, statSync } from "node:fs";

export function parseHeader(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((h) => h.replace(/^"|"$/g, ""));
}

export type CsvProbe = {
  filePath: string;
  fileName: string;
  header: string[];
  headerLower: string[];
  rowCountEstimate: number;
  firstRow: string[] | null;
  byteSize: number;
  mtimeMs: number;
};

export function probeCsv(filePath: string): CsvProbe {
  const text = readFileSync(filePath, "utf8");
  const byteSize = Buffer.byteLength(text, "utf8");
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const header = nonEmpty.length > 0 ? parseHeader(nonEmpty[0]) : [];
  const firstRow = nonEmpty.length > 1 ? parseHeader(nonEmpty[1]) : null;
  const fileName = filePath.split("/").pop() || filePath;
  const mtimeMs = statSync(filePath).mtimeMs;
  return {
    filePath,
    fileName,
    header,
    headerLower: header.map((h) => h.toLowerCase()),
    rowCountEstimate: Math.max(0, nonEmpty.length - 1),
    firstRow,
    byteSize,
    mtimeMs,
  };
}
