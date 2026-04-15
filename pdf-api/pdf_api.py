"""
RSTR IQ Scouting Report — FastAPI PDF Service
Accepts player data from the frontend, generates a branded PDF, and streams it back.
"""

import os
import json
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv

from generate_profile import generate_report_pdf

load_dotenv()

app = FastAPI(title="RSTR IQ PDF API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8080",
        "https://rstriq.com",
        "https://app.rstriq.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_PLAYERS = 30


# ── Request models ───────────────────────────────────────────────────

class PlayerPayload(BaseModel):
    """Player data sent from the frontend. Supports both hitter and pitcher."""
    player_type: str = "hitter"  # "hitter" or "pitcher"
    name: str = "Unknown Player"
    school: Optional[str] = None
    position: Optional[str] = None
    class_year: Optional[str] = None
    bats_throws: Optional[str] = None

    # Hitter projected
    p_avg: Optional[float] = None
    p_obp: Optional[float] = None
    p_slg: Optional[float] = None
    p_ops: Optional[float] = None
    p_iso: Optional[float] = None
    p_wrc_plus: Optional[float] = None
    owar: Optional[float] = None
    nil_value: Optional[float] = None
    power_rating_plus: Optional[float] = None

    # Hitter scouting
    barrel_score: Optional[float] = None
    ev_score: Optional[float] = None
    contact_score: Optional[float] = None
    chase_score: Optional[float] = None

    # Pitcher projected
    p_era: Optional[float] = None
    p_fip: Optional[float] = None
    p_whip: Optional[float] = None
    p_k9: Optional[float] = None
    p_bb9: Optional[float] = None
    p_hr9: Optional[float] = None
    p_war: Optional[float] = None
    market_value: Optional[float] = None
    overall_pr_plus: Optional[float] = None

    # Pitcher scouting
    stuff_plus: Optional[float] = None
    whiff_pct: Optional[float] = None
    stuff_score: Optional[float] = None
    whiff_score: Optional[float] = None
    bb_score: Optional[float] = None

    # Career seasons (list of dicts)
    career_seasons: Optional[list] = None

    # Pitch arsenal (pitcher only)
    pitches: Optional[list] = None

    # Notes
    scouting_notes: Optional[str] = None


class ReportRequest(BaseModel):
    players: list[PlayerPayload]
    report_title: Optional[str] = None
    generated_by: str = "RSTR IQ"


# ── Routes ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "rstriq-pdf-api"}


@app.post("/api/reports/generate")
def generate_report(req: ReportRequest):
    if len(req.players) > MAX_PLAYERS:
        raise HTTPException(400, f"Maximum {MAX_PLAYERS} players per report")
    if len(req.players) == 0:
        raise HTTPException(400, "At least one player is required")

    player_dicts = [p.model_dump() for p in req.players]
    pdf_bytes = generate_report_pdf(player_dicts, req.report_title, req.generated_by)

    filename = "RSTR_IQ_Scouting_Report"
    if req.report_title:
        safe_title = "".join(c for c in req.report_title if c.isalnum() or c in " _-").strip()
        filename = f"RSTR_IQ_{safe_title.replace(' ', '_')}"
    filename += f"_{datetime.now().strftime('%Y%m%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@app.get("/api/reports/demo")
def demo_report():
    """Generate a 2-player demo report to verify PDF output."""
    demo_hitter = {
        "player_type": "hitter",
        "name": "Demo Hitter",
        "school": "TCU",
        "position": "SS",
        "class_year": "Jr",
        "bats_throws": "R/R",
        "p_avg": 0.312, "p_obp": 0.401, "p_slg": 0.538,
        "p_ops": 0.939, "p_iso": 0.226, "p_wrc_plus": 142,
        "owar": 3.2, "nil_value": 285000, "power_rating_plus": 118,
        "barrel_score": 78, "ev_score": 82, "contact_score": 65, "chase_score": 71,
        "career_seasons": [
            {"Season": 2024, "Team": "TCU", "pa": 180, "AVG": 0.285, "OBP": 0.375, "SLG": 0.490},
            {"Season": 2025, "Team": "TCU", "pa": 240, "AVG": 0.312, "OBP": 0.401, "SLG": 0.538},
        ],
    }
    demo_pitcher = {
        "player_type": "pitcher",
        "name": "Demo Pitcher",
        "school": "TCU",
        "position": "RHP",
        "class_year": "So",
        "bats_throws": "R/R",
        "p_era": 3.45, "p_fip": 3.21, "p_whip": 1.12,
        "p_k9": 10.8, "p_bb9": 2.9, "p_hr9": 0.85,
        "p_war": 2.1, "market_value": 195000, "overall_pr_plus": 112,
        "stuff_plus": 106, "whiff_pct": 28.5,
        "stuff_score": 85, "whiff_score": 79, "bb_score": 62, "barrel_score": 70,
        "career_seasons": [
            {"Season": 2025, "Team": "TCU", "IP": 78.2, "ERA": 3.65, "FIP": 3.42, "WHIP": 1.18, "K9": 10.2, "BB9": 3.1, "HR9": 0.92},
        ],
        "pitches": [
            {"pitch_name": "4-Seam FB", "usage": 52.3, "whiff": 18.5, "stuff_plus": 104},
            {"pitch_name": "Slider", "usage": 28.1, "whiff": 38.2, "stuff_plus": 112},
            {"pitch_name": "Change-Up", "usage": 19.6, "whiff": 35.1, "stuff_plus": 108},
        ],
    }

    pdf_bytes = generate_report_pdf([demo_hitter, demo_pitcher], "Demo Report", "RSTR IQ")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="RSTR_IQ_Demo_Report.pdf"'},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
