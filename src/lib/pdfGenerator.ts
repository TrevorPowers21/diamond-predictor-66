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
  const classYear = player.class_year ? String(player.class_year).toUpperCase() : null;
  const meta = [player.school, classYear, player.bats_throws].filter(Boolean).join("  ·  ");
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
    player.season || "2026",
    player.bats_throws || null,
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
  doc.text("2027 PROJECTED STATISTICS", MARGIN + 10, y + 11);
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

// ── Section 7: Estimated Market Value Block (36pt) ──────────────────
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
  doc.text("ESTIMATED MARKET VALUE", MARGIN + 14, y + 14);

  if (player.nil_tier) {
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text(player.nil_tier, MARGIN + 14, y + 24);
  }

  // Right side: dollar amount — large and prominent
  const nilStr = fmtMoney(player.market_value ?? player.nil_value);
  doc.setTextColor(...NAVY);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  rightText(doc, nilStr, MARGIN, CONTENT_W - 10, y + 24);

  // Thin gold accent line at the bottom of the box (Stitch design canon)
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(MARGIN + 14, y + H - 4, MARGIN + CONTENT_W - 14, y + H - 4);

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
function drawScoutingNotes(doc: jsPDF, player: ReportPlayer, y: number, footerTopOrHeight: number, fixedHeight = false): number {
  const H = fixedHeight
    ? footerTopOrHeight
    : Math.max(50, Math.min(90, footerTopOrHeight - y - GAP));

  // Background + border
  rect(doc, MARGIN, y, CONTENT_W, H, WHITE);
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

  // Notes text or placeholder — no ruled lines behind the text
  const notes = player.scouting_notes;
  const contentTop = y + titleH + 10;
  const contentW = CONTENT_W - 16;
  const lineSpacing = 10;
  doc.setFontSize(8.5);
  if (notes) {
    doc.setTextColor(...DARKGRAY);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(notes, contentW);
    const maxLines = Math.floor((H - titleH - 8) / lineSpacing);
    doc.text(lines.slice(0, maxLines), MARGIN + 8, contentTop);
  } else {
    doc.setTextColor(...MIDGRAY);
    doc.setFont("helvetica", "italic");
    doc.text("Notes / analysis to be completed by staff.", MARGIN + 8, contentTop);
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

// ─────────────────────────────────────────────────────────────────────
// ── STITCH-DESIGN PITCHER REPORT (v2 layout, locked 2026-04-29) ──────
// ─────────────────────────────────────────────────────────────────────

// Tier color for percentile-based metrics. Uses the same break points
// the rest of the system uses for scouting score chip badges.
function tierColorForPercentile(p: number | null | undefined): [number, number, number] {
  if (p == null || !Number.isFinite(p)) return MIDGRAY;
  if (p >= 80) return GOLD;          // Elite
  if (p >= 60) return GREEN;         // Above Avg
  if (p >= 40) return BLUE_ACC;      // Average
  if (p >= 20) return [202, 138, 4]; // Below Avg
  return RED_ACC;                    // Poor
}

function tierLabelForPercentile(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p >= 80) return "Elite";
  if (p >= 60) return "Above Avg";
  if (p >= 40) return "Average";
  if (p >= 20) return "Below Avg";
  return "Poor";
}

// Bio row for the pitcher report — 3 cells (Role / Conference / Bats-Throws).
// The 6-cell legacy bio row included height/weight/hometown/draft year that
// we don't currently have data for; condensing avoids dashes everywhere.
function drawBioRowPitcher(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 40;
  const cells = [
    { label: "ROLE", value: player.position || "—" },
    { label: "CONFERENCE", value: player.conference || "—" },
    { label: "BATS / THROWS", value: player.bats_throws || "—" },
  ];
  const cellW = CONTENT_W / cells.length;

  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    const isDark = i % 2 === 0;
    const bg = isDark ? NAVY : OFFWHITE;
    const labelColor: [number, number, number] = isDark ? [180, 178, 170] : DARKGRAY;
    const valueColor: [number, number, number] = isDark ? WHITE : NAVY;

    rect(doc, x, y, cellW, H, bg);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, H, "S");

    doc.setTextColor(...labelColor);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    doc.setTextColor(...valueColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }

  return y + H + GAP;
}

