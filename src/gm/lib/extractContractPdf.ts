import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfExtract {
  total_value: number | null; // largest $ amount found (usually the contract value)
  start_date: string | null;  // earliest date found (YYYY-MM-DD)
  end_date: string | null;    // latest date found (YYYY-MM-DD)
  text: string;               // full extracted text (for reference)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

// Pull every date we can recognize (ISO, US slash, and "Month D, YYYY").
function findDates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const s = iso(+m[1], +m[2], +m[3]); if (s) out.add(s);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const s = iso(y, +m[1], +m[2]); if (s) out.add(s);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) { const s = iso(+m[3], mo, +m[2]); if (s) out.add(s); }
  }
  return [...out].sort();
}

// Largest dollar figure in the doc — the contract value is almost always the biggest number.
function findTopDollar(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && (max == null || n > max)) max = n;
  }
  return max;
}

/**
 * Read a contract PDF entirely in the browser (no AI, no network). Extracts the
 * text and best-effort auto-fills the dollar value + start/end dates. It does NOT
 * understand the contract — the coach reviews/corrects everything before saving.
 */
export async function extractContractPdf(file: File): Promise<PdfExtract> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  const dates = findDates(text);
  return {
    total_value: findTopDollar(text),
    start_date: dates[0] ?? null,
    end_date: dates.length > 1 ? dates[dates.length - 1] : null,
    text,
  };
}
