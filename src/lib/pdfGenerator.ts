/**
 * RSTR IQ Scouting Report — Client-Side PDF Generator
 * Matches the Player Profile PDF Specification (April 2026).
 * One full-page scouting document per player — 8 stacked sections.
 */

import jsPDF from "jspdf";
import type { ReportPlayer } from "@/components/ScoutingReport";

// ── Brand Colors (RGB) ──────────────────────────────────────────────
const DARK: [number, number, number] = [8, 15, 31];       // #080F1F
const NAVY: [number, number, number] = [13, 27, 62];      // #0D1B3E
const GOLD: [number, number, number] = [212, 175, 55];    // #D4AF37
const OFFWHITE: [number, number, number] = [242, 240, 234]; // #F2F0EA
const MIDGRAY: [number, number, number] = [154, 152, 144]; // #9A9890
const DARKGRAY: [number, number, number] = [58, 56, 48];  // #3A3830
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [17, 17, 17];     // #111111
const RED_ACC: [number, number, number] = [192, 57, 43];  // #C0392B
const BLUE_ACC: [number, number, number] = [46, 111, 163]; // #2E6FA3
const GREEN: [number, number, number] = [26, 107, 53];    // #1A6B35

// ── Layout Constants ────────────────────────────────────────────────
const PAGE_W = 612;   // US Letter width in points
const PAGE_H = 792;   // US Letter height in points
const MARGIN = 36;     // 0.5 inch
const CONTENT_W = PAGE_W - 2 * MARGIN;
const GAP = 5;

// ── Helpers ─────────────────────────────────────────────────────────
const fmtStat = (v: any, d = 2): string => {
  if (v == null || v === "" || v === "—") return "—";
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toFixed(d);
};
const fmtMoney = (v: any): string => {
  if (v == null) return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : `$${Math.round(n).toLocaleString()}`;
};

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, color: [number, number, number]) {
  doc.setFillColor(...color);
  doc.rect(x, y, w, h, "F");
}

function centeredText(doc: jsPDF, text: string, x: number, w: number, y: number) {
  const tw = doc.getTextWidth(text);
  doc.text(text, x + (w - tw) / 2, y);
}

function rightText(doc: jsPDF, text: string, x: number, w: number, y: number) {
  const tw = doc.getTextWidth(text);
  doc.text(text, x + w - tw, y);
}

// ── Section 1: Dark Header (86pt) ───────────────────────────────────
function drawHeader(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 86;
  rect(doc, 0, y, PAGE_W, H, DARK);

  // RSTR IQ wordmark
  doc.setTextColor(...GOLD);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("RSTR IQ", MARGIN, y + 16);

  // Confidential tag — right side
  doc.setFontSize(6);
  doc.setTextColor(...MIDGRAY);
  rightText(doc, "CONFIDENTIAL", MARGIN, CONTENT_W, y + 16);

  // Player name
  doc.setTextColor(...WHITE);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(player.name || "Unknown Player", MARGIN, y + 44);

  // Position badge — top right
  if (player.position) {
    const badgeW = 40;
    const badgeH = 18;
    const bx = PAGE_W - MARGIN - badgeW;
    const by = y + 28;
    doc.setFillColor(...GOLD);
    doc.roundedRect(bx, by, badgeW, badgeH, 3, 3, "F");
    doc.setTextColor(...DARK);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    centeredText(doc, player.position, bx, badgeW, by + 12);
  }

  // Meta line: School · Class · B/T
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const meta = [player.school, player.class_year, player.bats_throws].filter(Boolean).join("  ·  ");
  doc.text(meta, MARGIN, y + 60);

  // Thin gold accent line at bottom
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y + H - 2, PAGE_W - MARGIN, y + H - 2);

  return y + H;
}