// 2027 Projected Stats — pitcher version, 6 stat tiles with gold trim
function drawProjectedStatsPitcher2027(doc: jsPDF, player: ReportPlayer, y: number): number {
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("2027 PROJECTED STATISTICS*", MARGIN + 10, y + 11);
  y += titleH + 2;

  const cells = [
    { label: "pERA", value: fmtStat(player.p_era, 2) },
    { label: "pFIP", value: fmtStat(player.p_fip, 2) },
    { label: "pWHIP", value: fmtStat(player.p_whip, 2) },
    { label: "pK/9", value: fmtStat(player.p_k9, 1) },
    { label: "pBB/9", value: fmtStat(player.p_bb9, 1) },
    { label: "pHR/9", value: fmtStat(player.p_hr9, 2) },
  ];
  const cellW = CONTENT_W / cells.length;
  const boxH = 36;
  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    rect(doc, x, y, cellW, boxH, OFFWHITE);
    // Per-cell border + a thin gold top accent that signals "elite stat" framing
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(x, y, cellW, boxH, "S");
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(x + 4, y + 2, x + cellW - 4, y + 2);

    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    doc.setTextColor(...NAVY);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }
  y += boxH;

  // Asterisk footnote — temporary until projections are auto-rerun against
  // the assigned destination team (see post-demo punch list).
  const teamLabel = (player.school || "their current team").toUpperCase();
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "italic");
  doc.text(`* Assuming player returns to ${teamLabel}`, MARGIN, y + 7);
  y += 9;

  return y + GAP;
}

// IQ Stuff+ — 3x3 pitch grid alongside an OVERALL composite tile
function drawIQStuffPlusGridComposite(doc: jsPDF, player: ReportPlayer, y: number): number {
  const pitches = (player.pitches || []).slice(0, 9);

  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("IQ STUFF+", MARGIN + 10, y + 11);
  y += titleH + 4;

  // Layout: 3-column grid on the left (~70%), composite tile on the right (~30%)
  const gridW = CONTENT_W * 0.66;
  const compW = CONTENT_W - gridW - 6;
  const compX = MARGIN + gridW + 6;
  const cols = 3;
  const rows = 3;
  const cellW = gridW / cols;
  const cellH = 34;
  const totalGridH = rows * cellH;

  // Pitch tiles
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = MARGIN + c * cellW;
    const cy = y + r * cellH;
    const pitch = pitches[i];

    rect(doc, x, cy, cellW, cellH, OFFWHITE);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.25);
    doc.rect(x, cy, cellW, cellH, "S");

    if (!pitch) {
      doc.setTextColor(...MIDGRAY);
      doc.setFontSize(6);
      doc.setFont("helvetica", "italic");
      centeredText(doc, "—", x, cellW, cy + cellH / 2 + 2);
      continue;
    }

    const stuffRaw = pitch.stuff_plus ?? pitch.stuff ?? null;
    const stuff = stuffRaw == null ? null : Number(stuffRaw);
    // For per-pitch display we treat the stuff+ value itself as the tier signal,
    // not a percentile — use the same break points the legacy code uses (120/105/90).
    const barColor: [number, number, number] = stuff == null ? MIDGRAY :
      stuff >= 120 ? GOLD :
      stuff >= 105 ? GREEN :
      stuff >= 90 ? BLUE_ACC :
      RED_ACC;

    // Pitch name top-left
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.text((pitch.pitch_name || pitch.name || "—").toUpperCase(), x + 5, cy + 9);

    // Stuff+ value, large, center
    doc.setTextColor(...NAVY);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    centeredText(doc, stuff == null ? "—" : String(Math.round(stuff)), x, cellW, cy + 24);

    // Tier color bar at the very bottom of the cell
    rect(doc, x, cy + cellH - 3, cellW, 3, barColor);
  }

  // Composite OVERALL Stuff+ tile — uses the player-level Stuff+ rollup,
  // not pRV+ (which is the run-prevention composite shown elsewhere).
  const overall = player.stuff_plus ?? null;
  rect(doc, compX, y, compW, totalGridH, NAVY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.rect(compX, y, compW, totalGridH, "S");

  doc.setTextColor(...GOLD);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  centeredText(doc, "OVERALL Stuff+", compX, compW, y + 18);

  doc.setTextColor(...WHITE);
  doc.setFontSize(34);
  doc.setFont("helvetica", "bold");
  // Center the value vertically in the available space between the title (top)
  // and the tier label (bottom). Adding ~11pt to the midline accounts for the
  // baseline offset of a 34pt glyph so the digits look optically centered.
  centeredText(doc, overall == null ? "—" : String(Math.round(Number(overall))), compX, compW, y + totalGridH / 2 + 11);

  // Tier label sits just under the value rather than pinned to the bottom.
  // Use stuff_score (true percentile rank) for tier classification, not the
  // raw Stuff+ value — those don't map 1:1 to percentile bands.
  doc.setTextColor(...GOLD);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  centeredText(doc, tierLabelForPercentile(player.stuff_score ?? null).toUpperCase(), compX, compW, y + totalGridH / 2 + 28);

  return y + totalGridH + GAP;
}

