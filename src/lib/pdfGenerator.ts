/**
 * RSTR IQ Scouting Report — Client-Side PDF Generator
 * Uses jsPDF to render branded player profile pages entirely in the browser.
 */

import jsPDF from "jspdf";
import type { ReportPlayer } from "@/components/ScoutingReport";

// ── Brand constants ─────────────────────────────────────────────────
const NAVY_DARK: [number, number, number] = [4, 8, 16];
const NAVY: [number, number, number] = [10, 20, 40];
const NAVY_CARD: [number, number, number] = [13, 26, 48];
const GOLD: [number, number, number] = [212, 175, 55];
const MUTED: [number, number, number] = [138, 148, 166];
const SLATE: [number, number, number] = [203, 213, 225];
const WHITE: [number, number, number] = [255, 255, 255];

const TIER_GREEN: [number, number, number] = [45, 138, 78];
const TIER_BLUE: [number, number, number] = [37, 99, 235];
const TIER_YELLOW: [number, number, number] = [202, 138, 4];
const TIER_RED: [number, number, number] = [220, 38, 38];

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;

function tierColor(value: number | null | undefined, thresholds = [103, 98, 93]): [number, number, number] {
  if (value == null) return MUTED;
  if (value >= thresholds[0]) return TIER_GREEN;
  if (value >= thresholds[1]) return TIER_BLUE;
  if (value >= thresholds[2]) return TIER_YELLOW;
  return TIER_RED;
}

function gradeInfo(value: number | null | undefined): { label: string; color: [number, number, number] } {
  if (value == null) return { label: "—", color: MUTED };
  if (value >= 90) return { label: "Elite", color: TIER_GREEN };
  if (value >= 75) return { label: "Plus-Plus", color: TIER_GREEN };
  if (value >= 60) return { label: "Plus", color: TIER_BLUE };
  if (value >= 45) return { label: "Average", color: TIER_YELLOW };
  if (value >= 35) return { label: "Below Avg", color: TIER_YELLOW };
  return { label: "Poor", color: TIER_RED };
}

const fmt = (v: number | null | undefined, d = 2) => v == null ? "—" : Number(v).toFixed(d);
const fmt3 = (v: number | null | undefined) => v == null ? "—" : Number(v).toFixed(3);
const pct = (v: number | null | undefined) => v == null ? "—" : String(Math.round(Number(v)));

// ── Drawing helpers ─────────────────────────────────────────────────

function drawRect(doc: jsPDF, x: number, y: number, w: number, h: number, color: [number, number, number]) {
  doc.setFillColor(...color);
  doc.rect(x, y, w, h, "F");
}

function drawRoundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fill: [number, number, number], stroke?: [number, number, number]) {
  doc.setFillColor(...fill);
  if (stroke) {
    doc.setDrawColor(...stroke);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, w, h, r, r, "FD");
  } else {
    doc.roundedRect(x, y, w, h, r, r, "F");
  }
}

function drawHeader(doc: jsPDF, player: ReportPlayer, y: number): number {
  const barH = 36;
  drawRect(doc, MARGIN, y, CONTENT_W, barH, NAVY);
  // Gold left accent
  drawRect(doc, MARGIN, y, 3, barH, GOLD);

  // Name
  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(player.name || "Unknown Player", MARGIN + 10, y + 14);

  // Info line
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GOLD);
  const parts = [player.position, player.school, player.class_year, player.bats_throws].filter(Boolean);
  doc.text(parts.join(" · "), MARGIN + 10, y + 26);

  return y + barH + 8;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setTextColor(...GOLD);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(title, MARGIN, y + 8);
  // Underline
  const tw = doc.getTextWidth(title);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 10, MARGIN + tw, y + 10);
  return y + 16;
}