// ── Section 2: Sport Strip (20pt) ───────────────────────────────────
function drawSportStrip(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 20;
  rect(doc, MARGIN, y, CONTENT_W, H, OFFWHITE);
  // Gold left accent — thicker for visual weight
  rect(doc, MARGIN, y, 5, H, GOLD);

  doc.setTextColor(...NAVY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  const parts = [
    player.sport || "Baseball",
    player.school,
    player.conference,
    player.season || "2025",
  ].filter(Boolean);
  doc.text(parts.join("   ·   ").toUpperCase(), MARGIN + 12, y + 13);

  return y + H + GAP;
}

// ── Section 3: Bio Row (40pt) ───────────────────────────────────────
function drawBioRow(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 40;
  const cells = [
    { label: "HEIGHT", value: player.height || "—" },
    { label: "WEIGHT", value: player.weight ? String(player.weight) : "—" },
    { label: "CONFERENCE", value: player.conference || "—" },
    { label: "HOMETOWN", value: player.hometown || "—" },
    { label: "DRAFT ELIG.", value: player.draft_year ? String(player.draft_year) : "—" },
    { label: "BATS / THROWS", value: player.bats_throws || "—" },
  ];
  const cellW = CONTENT_W / cells.length;

  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    const isDark = i % 2 === 0;
    const bg = isDark ? NAVY : OFFWHITE;
    const labelColor: [number, number, number] = isDark ? [180, 178, 170] : DARKGRAY; // lighter on dark, darker on light for contrast
    const valueColor: [number, number, number] = isDark ? WHITE : NAVY;

    rect(doc, x, y, cellW, H, bg);

    // Thin border for print separation
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, H, "S");

    // Label
    doc.setTextColor(...labelColor);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    // Value
    doc.setTextColor(...valueColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }

  return y + H + GAP;
}

// ── Section 4: Projected Stats ──────────────────────────────────────
function drawProjectedStats(doc: jsPDF, player: ReportPlayer, y: number): number {
  const isP = player.player_type === "pitcher";

  // Section title bar — gold left accent for visual hierarchy
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("2026 PROJECTED STATISTICS", MARGIN + 10, y + 11);
  y += titleH + 2;

  const boxH = 36;
  const drawStatRow = (stats: { label: string; value: string; bg?: [number, number, number]; valueColor?: [number, number, number] }[], rowY: number): number => {
    const n = stats.length;
    const cellW = CONTENT_W / n;
    for (let i = 0; i < n; i++) {
      const x = MARGIN + i * cellW;
      const bg = stats[i].bg || (i % 2 === 0 ? OFFWHITE : WHITE);
      rect(doc, x, rowY, cellW, boxH, bg);

      // Print border for clean cell separation
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(x, rowY, cellW, boxH, "S");

      // Label — use DARKGRAY for better print contrast on light backgrounds
      const isCustomBg = !!stats[i].bg;
      doc.setTextColor(...(isCustomBg ? [220, 220, 220] as [number, number, number] : DARKGRAY));
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      centeredText(doc, stats[i].label, x, cellW, rowY + 12);

      // Value
      const vc = stats[i].valueColor || NAVY;
      doc.setTextColor(...vc);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      centeredText(doc, stats[i].value, x, cellW, rowY + 28);
    }
    return rowY + boxH;
  };

  if (isP) {
    // Pitchers: 1 row × 5 boxes
    y = drawStatRow([
      { label: "pERA", value: fmtStat(player.p_era, 2) },
      { label: "pFIP", value: fmtStat(player.p_fip, 2) },
      { label: "pWHIP", value: fmtStat(player.p_whip, 2) },
      { label: "pK/9", value: fmtStat(player.p_k9, 1) },
      { label: "pBB/9", value: fmtStat(player.p_bb9, 1) },
    ], y);
  } else {
    // Hitters: 1 row — rate stats + oWAR
    y = drawStatRow([
      { label: "pAVG", value: fmtStat(player.p_avg, 3) },
      { label: "pOBP", value: fmtStat(player.p_obp, 3) },
      { label: "pSLG", value: fmtStat(player.p_slg, 3) },
      { label: "pOPS", value: fmtStat(player.p_ops, 3) },
      { label: "pISO", value: fmtStat(player.p_iso, 3) },
      { label: "oWAR", value: fmtStat(player.owar, 1), bg: GREEN, valueColor: WHITE },
    ], y);
  }

  return y + GAP;
}