// Percentile Rankings — metrics stacked vertically (one row per metric) with
// horizontal track bars in Savant style. Reads right-to-left as: label · track · value · tier.
function drawPercentileRankings(
  doc: jsPDF,
  y: number,
  metrics: { label: string; sublabel?: string; percentile: number | null }[],
): number {
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("PERCENTILE RANKINGS", MARGIN + 10, y + 11);
  y += titleH + 6;

  const rowH = 18;
  const labelW = 80;
  const valueW = 28;
  const tierW = 64;
  const trackX = MARGIN + labelW + 4;
  const trackEnd = MARGIN + CONTENT_W - valueW - tierW - 4;
  const trackW = trackEnd - trackX;
  const trackH = 6;

  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const ry = y + i * rowH;
    const trackY = ry + (rowH - trackH) / 2;

    // Label (left)
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.text(m.label.toUpperCase(), MARGIN, ry + 11);
    if (m.sublabel) {
      doc.setTextColor(...MIDGRAY);
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      doc.text(m.sublabel, MARGIN + labelW - doc.getTextWidth(m.sublabel) - 6, ry + 11);
    }

    // Track + fill
    rect(doc, trackX, trackY, trackW, trackH, [225, 225, 225]);
    const pct = m.percentile;
    if (pct != null && Number.isFinite(pct)) {
      const clamped = Math.max(0, Math.min(100, pct));
      const fillW = (clamped / 100) * trackW;
      rect(doc, trackX, trackY, fillW, trackH, tierColorForPercentile(pct));
    }
    // Gridline ticks at 25/50/75 for visual scale
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    [25, 50, 75].forEach((g) => {
      const gx = trackX + (g / 100) * trackW;
      doc.line(gx, trackY - 2, gx, trackY + trackH + 2);
    });

    // Value (right of track)
    const valueX = trackEnd + 6;
    doc.setTextColor(...NAVY);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(pct == null ? "—" : String(Math.round(pct)), valueX, ry + 12);

    // Tier label (far right)
    const tierX = valueX + valueW;
    doc.setTextColor(...MIDGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text(tierLabelForPercentile(pct).toUpperCase(), tierX, ry + 12);
  }

  return y + metrics.length * rowH + GAP + 2;
}

// Compact risk band — single horizontal row sitting between Percentile Rankings
// and the Value+Notes split. Surfaces grade, trajectory, and one-line summary;
// skips the factor bars (those live on the player profile UI).
function drawRiskBand(doc: jsPDF, player: ReportPlayer, y: number): number {
  if (!player.risk_grade) return y; // skip silently if risk wasn't computed

  // Title bar — same idiom as other Stitch sections
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("RISK ASSESSMENT", MARGIN + 10, y + 11);
  y += titleH + 2;

  // Body
  const bodyH = 30;
  rect(doc, MARGIN, y, CONTENT_W, bodyH, WHITE);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, bodyH, "S");

  // Risk grade chip — colored pill, left side
  const grade = player.risk_grade || "—";
  const gradeColors: Record<string, [number, number, number]> = {
    Low: GREEN,
    Moderate: BLUE_ACC,
    Elevated: [202, 138, 4],
    High: RED_ACC,
  };
  const gc = gradeColors[grade] || MIDGRAY;
  const chipW = 70;
  const chipH = 18;
  const chipX = MARGIN + 8;
  const chipY = y + (bodyH - chipH) / 2;
  doc.setFillColor(...gc);
  doc.roundedRect(chipX, chipY, chipW, chipH, 3, 3, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  centeredText(doc, `${grade.toUpperCase()} RISK`, chipX, chipW, chipY + 12);

  // Competition factor — labeled by the quality of competition faced, not the
  // raw risk score. Risk score is inversely tied to competition quality (a
  // hitter in a weak conference scores high on competition risk because their
  // output may not translate up), so we flip the label/color mapping.
  const factors = player.risk_factors || [];
  const compFactor = factors.find((f) => /competition/i.test(f.label));
  const compScore = compFactor?.score ?? null;
  const compTier = compScore == null ? "—" :
    compScore <= 25 ? "Elite" :
    compScore <= 50 ? "Above Avg" :
    compScore <= 75 ? "Average" :
    "Below Avg";
  const compColor: [number, number, number] = compScore == null ? MIDGRAY :
    compScore <= 25 ? GOLD :
    compScore <= 50 ? GREEN :
    compScore <= 75 ? BLUE_ACC :
    RED_ACC;

  const compX = chipX + chipW + 14;
  doc.setTextColor(...compColor);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(compTier.toUpperCase(), compX, y + 14);
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.text("COMPETITION", compX, y + 22);

  // Risk summary — right side, italic
  const summary = player.risk_summary || "";
  if (summary) {
    const summaryX = compX + 80;
    const summaryW = MARGIN + CONTENT_W - summaryX - 10;
    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    const lines = doc.splitTextToSize(summary, summaryW);
    doc.text(lines.slice(0, 2), summaryX, y + 12);
  }

  return y + bodyH + GAP;
}

