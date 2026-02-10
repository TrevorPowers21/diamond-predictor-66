

# College Baseball Analytics Platform

## Overview
A team-branded analytics platform housing your transfer portal prediction model, returning player production model, and NIL valuation system. Role-based access controls let staff see everything while external users (agents, recruits) see only what you allow. Two-way Google Sheets sync keeps your existing workflow intact while providing a proper database and polished dashboards.

## Phase 1: Foundation & Authentication
- Set up the database with Lovable Cloud (Supabase) to store player data, stats, model outputs, and configurations
- Build authentication with role-based access (admin/staff, scout, external viewer)
- Apply your team branding — colors, logos, and overall visual identity throughout the app

## Phase 2: Data Architecture & Google Sheets Sync
- Design database tables for: players, season stats, conference-adjusted stats, park factors, power ratings, developmental weights, and NIL valuations
- Build two-way Google Sheets sync via edge functions so changes in either place stay in sync
- Create data validation to ensure clean imports and flag anomalies

## Phase 3: Model Calculation Engine
- Implement the transfer portal prediction model logic (conference-adjusted stats × park factors × stuff/competition quality × power rating)
- Build the returning player production model (stats × developmental aggressiveness weight × year-to-year adjustment × power rating)
- Create the NIL valuation equation based on offensive effectiveness outputs
- All calculations run server-side via edge functions so model logic stays protected

## Phase 4: Dashboards & Visualization
- **Transfer Portal Rankings** — Sortable/filterable ranked list of portal targets with model scores, conference, position, and key stats
- **Returning Player Projections** — Projected stats and development curves for your current roster with year-over-year trends
- **NIL Valuations** — Dollar value estimates with breakdowns of the offensive effectiveness components driving each valuation
- **Player Comparison Tool** — Side-by-side comparisons of any two or more players across all model dimensions with radar charts and stat tables

## Phase 5: Role-Based Views & Access Control
- Staff/admin dashboard: full access to all models, raw data, and configuration
- Scout/recruiter view: transfer portal rankings and player profiles (no model internals)
- External/agent view: NIL valuations and summary stats only
- Admin panel to manage users and assign roles

## Phase 6: Polish & Extras
- Mobile-responsive design for on-the-go scouting
- Export capabilities (PDF reports, CSV downloads)
- Search and filtering across all player data
- Notification system for significant model score changes or new portal entries