function drawStatBoxes(doc: jsPDF, labels: string[], values: string[], y: number, colors?: ([number, number, number] | null)[]): number {
  const n = labels.length;
  const colW = CONTENT_W / n;
  const boxH = 30;

  for (let i = 0; i < n; i++) {
    const x = MARGIN + i * colW;
    drawRoundRect(doc, x, y, colW - 3, boxH, 3, NAVY_CARD, [22, 34, 65]);

    // Label
    doc.setTextColor(...MUTED);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    const lbl = labels[i];
    const lw = doc.getTextWidth(lbl);
    doc.text(lbl, x + (colW - 3 - lw) / 2, y + 10);

    // Value
    const vc = colors?.[i] || WHITE;
    doc.setTextColor(...vc);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    const val = values[i];
    const vw = doc.getTextWidth(val);
    doc.text(val, x + (colW - 3 - vw) / 2, y + 24);
  }

  return y + boxH + 6;
}

function drawTable(doc: jsPDF, headers: string[], rows: string[][], y: number, colWidths?: number[], careerRow?: string[]): number {
  const n = headers.length;
  const cw = colWidths || headers.map(() => CONTENT_W / n);
  const rowH = 13;
  const headerH = 14;

  // Header
  drawRect(doc, MARGIN, y, CONTENT_W, headerH, NAVY_CARD);
  doc.setTextColor(...MUTED);
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  let x = MARGIN;
  for (let i = 0; i < n; i++) {
    if (i === 0) doc.text(headers[i], x + 3, y + 9);
    else { const hw = doc.getTextWidth(headers[i]); doc.text(headers[i], x + cw[i] - hw - 3, y + 9); }
    x += cw[i];
  }
  y += headerH;

  // Rows
  for (let ri = 0; ri < rows.length; ri++) {
    const bg = ri % 2 === 1 ? NAVY_CARD : NAVY;
    drawRect(doc, MARGIN, y, CONTENT_W, rowH, bg);
    x = MARGIN;
    for (let i = 0; i < n; i++) {
      const val = rows[ri][i] || "—";
      if (i === 0) {
        doc.setTextColor(...WHITE);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(val, x + 3, y + 9);
      } else {
        doc.setTextColor(...SLATE);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        const sw = doc.getTextWidth(val);
        doc.text(val, x + cw[i] - sw - 3, y + 9);
      }
      x += cw[i];
    }
    y += rowH;
  }

  // Career row
  if (careerRow) {
    drawRect(doc, MARGIN, y, CONTENT_W, rowH, NAVY_CARD);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    x = MARGIN;
    for (let i = 0; i < n; i++) {
      const val = careerRow[i] || "";
      if (i === 0) {
        doc.setTextColor(...GOLD);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(val, x + 3, y + 9);
      } else {
        doc.setTextColor(...WHITE);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        const sw = doc.getTextWidth(val);
        doc.text(val, x + cw[i] - sw - 3, y + 9);
      }
      x += cw[i];
    }
    y += rowH;
  }

  return y + 6;
}

function drawScoutingGrades(doc: jsPDF, grades: { label: string; value: number | null | undefined }[], y: number): number {
  const valid = grades.filter((g) => g.value != null);
  if (valid.length === 0) return y;
  const colW = CONTENT_W / Math.min(valid.length, 4);
  const boxH = 36;

  for (let i = 0; i < valid.length; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = MARGIN + col * colW;
    const by = y + row * (boxH + 4);
    const { label, color } = gradeInfo(valid[i].value);

    drawRoundRect(doc, x, by, colW - 4, boxH, 3, NAVY_CARD, color);

    // Label
    doc.setTextColor(...MUTED);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    const lw = doc.getTextWidth(valid[i].label);
    doc.text(valid[i].label, x + (colW - 4 - lw) / 2, by + 9);

    // Value
    doc.setTextColor(...color);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    const vs = String(Math.round(Number(valid[i].value)));
    const vw = doc.getTextWidth(vs);
    doc.text(vs, x + (colW - 4 - vw) / 2, by + 22);

    // Grade text
    doc.setFontSize(6);
    const gw = doc.getTextWidth(label);
    doc.text(label, x + (colW - 4 - gw) / 2, by + 31);
  }

  const totalRows = Math.ceil(valid.length / 4);
  return y + totalRows * (boxH + 4) + 4;
}