// Two stacked navy value tiles (Projected pRV+ on top, Market Value on bottom)
// on the left; Scouting Notes on the right. The total section height grows
// to fit the scouting notes — and the left tiles match — but never exceeds
// the room available before the footer.
function drawMarketValueNotesSplit(doc: jsPDF, player: ReportPlayer, y: number): number {
  const leftW = CONTENT_W * 0.36;
  const rightW = CONTENT_W - leftW - 6;
  const rightX = MARGIN + leftW + 6;
  const tileGap = 4;
  const titleH = 14;
  const lineSpacing = 10;
  const minTotalH = 110;
  const footerTop = PAGE_H - 26;
  const maxTotalH = footerTop - y - GAP - 4;

  // Measure scouting notes to size the section dynamically
  const notes = player.scouting_notes;
  const contentW = rightW - 16;
  doc.setFontSize(8.5);
  let needed = minTotalH;
  if (notes) {
    const lines = doc.splitTextToSize(notes, contentW);
    needed = titleH + 14 + lines.length * lineSpacing;
  }
  const totalH = Math.max(minTotalH, Math.min(needed, maxTotalH));
  const tileH = (totalH - tileGap) / 2;

  // Helper to draw a single navy value tile with gold left stripe + border
  const drawValueTile = (
    tileY: number,
    label: string,
    value: string,
    sublabel: string | null,
  ) => {
    rect(doc, MARGIN, tileY, leftW, tileH, NAVY);
    // Gold left stripe (same idiom as the existing market-value block)
    rect(doc, MARGIN, tileY, 5, tileH, GOLD);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.rect(MARGIN, tileY, leftW, tileH, "S");

    doc.setTextColor(...GOLD);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(label, MARGIN + 14, tileY + 12);

    doc.setTextColor(...WHITE);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    centeredText(doc, value, MARGIN, leftW, tileY + tileH * 0.72);

    if (sublabel) {
      doc.setTextColor(...GOLD);
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      centeredText(doc, sublabel.toUpperCase(), MARGIN, leftW, tileY + tileH - 5);
    }
  };

  // ─── Top tile: headline value (pRV+ for pitchers, oWAR for hitters) ──
  const isPitcher = player.player_type === "pitcher";
  if (isPitcher) {
    // pRV+ tier thresholds calibrated 2026-05-01 from actual NCAA pitcher
    // distribution (n=4097, median=98.1, p70=109, p85=118, p90=122).
    const prv = player.overall_pr_plus ?? player.power_rating_plus ?? null;
    const prvNum = prv == null ? null : Number(prv);
    const prvTier = prvNum == null ? "—" :
      prvNum >= 120 ? "Elite" :        // ~top 13%
      prvNum >= 110 ? "Above Avg" :    // ~top 30%
      prvNum >= 95 ? "Average" :       // ~top 52%
      "Below Avg";                      // bottom ~48%
    drawValueTile(
      y,
      "PROJECTED pRV+",
      prvNum == null ? "—" : String(Math.round(prvNum)),
      prvTier,
    );
  } else {
    // oWAR tier thresholds calibrated 2026-05-01 from actual NCAA hitter
    // distribution (n=4729, mean=0.71, sd=0.62, p90=1.52, p70=1.02).
    const owar = player.owar ?? null;
    const owarTier = owar == null ? "—" :
      Number(owar) >= 1.5 ? "Elite" :       // ~top 10%
      Number(owar) >= 1.0 ? "Above Avg" :    // ~top 30%
      Number(owar) >= 0.5 ? "Average" :      // ~top 55%
      "Below Avg";                            // bottom ~45%
    drawValueTile(
      y,
      "PROJECTED oWAR",
      owar == null ? "—" : Number(owar).toFixed(1),
      owarTier,
    );
  }

  // ─── Bottom tile: Estimated Market Value ───────────────────────────
  const bottomY = y + tileH + tileGap;
  drawValueTile(
    bottomY,
    "ESTIMATED MARKET VALUE",
    fmtMoney(player.market_value ?? player.nil_value),
    player.nil_tier,
  );

  // ─── Right card: Scouting Notes ─────────────────────────────────────
  rect(doc, rightX, y, rightW, totalH, WHITE);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(rightX, y, rightW, totalH, "S");

  rect(doc, rightX, y, rightW, titleH, NAVY);
  rect(doc, rightX, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("SCOUTING NOTES", rightX + 10, y + 10);

  const contentTop = y + titleH + 12;
  doc.setFontSize(8.5);
  if (notes) {
    doc.setTextColor(...DARKGRAY);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(notes, contentW);
    const maxLines = Math.floor((totalH - titleH - 14) / lineSpacing);
    doc.text(lines.slice(0, maxLines), rightX + 8, contentTop);
  } else {
    doc.setTextColor(...MIDGRAY);
    doc.setFont("helvetica", "italic");
    doc.text("Notes / analysis to be completed by staff.", rightX + 8, contentTop);
  }

  return y + totalH + GAP;
}

// ─────────────────────────────────────────────────────────────────────
// ── HITTER STITCH HELPERS ────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────

// Bio row for the hitter report — 3 cells (Position / Conference / Bats-Throws)
function drawBioRowHitter(doc: jsPDF, player: ReportPlayer, y: number): number {
  const H = 40;
  const cells = [
    { label: "POSITION", value: player.position || "—" },
    { label: "CONFERENCE", value: player.conference || "—" },
    { label: "BATS / THROWS", value: player.bats_throws || "—" },
  ];
  const cellW = CONTENT_W / cells.length;

  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    const isDark = i % 2 === 0;
    const bg = isDark ? NAVY : OFFWHITE;
    const labelColor: [number, number, number] = isDark ? [180, 178, 170] : DARKGRAY;
    const valueColor: [number, number, number] = isDark ? WHITE : NAVY;

    rect(doc, x, y, cellW, H, bg);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, H, "S");

    doc.setTextColor(...labelColor);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    doc.setTextColor(...valueColor);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }

  return y + H + GAP;
}