// ── Section 5: IQ Stuff+ Grades (Pitchers Only) ────────────────────
function drawStuffPlusGrades(doc: jsPDF, player: ReportPlayer, y: number): number {
  if (player.player_type !== "pitcher") return y;
  const pitches = player.pitches || [];
  if (pitches.length === 0) return y;

  // Section title — gold left accent
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("IQ STUFF+ GRADES", MARGIN + 10, y + 11);
  y += titleH + 3;

  const barMaxW = CONTENT_W * 0.45;
  const rowH = 16;
  const labelW = CONTENT_W * 0.25;
  const valueW = 35;
  const cols = 2;
  const pitchesPerCol = Math.ceil(pitches.length / cols);
  const colW = CONTENT_W / cols;

  for (let i = 0; i < pitches.length; i++) {
    const col = Math.floor(i / pitchesPerCol);
    const row = i % pitchesPerCol;
    const px = MARGIN + col * colW;
    const py = y + row * (rowH + 2);
    const stuff = Number(pitches[i].stuff_plus ?? pitches[i].stuff ?? 0);

    // Bar color and grade label by tier
    let barColor: [number, number, number];
    let gradeLabel: string;
    if (stuff >= 120) { barColor = GOLD; gradeLabel = "Elite"; }
    else if (stuff >= 105) { barColor = RED_ACC; gradeLabel = "Above Avg"; }
    else if (stuff >= 90) { barColor = BLACK; gradeLabel = "Average"; }
    else { barColor = BLUE_ACC; gradeLabel = "Below Avg"; }

    // Pitch name
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.text(pitches[i].pitch_name || pitches[i].name || "—", px + 2, py + 11);

    // Bar
    const barW = Math.max(((stuff - 60) / 80) * (colW * 0.4), 4);
    const barX = px + labelW;
    rect(doc, barX, py + 3, barW, rowH - 6, barColor);

    // Stuff+ value + grade label at end of bar
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`${Math.round(stuff)}`, barX + barW + 4, py + 10);
    doc.setFontSize(5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MIDGRAY);
    doc.text(gradeLabel, barX + barW + 4 + doc.getTextWidth(`${Math.round(stuff)}  `), py + 10);
  }

  const totalRows = Math.ceil(pitches.length / cols);
  y += totalRows * (rowH + 2) + 4;

  // Legend
  doc.setFontSize(5);
  doc.setFont("helvetica", "normal");
  const legendY = y;
  const legends = [
    { color: GOLD, label: "Elite (120+)" },
    { color: RED_ACC, label: "Above Avg (105-119)" },
    { color: BLACK, label: "Average (90-104)" },
    { color: BLUE_ACC, label: "Below Avg (<90)" },
  ];
  let lx = MARGIN;
  for (const leg of legends) {
    rect(doc, lx, legendY - 4, 8, 6, leg.color);
    doc.setTextColor(...MIDGRAY);
    doc.text(leg.label, lx + 10, legendY);
    lx += doc.getTextWidth(leg.label) + 18;
  }

  return y + 10;
}

// ── Section 6: Scouting Grades (55pt) ───────────────────────────────
function drawScoutingGrades(doc: jsPDF, player: ReportPlayer, y: number): number {
  const isP = player.player_type === "pitcher";
  const H = 55;

  // Section title — gold left accent
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("SCOUTING GRADES  (20\u201380 SCALE)", MARGIN + 10, y + 11);
  y += titleH + 2;

  const grades = isP
    ? [
        { label: "FB Velo", value: player.grade_fb },
        { label: "Control", value: player.grade_ctrl },
        { label: "Command", value: player.grade_cmd },
        { label: "Delivery", value: player.grade_del },
        { label: "Proj.", value: player.grade_proj },
        { label: "OFP", value: player.grade_ofp },
      ]
    : [
        { label: "Hit", value: player.grade_hit },
        { label: "Power", value: player.grade_power },
        { label: "Speed", value: player.grade_speed },
        { label: "Field", value: player.grade_field },
        { label: "Arm", value: player.grade_arm },
        { label: "OFP", value: player.grade_ofp },
      ];

  const n = grades.length;
  const cellW = CONTENT_W / n;
  const boxH = H - titleH - 2;

  for (let i = 0; i < n; i++) {
    const x = MARGIN + i * cellW;
    const isOFP = grades[i].label === "OFP";
    const bg = isOFP ? NAVY : (i % 2 === 0 ? OFFWHITE : WHITE);
    rect(doc, x, y, cellW, boxH, bg);

    // Border — slightly heavier for print definition
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.4);
    doc.rect(x, y, cellW, boxH, "S");

    // Label — DARKGRAY on light for contrast, lighter on OFP navy
    doc.setTextColor(...(isOFP ? [180, 178, 170] as [number, number, number] : DARKGRAY));
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    centeredText(doc, grades[i].label.toUpperCase(), x, cellW, y + 12);

    // Value
    const val = grades[i].value;
    const vs = val != null ? String(Math.round(Number(val))) : "—";
    if (isOFP) {
      doc.setTextColor(...GOLD);
    } else {
      doc.setTextColor(...NAVY);
    }
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    centeredText(doc, vs, x, cellW, y + 31);
  }

  return y + boxH + GAP;
}

