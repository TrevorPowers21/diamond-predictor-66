"""
RSTR IQ Scouting Report — PDF Generator
Draws one full-page player profile per call using ReportLab.
Supports both hitter and pitcher layouts.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
import io
from typing import Any

# ── Brand constants ──────────────────────────────────────────────────
NAVY = HexColor("#0a1428")
NAVY_DARK = HexColor("#040810")
NAVY_CARD = HexColor("#0d1a30")
NAVY_BORDER = HexColor("#162241")
GOLD = HexColor("#D4AF37")
GOLD_DARK = HexColor("#A08820")
MUTED = HexColor("#8a94a6")
SLATE = HexColor("#cbd5e1")
WHITE = white
PAGE_W, PAGE_H = letter  # 612 x 792
MARGIN = 36  # 0.5 inch
CONTENT_W = PAGE_W - 2 * MARGIN

# ── Tier colors ──────────────────────────────────────────────────────
TIER_GREEN = HexColor("#2d8a4e")
TIER_BLUE = HexColor("#2563eb")
TIER_YELLOW = HexColor("#ca8a04")
TIER_RED = HexColor("#dc2626")

def tier_color(value, thresholds=(103, 98, 93)):
    """Return tier color for a value with customizable thresholds."""
    if value is None:
        return MUTED
    t_green, t_blue, t_yellow = thresholds
    if value >= t_green:
        return TIER_GREEN
    if value >= t_blue:
        return TIER_BLUE
    if value >= t_yellow:
        return TIER_YELLOW
    return TIER_RED


def _fmt(val, decimals=2):
    if val is None:
        return "—"
    try:
        return f"{float(val):.{decimals}f}"
    except (ValueError, TypeError):
        return "—"


def _fmt3(val):
    """Format batting average style (.xxx)"""
    if val is None:
        return "—"
    try:
        v = float(val)
        return f"{v:.3f}"
    except (ValueError, TypeError):
        return "—"


def _pct(val):
    if val is None:
        return "—"
    try:
        return str(round(float(val)))
    except (ValueError, TypeError):
        return "—"


def _draw_header(c: Canvas, player: dict, y: float) -> float:
    """Draw player name, school, position header bar. Returns new y."""
    # Gold header bar
    bar_h = 50
    c.setFillColor(NAVY)
    c.rect(MARGIN, y - bar_h, CONTENT_W, bar_h, fill=1, stroke=0)

    # Gold left accent
    c.setFillColor(GOLD)
    c.rect(MARGIN, y - bar_h, 4, bar_h, fill=1, stroke=0)

    # Player name
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 20)
    name = player.get("name", "Unknown Player")
    c.drawString(MARGIN + 14, y - 22, name)

    # Info line: Position · School · Class · Bats/Throws
    c.setFont("Helvetica", 10)
    c.setFillColor(GOLD)
    parts = []
    if player.get("position"):
        parts.append(player["position"])
    if player.get("school"):
        parts.append(player["school"])
    if player.get("class_year"):
        parts.append(player["class_year"])
    if player.get("bats_throws"):
        parts.append(player["bats_throws"])
    info_line = " · ".join(parts)
    c.drawString(MARGIN + 14, y - 40, info_line)

    return y - bar_h - 12


def _draw_section_title(c: Canvas, title: str, y: float) -> float:
    """Draw a gold section title. Returns new y."""
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, y)
    # Gold underline
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.5)
    tw = c.stringWidth(title, "Helvetica-Bold", 11)
    c.line(MARGIN, y - 3, MARGIN + tw, y - 3)
    c.drawString(MARGIN, y, title)
    return y - 18


def _draw_stat_row(c: Canvas, labels: list, values: list, y: float,
                   col_w: float = None, colors: list = None) -> float:
    """Draw a row of stat boxes. Returns new y."""
    n = len(labels)
    if col_w is None:
        col_w = CONTENT_W / n
    box_h = 38

    for i in range(n):
        x = MARGIN + i * col_w
        # Box background
        c.setFillColor(NAVY_CARD)
        c.setStrokeColor(NAVY_BORDER)
        c.setLineWidth(0.5)
        c.roundRect(x, y - box_h, col_w - 4, box_h, 4, fill=1, stroke=1)

        # Label
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7)
        lbl = labels[i]
        lw = c.stringWidth(lbl, "Helvetica", 7)
        c.drawString(x + (col_w - 4 - lw) / 2, y - 12, lbl)

        # Value
        val_color = WHITE
        if colors and i < len(colors) and colors[i]:
            val_color = colors[i]
        c.setFillColor(val_color)
        c.setFont("Helvetica-Bold", 14)
        val = str(values[i]) if values[i] is not None else "—"
        vw = c.stringWidth(val, "Helvetica-Bold", 14)
        c.drawString(x + (col_w - 4 - vw) / 2, y - 30, val)

    return y - box_h - 8


def _draw_table(c: Canvas, headers: list, rows: list, y: float,
                col_widths: list = None, career_row: list = None) -> float:
    """Draw a data table. Returns new y."""
    n = len(headers)
    if col_widths is None:
        col_widths = [CONTENT_W / n] * n

    row_h = 16
    header_h = 18

    # Header row
    c.setFillColor(NAVY_CARD)
    c.rect(MARGIN, y - header_h, CONTENT_W, header_h, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Bold", 7)
    x = MARGIN
    for i, h in enumerate(headers):
        if i == 0:
            c.drawString(x + 4, y - 12, h)
        else:
            hw = c.stringWidth(h, "Helvetica-Bold", 7)
            c.drawString(x + col_widths[i] - hw - 4, y - 12, h)
        x += col_widths[i]
    y -= header_h

    # Data rows
    for ri, row in enumerate(rows):
        bg = NAVY_CARD if ri % 2 == 1 else NAVY
        c.setFillColor(bg)
        c.rect(MARGIN, y - row_h, CONTENT_W, row_h, fill=1, stroke=0)

        x = MARGIN
        for i, val in enumerate(row):
            if i == 0:
                c.setFillColor(WHITE)
                c.setFont("Helvetica-Bold", 8)
                c.drawString(x + 4, y - 11, str(val))
            else:
                c.setFillColor(SLATE)
                c.setFont("Helvetica", 8)
                s = str(val)
                sw = c.stringWidth(s, "Helvetica", 8)
                c.drawString(x + col_widths[i] - sw - 4, y - 11, s)
            x += col_widths[i]
        y -= row_h

    # Career totals row
    if career_row:
        c.setFillColor(NAVY_CARD)
        c.rect(MARGIN, y - row_h, CONTENT_W, row_h, fill=1, stroke=0)
        # Gold top border
        c.setStrokeColor(GOLD)
        c.setLineWidth(0.5)
        c.line(MARGIN, y, MARGIN + CONTENT_W, y)

        x = MARGIN
        for i, val in enumerate(career_row):
            if i == 0:
                c.setFillColor(GOLD)
                c.setFont("Helvetica-Bold", 8)
                c.drawString(x + 4, y - 11, str(val))
            else:
                c.setFillColor(WHITE)
                c.setFont("Helvetica-Bold", 8)
                s = str(val)
                sw = c.stringWidth(s, "Helvetica-Bold", 8)
                c.drawString(x + col_widths[i] - sw - 4, y - 11, s)
            x += col_widths[i]
        y -= row_h

    return y - 8


def _draw_scouting_grades(c: Canvas, grades: list, y: float) -> float:
    """Draw scouting grade boxes. grades = [(label, value), ...]. Returns new y."""
    n = len(grades)
    if n == 0:
        return y
    col_w = CONTENT_W / min(n, 4)
    box_h = 48

    for i, (label, value) in enumerate(grades):
        row_idx = i // 4
        col_idx = i % 4
        x = MARGIN + col_idx * col_w
        by = y - row_idx * (box_h + 6)

        # Determine grade and color
        if value is None:
            grade_label = "—"
            border_c = NAVY_BORDER
            text_c = MUTED
        elif value >= 90:
            grade_label = "Elite"
            border_c = TIER_GREEN
            text_c = TIER_GREEN
        elif value >= 75:
            grade_label = "Plus-Plus"
            border_c = TIER_GREEN
            text_c = TIER_GREEN
        elif value >= 60:
            grade_label = "Plus"
            border_c = TIER_BLUE
            text_c = TIER_BLUE
        elif value >= 45:
            grade_label = "Average"
            border_c = TIER_YELLOW
            text_c = TIER_YELLOW
        elif value >= 35:
            grade_label = "Below Avg"
            border_c = TIER_YELLOW
            text_c = TIER_YELLOW
        else:
            grade_label = "Poor"
            border_c = TIER_RED
            text_c = TIER_RED

        # Box
        c.setStrokeColor(border_c)
        c.setFillColor(NAVY_CARD)
        c.setLineWidth(1)
        c.roundRect(x, by - box_h, col_w - 6, box_h, 4, fill=1, stroke=1)

        # Label
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7)
        lw = c.stringWidth(label, "Helvetica", 7)
        c.drawString(x + (col_w - 6 - lw) / 2, by - 12, label)

        # Value
        c.setFillColor(text_c)
        c.setFont("Helvetica-Bold", 16)
        vs = str(round(value)) if value is not None else "—"
        vw = c.stringWidth(vs, "Helvetica-Bold", 16)
        c.drawString(x + (col_w - 6 - vw) / 2, by - 30, vs)

        # Grade text
        c.setFont("Helvetica", 7)
        gw = c.stringWidth(grade_label, "Helvetica", 7)
        c.drawString(x + (col_w - 6 - gw) / 2, by - 42, grade_label)

    total_rows = (n - 1) // 4 + 1
    return y - total_rows * (box_h + 6) - 4


def _draw_footer(c: Canvas, report_title: str = None, generated_by: str = "RSTR IQ"):
    """Draw footer with date and branding."""
    from datetime import datetime
    footer_y = 24
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7)

    left_text = f"Generated by {generated_by}"
    if report_title:
        left_text = f"{report_title} — {left_text}"
    c.drawString(MARGIN, footer_y, left_text)

    date_str = datetime.now().strftime("%B %d, %Y")
    dw = c.stringWidth(date_str, "Helvetica", 7)
    c.drawString(PAGE_W - MARGIN - dw, footer_y, date_str)

    # Thin gold line above footer
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.5)
    c.line(MARGIN, footer_y + 12, PAGE_W - MARGIN, footer_y + 12)


def generate_hitter_page(c: Canvas, player: dict, report_title: str = None):
    """Draw a full hitter profile page."""
    # Page background
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    y = PAGE_H - MARGIN

    # Header
    y = _draw_header(c, player, y)

    # Hero stats row: oWAR, Market Value, Power Rating
    y = _draw_section_title(c, "OVERVIEW", y)
    y = _draw_stat_row(c, ["oWAR", "MARKET VALUE", "POWER RATING"],
                       [_fmt(player.get("owar"), 1),
                        f"${int(player.get('nil_value', 0) or 0):,}" if player.get("nil_value") else "—",
                        _pct(player.get("power_rating_plus"))],
                       y, colors=[None, GOLD, None])

    # Projected stats
    y = _draw_section_title(c, "2026 PROJECTED STATS", y)
    proj_labels = ["AVG", "OBP", "SLG", "OPS", "ISO", "wRC+"]
    proj_values = [
        _fmt3(player.get("p_avg")),
        _fmt3(player.get("p_obp")),
        _fmt3(player.get("p_slg")),
        _fmt3(player.get("p_ops")),
        _fmt3(player.get("p_iso")),
        _pct(player.get("p_wrc_plus")),
    ]
    y = _draw_stat_row(c, proj_labels, proj_values, y)

    # Career stats table
    career_seasons = player.get("career_seasons", [])
    if career_seasons:
        y = _draw_section_title(c, "CAREER STATS", y)
        headers = ["YEAR", "TEAM", "PA", "AVG", "OBP", "SLG", "OPS", "ISO"]
        cw = [50, 60, 40, 60, 60, 60, 60, CONTENT_W - 390]
        rows = []
        for s in career_seasons:
            obp = float(s.get("OBP", 0) or 0)
            slg = float(s.get("SLG", 0) or 0)
            avg = float(s.get("AVG", 0) or 0)
            rows.append([
                s.get("Season", "—"), s.get("Team", "—"),
                s.get("pa", "—"),
                _fmt3(s.get("AVG")), _fmt3(s.get("OBP")),
                _fmt3(s.get("SLG")),
                _fmt3(obp + slg if obp and slg else None),
                _fmt3(slg - avg if slg and avg else None),
            ])
        y = _draw_table(c, headers, rows, y, cw)

    # Scouting grades
    grades = [
        ("Barrel%", player.get("barrel_score")),
        ("Exit Velo", player.get("ev_score")),
        ("Contact%", player.get("contact_score")),
        ("Chase%", player.get("chase_score")),
    ]
    grades = [(l, v) for l, v in grades if v is not None]
    if grades:
        y = _draw_section_title(c, "SCOUTING GRADES", y)
        y = _draw_scouting_grades(c, grades, y)

    # Scouting notes
    notes = player.get("scouting_notes")
    if notes:
        y = _draw_section_title(c, "SCOUTING NOTES", y)
        c.setFillColor(SLATE)
        c.setFont("Helvetica", 9)
        # Simple word wrap
        words = notes.split()
        line = ""
        for w in words:
            test = f"{line} {w}".strip()
            if c.stringWidth(test, "Helvetica", 9) > CONTENT_W - 8:
                c.drawString(MARGIN + 4, y, line)
                y -= 13
                line = w
            else:
                line = test
        if line:
            c.drawString(MARGIN + 4, y, line)
            y -= 13

    _draw_footer(c, report_title)
    c.showPage()


def generate_pitcher_page(c: Canvas, player: dict, report_title: str = None):
    """Draw a full pitcher profile page."""
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    y = PAGE_H - MARGIN

    # Header
    y = _draw_header(c, player, y)

    # Hero stats: pWAR, Market Value, Power Rating
    y = _draw_section_title(c, "OVERVIEW", y)
    y = _draw_stat_row(c, ["pWAR", "MARKET VALUE", "POWER RATING"],
                       [_fmt(player.get("p_war"), 2),
                        f"${int(player.get('market_value', 0) or 0):,}" if player.get("market_value") else "—",
                        _pct(player.get("overall_pr_plus"))],
                       y, colors=[None, GOLD, None])

    # Stuff+ / Whiff% overview
    stuff = player.get("stuff_plus")
    whiff = player.get("whiff_pct")
    if stuff is not None or whiff is not None:
        y = _draw_section_title(c, "STUFF+ OVERVIEW", y)
        labels = []
        values = []
        colors = []
        if stuff is not None:
            labels.append("STUFF+")
            values.append(_pct(stuff))
            colors.append(tier_color(stuff))
        if whiff is not None:
            labels.append("WHIFF%")
            values.append(f"{float(whiff):.1f}%")
            colors.append(tier_color(whiff, (27, 21, 16)))
        y = _draw_stat_row(c, labels, values, y,
                           col_w=CONTENT_W / len(labels), colors=colors)

    # Projected stats
    y = _draw_section_title(c, "2026 PROJECTED STATS", y)
    proj_labels = ["ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"]
    proj_values = [
        _fmt(player.get("p_era"), 2), _fmt(player.get("p_fip"), 2),
        _fmt(player.get("p_whip"), 2), _fmt(player.get("p_k9"), 2),
        _fmt(player.get("p_bb9"), 2), _fmt(player.get("p_hr9"), 2),
    ]
    y = _draw_stat_row(c, proj_labels, proj_values, y)

    # Career stats table
    career_seasons = player.get("career_seasons", [])
    if career_seasons:
        y = _draw_section_title(c, "CAREER STATS", y)
        headers = ["YEAR", "TEAM", "IP", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"]
        cw = [45, 55, 40, 55, 55, 55, 50, 50, CONTENT_W - 405]
        rows = []
        for s in career_seasons:
            rows.append([
                s.get("Season", "—"), s.get("Team", "—"),
                _fmt(s.get("IP"), 1), _fmt(s.get("ERA"), 2),
                _fmt(s.get("FIP"), 2), _fmt(s.get("WHIP"), 2),
                _fmt(s.get("K9"), 1), _fmt(s.get("BB9"), 1),
                _fmt(s.get("HR9"), 1),
            ])
        y = _draw_table(c, headers, rows, y, cw)

    # Pitch arsenal
    pitches = player.get("pitches", [])
    if pitches:
        y = _draw_section_title(c, "PITCH ARSENAL", y)
        headers = ["PITCH", "USAGE", "WHIFF%", "STUFF+"]
        cw = [CONTENT_W * 0.3, CONTENT_W * 0.23, CONTENT_W * 0.23, CONTENT_W * 0.24]
        rows = []
        for p in pitches:
            rows.append([
                p.get("pitch_name", "—"),
                f"{float(p.get('usage', 0)):.1f}%" if p.get("usage") else "—",
                f"{float(p.get('whiff', 0)):.1f}%" if p.get("whiff") else "—",
                _pct(p.get("stuff_plus")),
            ])
        y = _draw_table(c, headers, rows, y, cw)

    # Scouting grades
    grades = [
        ("Stuff+", player.get("stuff_score")),
        ("Whiff%", player.get("whiff_score")),
        ("BB%", player.get("bb_score")),
        ("Barrel%", player.get("barrel_score")),
    ]
    grades = [(l, v) for l, v in grades if v is not None]
    if grades:
        y = _draw_section_title(c, "SCOUTING GRADES", y)
        y = _draw_scouting_grades(c, grades, y)

    # Scouting notes
    notes = player.get("scouting_notes")
    if notes:
        y = _draw_section_title(c, "SCOUTING NOTES", y)
        c.setFillColor(SLATE)
        c.setFont("Helvetica", 9)
        words = notes.split()
        line = ""
        for w in words:
            test = f"{line} {w}".strip()
            if c.stringWidth(test, "Helvetica", 9) > CONTENT_W - 8:
                c.drawString(MARGIN + 4, y, line)
                y -= 13
                line = w
            else:
                line = test
        if line:
            c.drawString(MARGIN + 4, y, line)
            y -= 13

    _draw_footer(c, report_title)
    c.showPage()


def generate_report_pdf(players: list[dict], report_title: str = None,
                        generated_by: str = "RSTR IQ") -> bytes:
    """Generate a multi-page PDF report. Returns PDF bytes."""
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=letter)
    c.setTitle(report_title or "RSTR IQ Scouting Report")
    c.setAuthor(generated_by)

    for player in players:
        ptype = player.get("player_type", "hitter")
        if ptype == "pitcher":
            generate_pitcher_page(c, player, report_title)
        else:
            generate_hitter_page(c, player, report_title)

    c.save()
    return buf.getvalue()