// 2027 Projected Stats — hitter version, 6 stat tiles with gold trim
function drawProjectedStatsHitter2027(doc: jsPDF, player: ReportPlayer, y: number): number {
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("2027 PROJECTED STATISTICS*", MARGIN + 10, y + 11);
  y += titleH + 2;

  const cells = [
    { label: "pAVG", value: fmtStat(player.p_avg, 3) },
    { label: "pOBP", value: fmtStat(player.p_obp, 3) },
    { label: "pSLG", value: fmtStat(player.p_slg, 3) },
    { label: "pOPS", value: fmtStat(player.p_ops, 3) },
    { label: "pISO", value: fmtStat(player.p_iso, 3) },
    { label: "pWRC+", value: player.p_wrc_plus == null ? "—" : String(Math.round(Number(player.p_wrc_plus))) },
  ];
  const cellW = CONTENT_W / cells.length;
  const boxH = 36;
  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    rect(doc, x, y, cellW, boxH, OFFWHITE);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(x, y, cellW, boxH, "S");
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(x + 4, y + 2, x + cellW - 4, y + 2);

    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    doc.setTextColor(...NAVY);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }
  y += boxH;

  // Asterisk footnote (mirrors pitcher path)
  const teamLabel = (player.school || "their current team").toUpperCase();
  doc.setTextColor(...MIDGRAY);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "italic");
  doc.text(`* Assuming player returns to ${teamLabel}`, MARGIN, y + 7);
  y += 9;

  return y + GAP;
}