// ── Section 7: NIL Value Block (36pt) ───────────────────────────────
function drawNilBlock(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 36;
  rect(doc, MARGIN, y, CONTENT_W, H, OFFWHITE);
  // Gold left accent — thick for visual anchor
  rect(doc, MARGIN, y, 5, H, GOLD);
  // Border for print
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, H, "S");

  // Left side: label + tier
  doc.setTextColor(...NAVY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("ESTIMATED NIL VALUE", MARGIN + 14, y + 14);

  if (player.nil_tier) {
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text(player.nil_tier, MARGIN + 14, y + 24);
  }

  // Right side: dollar amount — large and prominent
  const nilStr = fmtMoney(player.nil_value);
  doc.setTextColor(...NAVY);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  rightText(doc, nilStr, MARGIN, CONTENT_W - 10, y + 24);

  return y + H + GAP;
}

// ── Section: Risk Assessment ────────────────────────────────────────
function drawRiskAssessment(doc: jsPDF, player: ReportPlayer, y: number): number {
  if (!player.risk_grade) return y;

  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("RISK ASSESSMENT", MARGIN + 10, y + 11);
  y += titleH + 2;

  const rowH = 42;
  rect(doc, MARGIN, y, CONTENT_W, rowH, OFFWHITE);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, CONTENT_W, rowH, "S");

  // Risk grade badge
  const grade = player.risk_grade || "—";
  const gradeColors: Record<string, [number, number, number]> = {
    Low: GREEN,
    Moderate: BLUE_ACC,
    Elevated: [202, 138, 4], // GOLD-ish warning
    High: RED_ACC,
  };
  const gc = gradeColors[grade] || MIDGRAY;

  // Grade circle/badge area
  const badgeW = 65;
  const badgeH = 22;
  const bx = MARGIN + 8;
  const by = y + 5;
  doc.setFillColor(...gc);
  doc.roundedRect(bx, by, badgeW, badgeH, 4, 4, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  centeredText(doc, `${grade} Risk`, bx, badgeW, by + 14);

  // Trajectory
  const traj = player.risk_trajectory || "Unknown";
  const trajColor: Record<string, [number, number, number]> = {
    Progressing: GREEN,
    Plateau: [202, 138, 4],
    Regressing: RED_ACC,
    Unknown: MIDGRAY,
  };
  doc.setTextColor(...(trajColor[traj] || MIDGRAY));
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(traj.toUpperCase(), bx + badgeW + 10, by + 9);
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.text("TRAJECTORY", bx + badgeW + 10, by + 17);

  // Factor bars — right side
  const factors = player.risk_factors || [];
  if (factors.length > 0) {
    const barStartX = MARGIN + 190;
    const barMaxW = CONTENT_W - 200;
    const barH = 5;
    const factorSpacing = 9;
    for (let i = 0; i < Math.min(factors.length, 4); i++) {
      const fy = y + 6 + i * factorSpacing;
      const f = factors[i];
      // Label
      doc.setTextColor(...DARKGRAY);
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "bold");
      doc.text(f.label.toUpperCase(), barStartX - 2, fy + 4);
      // Bar background
      rect(doc, barStartX + 45, fy, barMaxW - 70, barH, [220, 220, 220]);
      // Bar fill (skip when no data available)
      if (f.score != null) {
        const barFillColor: [number, number, number] = f.score <= 25 ? GREEN : f.score <= 50 ? BLUE_ACC : f.score <= 75 ? [202, 138, 4] : RED_ACC;
        rect(doc, barStartX + 45, fy, (barMaxW - 70) * (f.score / 100), barH, barFillColor);
      }
      // Score
      doc.setTextColor(...DARKGRAY);
      doc.setFontSize(5.5);
      doc.text(f.score != null ? String(f.score) : "—", barStartX + barMaxW - 18, fy + 4);
    }
  }

  // Summary below
  y += rowH;
  if (player.risk_summary) {
    const summaryH = 18;
    rect(doc, MARGIN, y, CONTENT_W, summaryH, WHITE);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN, y, CONTENT_W, summaryH, "S");
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(player.risk_summary, CONTENT_W - 16);
    doc.text(lines.slice(0, 2), MARGIN + 8, y + 8);
    y += summaryH;
  }

  return y + GAP;
}