function drawFooter(doc: jsPDF, reportTitle?: string | null) {
  const footerY = PAGE_H - 24;
  doc.setTextColor(...MUTED);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");

  let left = "Generated by RSTR IQ";
  if (reportTitle) left = `${reportTitle} — ${left}`;
  doc.text(left, MARGIN, footerY);

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const dw = doc.getTextWidth(dateStr);
  doc.text(dateStr, PAGE_W - MARGIN - dw, footerY);

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY - 6, PAGE_W - MARGIN, footerY - 6);
}

// ── Page generators ─────────────────────────────────────────────────

function generateHitterPage(doc: jsPDF, player: ReportPlayer, reportTitle?: string | null) {
  // Background
  drawRect(doc, 0, 0, PAGE_W, PAGE_H, NAVY_DARK);

  let y = MARGIN;
  y = drawHeader(doc, player, y);

  // Overview
  y = drawSectionTitle(doc, "OVERVIEW", y);
  y = drawStatBoxes(doc,
    ["oWAR", "MARKET VALUE", "POWER RATING"],
    [fmt(player.owar, 1), player.nil_value ? `$${Math.round(player.nil_value).toLocaleString()}` : "—", pct(player.power_rating_plus)],
    y, [null, GOLD, null]
  );

  // Projected stats
  y = drawSectionTitle(doc, "2026 PROJECTED STATS", y);
  y = drawStatBoxes(doc,
    ["AVG", "OBP", "SLG", "OPS", "ISO", "wRC+"],
    [fmt3(player.p_avg), fmt3(player.p_obp), fmt3(player.p_slg), fmt3(player.p_ops), fmt3(player.p_iso), pct(player.p_wrc_plus)],
    y
  );

  // Career stats
  const seasons = player.career_seasons || [];
  if (seasons.length > 0) {
    y = drawSectionTitle(doc, "CAREER STATS", y);
    const headers = ["YEAR", "TEAM", "PA", "AVG", "OBP", "SLG", "OPS", "ISO"];
    const cw = [40, 50, 35, 55, 55, 55, 55, CONTENT_W - 345];
    const rows = seasons.map((s: any) => {
      const obp = Number(s.OBP || 0);
      const slg = Number(s.SLG || 0);
      const avg = Number(s.AVG || 0);
      return [String(s.Season || "—"), s.Team || "—", String(s.pa || "—"), fmt3(s.AVG), fmt3(s.OBP), fmt3(s.SLG), fmt3(obp + slg || null), fmt3(slg - avg || null)];
    });
    y = drawTable(doc, headers, rows, y, cw);
  }

  // Scouting grades
  const grades = [
    { label: "Barrel%", value: player.barrel_score },
    { label: "Exit Velo", value: player.ev_score },
    { label: "Contact%", value: player.contact_score },
    { label: "Chase%", value: player.chase_score },
  ].filter((g) => g.value != null);
  if (grades.length > 0) {
    y = drawSectionTitle(doc, "SCOUTING GRADES", y);
    y = drawScoutingGrades(doc, grades, y);
  }

  // Notes
  if (player.scouting_notes) {
    y = drawSectionTitle(doc, "SCOUTING NOTES", y);
    doc.setTextColor(...SLATE);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(player.scouting_notes, CONTENT_W - 8);
    doc.text(lines, MARGIN + 4, y + 8);
  }

  drawFooter(doc, reportTitle);
}