// IQ Hitting Metrics — 3-column grid (Plate Discipline / Quality of Contact /
// Batted Ball) with raw values + tier-color stripes; OVERALL POWER RATING+
// composite tile alongside.
function drawIQHittingMetricsGrid(doc: jsPDF, player: ReportPlayer, y: number): number {
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("IQ HITTING METRICS", MARGIN + 10, y + 11);
  y += titleH + 4;

  // Layout: 3-column grid on the left (~66%), composite tile on the right
  const gridW = CONTENT_W * 0.66;
  const compW = CONTENT_W - gridW - 6;
  const compX = MARGIN + gridW + 6;

  // Format helpers — pcts come in as fractions (0.81) or already-percent (81); detect.
  const fmtPct = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const n = Number(v);
    const asPct = n > 1 ? n : n * 100;
    return `${asPct.toFixed(1)}%`;
  };
  const fmtEV = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : `${Number(v).toFixed(1)}`;

  // Column definitions
  type MetricCell = { label: string; value: string; percentile: number | null };
  const columns: { header: string; metrics: MetricCell[] }[] = [
    {
      header: "Plate Discipline",
      metrics: [
        { label: "Contact%", value: fmtPct(player.contact_pct), percentile: player.contact_score ?? null },
        { label: "BB%", value: fmtPct(player.bb_pct), percentile: player.bb_pct_score ?? null },
        { label: "Chase%", value: fmtPct(player.chase_pct), percentile: player.chase_score ?? null },
      ],
    },
    {
      header: "Quality of Contact",
      metrics: [
        { label: "Avg EV", value: fmtEV(player.avg_ev), percentile: player.ev_score ?? null },
        { label: "Barrel%", value: fmtPct(player.barrel_pct), percentile: player.barrel_score ?? null },
        { label: "EV90", value: fmtEV(player.ev90), percentile: player.ev90_score ?? null },
      ],
    },
    {
      header: "Batted Ball",
      metrics: [
        { label: "Line Drive%", value: fmtPct(player.ld_pct), percentile: player.ld_score ?? null },
        { label: "Pull%", value: fmtPct(player.pull_pct), percentile: player.pull_score ?? null },
        { label: "Ground%", value: fmtPct(player.gb_pct), percentile: player.gb_score ?? null },
      ],
    },
  ];

  const colCount = columns.length;
  const colW = gridW / colCount;
  const headerH = 14;
  const rows = 3;
  const cellH = 26;
  const totalH = headerH + rows * cellH;

  for (let c = 0; c < colCount; c++) {
    const col = columns[c];
    const cx = MARGIN + c * colW;

    // Column header (navy) — Stitch design "navy column headers + colored chip badges"
    rect(doc, cx, y, colW, headerH, NAVY);
    doc.setTextColor(...GOLD);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    centeredText(doc, col.header.toUpperCase(), cx, colW, y + 9);

    // Metric cells
    for (let r = 0; r < rows; r++) {
      const m = col.metrics[r];
      const cy = y + headerH + r * cellH;
      const isAlt = r % 2 === 0;
      rect(doc, cx, cy, colW, cellH, isAlt ? OFFWHITE : WHITE);
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.2);
      doc.rect(cx, cy, colW, cellH, "S");

      // Metric label (left)
      doc.setTextColor(...DARKGRAY);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(m.label, cx + 6, cy + cellH / 2 + 3);

      // Metric value (right)
      doc.setTextColor(...NAVY);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      const valStr = m.value;
      const valW = doc.getTextWidth(valStr);
      doc.text(valStr, cx + colW - valW - 6, cy + cellH / 2 + 3);

      // Tier-color chip stripe at bottom of cell
      rect(doc, cx, cy + cellH - 2, colW, 2, tierColorForPercentile(m.percentile));
    }
  }

  // Composite OVERALL POWER RATING+ tile
  const overall = player.power_rating_plus ?? player.overall_pr_plus ?? null;
  rect(doc, compX, y, compW, totalH, NAVY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.rect(compX, y, compW, totalH, "S");

  doc.setTextColor(...GOLD);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  centeredText(doc, "OVERALL TALENT+", compX, compW, y + 18);

  doc.setTextColor(...WHITE);
  doc.setFontSize(34);
  doc.setFont("helvetica", "bold");
  centeredText(doc, overall == null ? "—" : String(Math.round(Number(overall))), compX, compW, y + totalH / 2 + 11);

  doc.setTextColor(...GOLD);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  centeredText(doc, tierLabelForPercentile(overall == null ? null : (Number(overall) - 50)).toUpperCase(), compX, compW, y + totalH / 2 + 28);

  return y + totalH + GAP;
}

// Compose the new Hitter report page (Stitch v2 layout)
function generateHitterPageStitch(doc: jsPDF, player: ReportPlayer, reportTitle?: string | null) {
  rect(doc, 0, 0, PAGE_W, PAGE_H, WHITE);

  let y = 0;
  y = drawHeader(doc, player, y);
  y = drawSportStrip(doc, player, y);
  y = drawBioRowHitter(doc, player, y);
  y = drawProjectedStatsHitter2027(doc, player, y);
  y = drawIQHittingMetricsGrid(doc, player, y);

  // Percentile Rankings: Avg EV / Barrel% / Chase% / Contact%
  y = drawPercentileRankings(doc, y, [
    { label: "Avg EV", sublabel: "vs NCAA", percentile: player.ev_score ?? null },
    { label: "Barrel%", sublabel: "vs NCAA", percentile: player.barrel_score ?? null },
    { label: "Chase%", sublabel: "vs NCAA", percentile: player.chase_score ?? null },
    { label: "Contact%", sublabel: "vs NCAA", percentile: player.contact_score ?? null },
  ]);

  y = drawRiskBand(doc, player, y);

  drawMarketValueNotesSplit(doc, player, y);

  drawFooter(doc, reportTitle);
}