// ── Section 8: Scouting Notes (auto-fill remaining) ─────────────────
function drawScoutingNotes(doc: jsPDF, player: ReportPlayer, y: number, footerTop: number): number {
  const minH = 50;
  const maxH = 90;
  const available = footerTop - y - GAP;
  const H = Math.max(minH, Math.min(maxH, available));

  // Background
  rect(doc, MARGIN, y, CONTENT_W, H, WHITE);

  // Border
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, H, "S");

  // Title bar — gold left accent
  const titleH = 14;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("SCOUTING NOTES", MARGIN + 10, y + 10);

  // Horizontal lines for writing
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  const lineStart = y + titleH + 12;
  const lineSpacing = 12;
  for (let ly = lineStart; ly < y + H - 4; ly += lineSpacing) {
    doc.line(MARGIN + 6, ly, PAGE_W - MARGIN - 6, ly);
  }

  // Notes text or placeholder
  const notes = player.scouting_notes;
  doc.setFontSize(8.5);
  if (notes) {
    doc.setTextColor(...DARKGRAY);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(notes, CONTENT_W - 16);
    const maxLines = Math.floor((H - titleH - 8) / lineSpacing);
    doc.text(lines.slice(0, maxLines), MARGIN + 8, y + titleH + 10);
  } else {
    doc.setTextColor(...MIDGRAY);
    doc.setFont("helvetica", "italic");
    doc.text("Notes / analysis to be completed by staff.", MARGIN + 8, y + titleH + 10);
  }

  return y + H;
}

// ── Footer (18pt) ───────────────────────────────────────────────────
function drawFooter(doc: jsPDF, reportTitle?: string | null) {
  const footerY = PAGE_H - 26;

  // Gold rule
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY);

  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MIDGRAY);

  // Left: branding
  let left = "RSTR IQ  ·  Everyday GM  ·  rstriq.com";
  if (reportTitle) left = `${reportTitle}  ·  ${left}`;
  doc.text(left, MARGIN, footerY + 10);

  // Right: date + disclaimer
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const disclaimer = `Projected statistics. Not guaranteed. Confidential.  ·  ${dateStr}`;
  rightText(doc, disclaimer, MARGIN, CONTENT_W, footerY + 10);
}

// ── Page Generators ─────────────────────────────────────────────────

function generatePlayerPage(doc: jsPDF, player: ReportPlayer, reportTitle?: string | null) {
  // White page background (will be covered by sections)
  rect(doc, 0, 0, PAGE_W, PAGE_H, WHITE);

  let y = 0;

  // 1. Header (86pt)
  y = drawHeader(doc, player, y);

  // 2. Sport Strip (20pt)
  y = drawSportStrip(doc, player, y);

  // 3. Bio Row (40pt)
  y = drawBioRow(doc, player, y);

  // 4. Projected Stats
  y = drawProjectedStats(doc, player, y);

  // 5. IQ Stuff+ Grades (pitchers only)
  y = drawStuffPlusGrades(doc, player, y);

  // 6. Scouting Grades (55pt)
  y = drawScoutingGrades(doc, player, y);

  // 7. NIL Block (36pt)
  y = drawNilBlock(doc, player, y);

  // 7b. Risk Assessment
  y = drawRiskAssessment(doc, player, y);

  // Footer area
  const footerTop = PAGE_H - 26;

  // 8. Scouting Notes (fills remaining space)
  drawScoutingNotes(doc, player, y, footerTop);

  // Footer
  drawFooter(doc, reportTitle);
}

// ── Public API ──────────────────────────────────────────────────────

export function generateReportPdf(
  players: ReportPlayer[],
  reportTitle?: string | null
): string {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  for (let i = 0; i < players.length; i++) {
    if (i > 0) doc.addPage();
    generatePlayerPage(doc, players[i], reportTitle);
  }

  return doc.output("bloburl") as string;
}