function generatePitcherPage(doc: jsPDF, player: ReportPlayer, reportTitle?: string | null) {
  drawRect(doc, 0, 0, PAGE_W, PAGE_H, NAVY_DARK);

  let y = MARGIN;
  y = drawHeader(doc, player, y);

  // Overview
  y = drawSectionTitle(doc, "OVERVIEW", y);
  y = drawStatBoxes(doc,
    ["pWAR", "MARKET VALUE", "POWER RATING"],
    [fmt(player.p_war, 2), player.market_value ? `$${Math.round(player.market_value).toLocaleString()}` : "—", pct(player.overall_pr_plus)],
    y, [null, GOLD, null]
  );

  // Stuff+ overview
  if (player.stuff_plus != null || player.whiff_pct != null) {
    y = drawSectionTitle(doc, "STUFF+ OVERVIEW", y);
    const labels: string[] = [];
    const values: string[] = [];
    const colors: ([number, number, number] | null)[] = [];
    if (player.stuff_plus != null) {
      labels.push("STUFF+"); values.push(pct(player.stuff_plus)); colors.push(tierColor(player.stuff_plus));
    }
    if (player.whiff_pct != null) {
      labels.push("WHIFF%"); values.push(`${Number(player.whiff_pct).toFixed(1)}%`); colors.push(tierColor(player.whiff_pct, [27, 21, 16]));
    }
    y = drawStatBoxes(doc, labels, values, y, colors);
  }

  // Projected stats
  y = drawSectionTitle(doc, "2026 PROJECTED STATS", y);
  y = drawStatBoxes(doc,
    ["ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"],
    [fmt(player.p_era, 2), fmt(player.p_fip, 2), fmt(player.p_whip, 2), fmt(player.p_k9, 2), fmt(player.p_bb9, 2), fmt(player.p_hr9, 2)],
    y
  );

  // Career stats
  const seasons = player.career_seasons || [];
  if (seasons.length > 0) {
    y = drawSectionTitle(doc, "CAREER STATS", y);
    const headers = ["YEAR", "TEAM", "IP", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"];
    const cw = [38, 48, 35, 48, 48, 48, 42, 42, CONTENT_W - 349];
    const rows = seasons.map((s: any) => [
      String(s.Season || "—"), s.Team || "—", fmt(s.IP, 1), fmt(s.ERA, 2), fmt(s.FIP, 2), fmt(s.WHIP, 2), fmt(s.K9, 1), fmt(s.BB9, 1), fmt(s.HR9, 1),
    ]);
    y = drawTable(doc, headers, rows, y, cw);
  }

  // Pitch arsenal
  const pitches = player.pitches || [];
  if (pitches.length > 0) {
    y = drawSectionTitle(doc, "PITCH ARSENAL", y);
    const headers = ["PITCH", "USAGE", "WHIFF%", "STUFF+"];
    const cw = [CONTENT_W * 0.3, CONTENT_W * 0.23, CONTENT_W * 0.23, CONTENT_W * 0.24];
    const rows = pitches.map((p: any) => [
      p.pitch_name || "—",
      p.usage != null ? `${Number(p.usage).toFixed(1)}%` : "—",
      p.whiff != null ? `${Number(p.whiff).toFixed(1)}%` : "—",
      p.stuff_plus != null ? String(Math.round(p.stuff_plus)) : "—",
    ]);
    y = drawTable(doc, headers, rows, y, cw);
  }

  // Scouting grades
  const grades = [
    { label: "Stuff+", value: player.stuff_score },
    { label: "Whiff%", value: player.whiff_score },
    { label: "BB%", value: player.bb_score },
    { label: "Barrel%", value: player.barrel_score },
  ].filter((g) => g.value != null);
  if (grades.length > 0) {
    y = drawSectionTitle(doc, "SCOUTING GRADES", y);
    y = drawScoutingGrades(doc, grades, y);
  }

  if (player.scouting_notes) {
    y = drawSectionTitle(doc, "SCOUTING NOTES", y);
    doc.setTextColor(...SLATE);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(player.scouting_notes, CONTENT_W - 8);
    doc.text(lines, MARGIN + 4, y + 8);
  }

  drawFooter(doc, reportTitle);
}

// ── Public API ──────────────────────────────────────────────────────

export function generateReportPdf(
  players: ReportPlayer[],
  reportTitle?: string | null
): string {
  // jsPDF uses points (72 per inch), letter = 612x792
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  for (let i = 0; i < players.length; i++) {
    if (i > 0) doc.addPage();
    const p = players[i];
    if (p.player_type === "pitcher") {
      generatePitcherPage(doc, p, reportTitle);
    } else {
      generateHitterPage(doc, p, reportTitle);
    }
  }

  return doc.output("bloburl") as string;
}