// Compose the new Pitcher report page (Stitch v2 layout)
function generatePitcherPageStitch(doc: jsPDF, player: ReportPlayer, reportTitle?: string | null) {
  rect(doc, 0, 0, PAGE_W, PAGE_H, WHITE);

  let y = 0;
  y = drawHeader(doc, player, y);
  y = drawSportStrip(doc, player, y);
  y = drawBioRowPitcher(doc, player, y);
  y = drawProjectedStatsPitcher2027(doc, player, y);
  y = drawIQStuffPlusGridComposite(doc, player, y);

  // Percentile Rankings: Whiff / BB / Barrel
  y = drawPercentileRankings(doc, y, [
    { label: "Whiff%", sublabel: "vs NCAA", percentile: player.whiff_score ?? null },
    { label: "BB%", sublabel: "vs NCAA", percentile: player.bb_score ?? null },
    { label: "Barrel%", sublabel: "vs NCAA", percentile: player.barrel_score ?? null },
  ]);

  y = drawRiskBand(doc, player, y);

  drawMarketValueNotesSplit(doc, player, y);

  drawFooter(doc, reportTitle);
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

  // 3. Scouting Report (moved to top — fixed height)
  y = drawScoutingNotes(doc, player, y, 120, true);
  y += GAP;

  // 4. Risk Assessment (directly under scouting report)
  y = drawRiskAssessment(doc, player, y);

  // 5. Bio Row — HIDDEN for now (no TruMedia data). Keep code for future rollout.
  // y = drawBioRow(doc, player, y);

  // 6. Projected Stats
  y = drawProjectedStats(doc, player, y);

  // 7. IQ Stuff+ Grades (pitchers only)
  y = drawStuffPlusGrades(doc, player, y);

  // 8. NIL Block (36pt)
  y = drawNilBlock(doc, player, y);

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
    if (players[i].player_type === "pitcher") {
      // Stitch v2 layout — pitcher path
      generatePitcherPageStitch(doc, players[i], reportTitle);
    } else {
      // Stitch v2 layout — hitter path
      generateHitterPageStitch(doc, players[i], reportTitle);
    }
  }

  return doc.output("bloburl") as string;
}

// ─────────────────────────────────────────────────────────────────────
// ── COACH NOTES PDF (Stitch v2 — locked 2026-05-01) ──────────────────
// ─────────────────────────────────────────────────────────────────────

// Snapshot strip: 6 navy-trim stat tiles matching the 2027 Projected Stats look.
function drawCoachNotesSnapshot(doc: jsPDF, player: ReportPlayer, y: number): number {
  const isPitcher = player.player_type === "pitcher";
  const titleH = 16;
  rect(doc, MARGIN, y, CONTENT_W, titleH, NAVY);
  rect(doc, MARGIN, y, 3, titleH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("AT A GLANCE", MARGIN + 10, y + 11);
  y += titleH + 2;

  const cells = isPitcher
    ? [
        { label: "pERA", value: fmtStat(player.p_era, 2) },
        { label: "pFIP", value: fmtStat(player.p_fip, 2) },
        { label: "pWHIP", value: fmtStat(player.p_whip, 2) },
        { label: "pK/9", value: fmtStat(player.p_k9, 1) },
        { label: "pRV+", value: player.overall_pr_plus == null ? "—" : String(Math.round(Number(player.overall_pr_plus))) },
        { label: "Stuff+", value: player.stuff_plus == null ? "—" : String(Math.round(Number(player.stuff_plus))) },
      ]
    : [
        { label: "pAVG", value: fmtStat(player.p_avg, 3) },
        { label: "pOBP", value: fmtStat(player.p_obp, 3) },
        { label: "pSLG", value: fmtStat(player.p_slg, 3) },
        { label: "pISO", value: fmtStat(player.p_iso, 3) },
        { label: "pWRC+", value: player.p_wrc_plus == null ? "—" : String(Math.round(Number(player.p_wrc_plus))) },
        { label: "Power+", value: player.power_rating_plus == null ? "—" : String(Math.round(Number(player.power_rating_plus))) },
      ];

  const cellW = CONTENT_W / cells.length;
  const boxH = 36;
  for (let i = 0; i < cells.length; i++) {
    const x = MARGIN + i * cellW;
    rect(doc, x, y, cellW, boxH, OFFWHITE);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(x, y, cellW, boxH, "S");
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(x + 4, y + 2, x + cellW - 4, y + 2);

    doc.setTextColor(...DARKGRAY);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].label, x, cellW, y + 14);

    doc.setTextColor(...NAVY);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    centeredText(doc, cells[i].value, x, cellW, y + 30);
  }
  return y + boxH + GAP;
}

// Tag chip (navy pill, gold text) — used for note category.
function drawTagChip(doc: jsPDF, label: string, x: number, y: number): number {
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "bold");
  const text = label.toUpperCase();
  const padX = 4;
  const w = doc.getTextWidth(text) + padX * 2;
  const h = 9;
  doc.setFillColor(...NAVY);
  doc.roundedRect(x, y - h + 2, w, h, 1.5, 1.5, "F");
  doc.setTextColor(...GOLD);
  doc.text(text, x + padX, y - 1);
  return x + w; // returns x position after the chip for chaining
}

/** Render a coach notes page. Notes are listed newest-first (caller pre-sorts).
 *  Returns the next note index to resume from on overflow. */
function drawCoachNotesPage(
  doc: jsPDF,
  player: ReportPlayer,
  notes: NonNullable<ReportPlayer["coach_notes"]>,
  startIdx: number,
): number {
  rect(doc, 0, 0, PAGE_W, PAGE_H, WHITE);
  let y = 0;
  y = drawHeader(doc, player, y);
  y = drawSportStrip(doc, player, y);

  // Use the player_type-aware bio row from the v2 layout
  y = player.player_type === "pitcher"
    ? drawBioRowPitcher(doc, player, y)
    : drawBioRowHitter(doc, player, y);

  // Only show the snapshot strip on the first page; subsequent pages skip it
  // so the notes themselves get the full content area.
  if (startIdx === 0) {
    y = drawCoachNotesSnapshot(doc, player, y);
  }

  // Notes section header
  const headerH = 16;
  rect(doc, MARGIN, y, CONTENT_W, headerH, NAVY);
  rect(doc, MARGIN, y, 3, headerH, GOLD);
  doc.setTextColor(...GOLD);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("COACH NOTES", MARGIN + 10, y + 11);

  doc.setTextColor(...OFFWHITE);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  rightText(
    doc,
    `${notes.length} ${notes.length === 1 ? "entry" : "entries"}`,
    MARGIN,
    CONTENT_W - 10,
    y + 11,
  );
  y += headerH + 6;

  // Notes list — each entry is a navy-bar / off-white-card pair
  const footerTop = PAGE_H - 26;
  const contentW = CONTENT_W - 20;

  let idx = startIdx;
  while (idx < notes.length) {
    const note = notes[idx];
    const dateStr = new Date(note.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const author = (note as any).author_email || null;

    doc.setFontSize(8.5);
    const bodyLines = doc.splitTextToSize(note.content, contentW);
    const headerStripH = 14;
    const bodyPadding = 8;
    const lineSpacing = 11;
    const entryH = headerStripH + bodyPadding + bodyLines.length * lineSpacing + bodyPadding;

    if (y + entryH > footerTop - 4) break; // overflow — caller starts a new page

    // Header strip — navy with gold accent
    rect(doc, MARGIN, y, CONTENT_W, headerStripH, NAVY);
    rect(doc, MARGIN, y, 3, headerStripH, GOLD);

    // Date (gold, left)
    doc.setTextColor(...GOLD);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(dateStr, MARGIN + 10, y + 10);

    // Tag chip (immediately after date)
    let chipX = MARGIN + 10 + doc.getTextWidth(dateStr) + 8;
    if (note.tag) {
      chipX = drawTagChip(doc, note.tag, chipX, y + 10) + 6;
    }

    // Author (right side, off-white)
    if (author) {
      doc.setTextColor(...OFFWHITE);
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      rightText(doc, author, MARGIN, CONTENT_W - 10, y + 10);
    }

    // Body card
    const bodyY = y + headerStripH;
    const bodyH = bodyPadding + bodyLines.length * lineSpacing + bodyPadding;
    rect(doc, MARGIN, bodyY, CONTENT_W, bodyH, OFFWHITE);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN, bodyY, CONTENT_W, bodyH, "S");

    doc.setTextColor(...DARK);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(bodyLines, MARGIN + 10, bodyY + bodyPadding + 8);

    y += entryH + 5;
    idx++;
  }

  drawFooter(doc, `${player.name} · Coach Notes`);
  return idx;
}

export function generateCoachNotesPdf(
  player: ReportPlayer,
  notes: NonNullable<ReportPlayer["coach_notes"]>,
): string {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  if (notes.length === 0) {
    rect(doc, 0, 0, PAGE_W, PAGE_H, WHITE);
    let y = 0;
    y = drawHeader(doc, player, y);
    y = drawSportStrip(doc, player, y);
    y = player.player_type === "pitcher"
      ? drawBioRowPitcher(doc, player, y)
      : drawBioRowHitter(doc, player, y);

    // Empty-state card centered in the remaining space
    const cardY = y + 12;
    const cardH = 90;
    rect(doc, MARGIN, cardY, CONTENT_W, cardH, OFFWHITE);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.rect(MARGIN, cardY, CONTENT_W, cardH, "S");

    doc.setTextColor(...NAVY);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    centeredText(doc, "NO COACH NOTES YET", MARGIN, CONTENT_W, cardY + 38);
    doc.setTextColor(...MIDGRAY);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    centeredText(
      doc,
      "Add notes from the player profile to populate this report.",
      MARGIN,
      CONTENT_W,
      cardY + 58,
    );

    drawFooter(doc, `${player.name} · Coach Notes`);
    return doc.output("bloburl") as string;
  }

  let idx = 0;
  while (idx < notes.length) {
    if (idx > 0) doc.addPage();
    const next = drawCoachNotesPage(doc, player, notes, idx);
    if (next === idx) break; // prevent infinite loop if a single note is too large
    idx = next;
  }
  return doc.output("bloburl") as string;
}
