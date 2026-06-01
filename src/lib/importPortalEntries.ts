/**
 * Verified Athletics portal entry CSV importer.
 *
 * Input: daily export `transfers_YYYY-MM-DD.csv` with one row per portal
 * entry across all divisions. We filter to D1 only (rest of the app only
 * tracks D1 + JUCO players). Each row fuzzy-matches against players by
 * (First+Last + Current School + Position + Year). Unique matches update
 * the players row; ambiguous / no-match rows land in portal_entries_unmatched
 * for admin review.
 *
 * Withdrawal sweep: after upsert, any player marked IN_PORTAL whose
 * portal_last_seen_at is older than `withdrawalWindowDays` is flipped to
 * WITHDRAWN — Verified Athletics drops rows once a player exits the portal,
 * so absence from a recent export = no longer in portal.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseHeader } from "../../scripts/import-csvs/csv";

export interface PortalImportResult {
  totalRows: number;
  d1Rows: number;
  matched: number;
  committed: number;
  unmatched: number;
  withdrawn: number;
  arrived: number;
  /** Rows skipped because portal_entry_date predates the current window cutoff
   *  (most-recent passed Jan 15 / Sep 15). VA exports keep historical entries
   *  visible for ranking purposes — we don't want to re-tag those as active. */
  staleSkipped: number;
  /** Matched rows where players.portal_manual_override = true. Status/dates
   *  are preserved from the manual edit; bio + contact fields still update. */
  manualOverrideHeld: number;
  errors: string[];
}

interface PortalRow {
  firstName: string;
  lastName: string;
  year: string;
  division: string;
  currentSchool: string;
  commitSchool: string | null;
  commitDate: string | null;
  portalEntryDate: string | null;
  athleticAid: string | null;
  position: string | null;
  highSchool: string | null;
  homeState: string | null;
  conference: string | null;
  contactCell: string | null;
  contactEmail: string | null;
  gpa: number | null;
  rosterLink: string | null;
  /** True if GP/AB/IP are all empty/zero — player on roster but no stats accumulated. */
  hasNoStats: boolean;
}

function nameKey(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}

function schoolKey(s: string | null | undefined): string {
  if (!s) return "";
  // Drop "university"/"of"/"the" boilerplate so "Queens-Charlotte" matches
  // "Queens University of Charlotte". Keep "state", "college", "tech" etc.
  // since those distinguish (Georgia ≠ Georgia State).
  return s.toLowerCase()
    .replace(/\buniversity\b/g, "")
    .replace(/\bof\b/g, "")
    .replace(/\bthe\b/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

function parseGpa(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

function parseDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // Two formats seen: 'YYYY-MM-DD' and 'M/D/YY'
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, mo, d, y] = m;
    const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
    return `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseRows(csvText: string): PortalRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseHeader(lines[0]).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());

  const idxOf = (...names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const cols = {
    firstName: idxOf("First Name"),
    lastName: idxOf("Last Name"),
    year: idxOf("Year"),
    division: idxOf("Division"),
    currentSchool: idxOf("Current School"),
    commitSchool: idxOf("Commit School"),
    commitDate: idxOf("Commit Date"),
    portalEntryDate: idxOf("Date"),
    athleticAid: idxOf("Athletic Aid"),
    position: idxOf("Position"),
    highSchool: idxOf("High School"),
    homeState: idxOf("State"),
    conference: idxOf("Conference"),
    contactEmail: idxOf("Email"),
    contactCell: idxOf("Cell"),
    gpa: idxOf("GPA"),
    rosterLink: idxOf("Roster Link"),
    gp: idxOf("GP"),
    ab: idxOf("AB"),
    ip: idxOf("IP"),
  };

  const isBlankOrZero = (s: string | undefined) => {
    if (!s) return true;
    const t = s.trim();
    if (!t) return true;
    const n = Number(t);
    return Number.isFinite(n) && n === 0;
  };

  const out: PortalRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const firstName = (c[cols.firstName] ?? "").trim();
    const lastName = (c[cols.lastName] ?? "").trim();
    if (!firstName && !lastName) continue;
    if (firstName.toLowerCase() === "unknown" && !lastName) continue;

    out.push({
      firstName,
      lastName,
      year: (c[cols.year] ?? "").trim(),
      division: (c[cols.division] ?? "").trim(),
      currentSchool: (c[cols.currentSchool] ?? "").trim(),
      commitSchool: (c[cols.commitSchool] ?? "").trim() || null,
      commitDate: parseDate(c[cols.commitDate]),
      portalEntryDate: parseDate(c[cols.portalEntryDate]),
      athleticAid: (c[cols.athleticAid] ?? "").trim() || null,
      position: (c[cols.position] ?? "").trim() || null,
      highSchool: (c[cols.highSchool] ?? "").trim() || null,
      homeState: (c[cols.homeState] ?? "").trim() || null,
      conference: (c[cols.conference] ?? "").trim() || null,
      contactCell: (c[cols.contactCell] ?? "").trim() || null,
      contactEmail: (c[cols.contactEmail] ?? "").trim() || null,
      gpa: parseGpa(c[cols.gpa]),
      rosterLink: (c[cols.rosterLink] ?? "").trim() || null,
      hasNoStats: isBlankOrZero(c[cols.gp]) && isBlankOrZero(c[cols.ab]) && isBlankOrZero(c[cols.ip]),
    });
  }
  return out;
}

type PlayerLite = {
  id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  position: string | null;
  class_year: string | null;
  division: string;
  portal_manual_override: boolean | null;
};

async function fetchD1Players(): Promise<PlayerLite[]> {
  const all: PlayerLite[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("players")
      .select("id, first_name, last_name, team, position, class_year, division, portal_manual_override")
      .eq("division", "D1")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch players: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Lev distance for fuzzy first-name match (Charles↔Charlie, Aiden↔Aidan)
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  }
  return d[m][n];
}

function matchPlayers(row: PortalRow, players: PlayerLite[]): PlayerLite[] {
  const fnk = nameKey(row.firstName);
  const lnk = nameKey(row.lastName);
  const sk = schoolKey(row.currentSchool);
  const pos = (row.position ?? "").toLowerCase();
  const yr = row.year.toUpperCase().replace(/^R-?/, ""); // FR/SO/JR/SR; redshirt-tolerant

  // Pass 1: exact name + school match
  let candidates = players.filter((p) =>
    nameKey(p.first_name) === fnk &&
    nameKey(p.last_name) === lnk &&
    schoolKey(p.team) === sk,
  );
  if (candidates.length === 1) return candidates;

  // Pass 2: exact name match across all D1 (school name might differ between sources)
  if (candidates.length === 0) {
    candidates = players.filter((p) =>
      nameKey(p.first_name) === fnk &&
      nameKey(p.last_name) === lnk,
    );
  }

  // Pass 3: fuzzy first name, exact last + exact school (Charles↔Charlie, Aiden↔Aidan).
  // Threshold: lev distance ≤ 2 OR shared 3-char prefix.
  if (candidates.length === 0) {
    candidates = players.filter((p) => {
      if (nameKey(p.last_name) !== lnk) return false;
      if (schoolKey(p.team) !== sk) return false;
      const pf = nameKey(p.first_name);
      if (pf === fnk) return true;
      const d = lev(pf, fnk);
      if (d <= 2) return true;
      const minLen = Math.min(pf.length, fnk.length);
      return minLen >= 3 && pf.slice(0, 3) === fnk.slice(0, 3);
    });
  }

  // Pass 4: last name + school + position-type uniqueness (Michael↔Mike, JP↔Jonathan).
  // Only accept if exactly one candidate fits — avoids misjoining brothers/teammates.
  if (candidates.length === 0) {
    const csvIsPitcher = /^(p|rhp|lhp)$/i.test(pos);
    const candidatesAtSchool = players.filter((p) =>
      nameKey(p.last_name) === lnk && schoolKey(p.team) === sk,
    );
    if (candidatesAtSchool.length === 1) {
      // Only one player with that last name at that school — accept it
      candidates = candidatesAtSchool;
    } else if (candidatesAtSchool.length > 1 && pos) {
      // Multiple candidates — narrow by position type
      const narrowed = candidatesAtSchool.filter((p) => {
        const pp = (p.position ?? "").toLowerCase();
        if (!pp) return false;
        const dbIsPitcher = /^(p|rhp|lhp|sp|rp)$/i.test(pp);
        return csvIsPitcher === dbIsPitcher;
      });
      if (narrowed.length === 1) candidates = narrowed;
    }
  }

  if (candidates.length <= 1) return candidates;

  // Pass 3: tiebreak by position (P/RHP/LHP all collapse to "P-ish")
  if (pos) {
    const isPitcherCsv = /^(p|rhp|lhp)$/i.test(pos);
    const positioned = candidates.filter((p) => {
      const pp = (p.position ?? "").toLowerCase();
      if (!pp) return false;
      const isPitcherDb = /^(p|rhp|lhp|sp|rp)$/i.test(pp);
      return isPitcherCsv === isPitcherDb;
    });
    if (positioned.length === 1) return positioned;
    if (positioned.length > 0) candidates = positioned;
  }

  // Pass 4: tiebreak by class year
  if (yr) {
    const yearMatched = candidates.filter((p) => (p.class_year ?? "").toUpperCase().replace(/^R-?/, "") === yr);
    if (yearMatched.length === 1) return yearMatched;
  }

  return candidates;
}

// Mode determines what status to apply to matched players. The three modes
// correspond to the three VA export filters:
//   "entries"     — full portal list. Per-row decision: IN PORTAL unless
//                   commit_school is set, in which case COMMITTED.
//   "commits"     — VA-filtered to signed players. Forces COMMITTED + writes
//                   commit_school/commit_date from the row.
//   "withdrawals" — VA-filtered to withdrawn players. Forces WITHDRAWN, clears
//                   commit info.
//
// All three modes share the matcher, unmatched-row handling, and reset-on-
// arrival sweep. None of them perform the absence-based withdrawal sweep —
// that was removed because the VA export caps at 500 rows.
export type PortalImportMode = "entries" | "commits" | "withdrawals";

export async function importPortalEntriesCsv(
  csvText: string,
  mode: PortalImportMode = "entries",
): Promise<PortalImportResult> {
  const result: PortalImportResult = {
    totalRows: 0, d1Rows: 0, matched: 0, committed: 0, unmatched: 0, withdrawn: 0, arrived: 0, staleSkipped: 0, manualOverrideHeld: 0, errors: [],
  };

  // Stale-row cutoff: skip any CSV row whose portal_entry_date predates the
  // most-recent window-close (Jan 15 / Sep 15). VA's export keeps historical
  // entries visible — we shouldn't re-tag a 2024-08-15 entry as active in
  // May 2026. The resetArrivedCommittedPlayers sweep handles already-stored
  // stale rows; this filter prevents new stale rows from being written.
  const windowCutoff = getLastResetCutoff(new Date()).toISOString().slice(0, 10);

  const allRows = parseRows(csvText);
  result.totalRows = allRows.length;
  const rows = allRows.filter((r) => r.division.toUpperCase() === "D1");
  result.d1Rows = rows.length;

  if (rows.length === 0) {
    result.errors.push("No D1 rows in CSV");
    return result;
  }

  const players = await fetchD1Players();
  const seenPlayerIds = new Set<string>();
  const nowIso = new Date().toISOString();

  // Idempotency: clear unresolved unmatched rows ONLY when running the full
  // "entries" pass (which is supposed to be the authoritative snapshot of
  // who's currently in the portal). Commits + withdrawals CSVs are filtered
  // subsets and would falsely clear the entries-pass review queue.
  // Admin-resolved rows (resolved=true) always persist — audit log.
  if (mode === "entries") {
    const { error: clearErr } = await (supabase as any)
      .from("portal_entries_unmatched")
      .delete()
      .eq("resolved", false);
    if (clearErr) {
      console.warn(`[importPortalEntries] Failed to clear unresolved rows: ${clearErr.message}`);
    }
  }

  for (const row of rows) {
    try {
      // Skip rows older than the current portal window. Pre-cutoff entries
      // are from a previous semester and shouldn't be reactivated.
      if (row.portalEntryDate && row.portalEntryDate < windowCutoff) {
        result.staleSkipped++;
        continue;
      }
      const candidates = matchPlayers(row, players);

      if (candidates.length === 0) {
        // Zero-stat rows (didn't play this season — redshirt, walk-on, injury)
        // are tagged separately so admin can filter them out of the review queue.
        const reason = row.hasNoStats ? "no_stats" : "no_match";
        await insertUnmatched(row, reason, []);
        result.unmatched++;
        continue;
      }
      if (candidates.length > 1) {
        await insertUnmatched(row, "ambiguous", candidates.map((c) => c.id));
        result.unmatched++;
        continue;
      }

      // Unique match — update players row
      const player = candidates[0];
      // Status resolution per mode:
      //   entries     — IN PORTAL unless commit_school filled (COMMITTED)
      //   commits     — always COMMITTED (VA pre-filtered to signed)
      //   withdrawals — always WITHDRAWN (VA pre-filtered to withdrawn)
      const isCommitted = mode === "commits" || (mode === "entries" && !!row.commitSchool);
      const isWithdrawn = mode === "withdrawals";
      const status = isWithdrawn ? "WITHDRAWN" : isCommitted ? "COMMITTED" : "IN PORTAL";

      // Manual-override hold: if an admin has hand-set this player's portal
      // status, preserve those columns. Bio + contact fields from VA still
      // flow in so cell/email/GPA/aid/roster link stay fresh.
      const holdManual = player.portal_manual_override === true;

      const payload: Record<string, unknown> = {
        portal_last_seen_at: nowIso,
        ...(holdManual ? {} : {
          portal_status: status,
          transfer_portal: !isWithdrawn,
          portal_entry_date: row.portalEntryDate,
        }),
        // Don't clobber commit info for withdrawal rows — leave whatever was
        // there. For entries + commits, write the row's commit details (unless
        // manual override holds them).
        ...(isWithdrawn ? {} : {
          ...(holdManual ? {} : {
            commit_school: row.commitSchool,
            commit_date: row.commitDate,
          }),
          athletic_aid: row.athleticAid,
          contact_cell: row.contactCell,
          contact_email: row.contactEmail,
          gpa: row.gpa,
          va_roster_link: row.rosterLink,
        }),
      };
      // Fill bio fields if missing on player record
      if (row.highSchool) payload.high_school = row.highSchool;
      if (row.homeState) payload.home_state = row.homeState;

      const { error } = await (supabase as any)
        .from("players")
        .update(payload)
        .eq("id", player.id);

      if (error) {
        result.errors.push(`${row.firstName} ${row.lastName}: ${error.message}`);
        continue;
      }

      seenPlayerIds.add(player.id);
      result.matched++;
      if (holdManual) result.manualOverrideHeld++;
      if (isCommitted && !holdManual) result.committed++;
      if (isWithdrawn && !holdManual) result.withdrawn++;
    } catch (e) {
      result.errors.push(`${row.firstName} ${row.lastName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Reset-on-arrival sweep — a committed player whose current team in our
  // master tables already matches the commit school is "back to normal" — they
  // arrived, played, and the portal note is stale. Flip them to NOT IN PORTAL.
  //
  // Rule: portal_status = COMMITTED AND nameKey(commit_school) == nameKey(players.team)
  // → clear all portal fields. Keeps the data clean so the dashboard "in portal"
  // count + activity feed reflect current reality, not lingering bookkeeping.
  await resetArrivedCommittedPlayers(result);

  // Auto-withdrawal sweep DISABLED 2026-05-20.
  //
  // Verified Athletics exports cap at 500 rows. Once D1 portal windows open
  // (early-June, mid-August), the actual portal population will exceed 500
  // and players ranked 501+ would be incorrectly marked WITHDRAWN here just
  // because they fell out of the daily snapshot. Absence ≠ withdrawn under
  // a hard export cap.
  //
  // Replacement strategy:
  //   - portal_last_seen_at is still maintained on every matched update, so
  //     admins can manually surface "haven't seen this player in N days"
  //     queries when curating the board.
  //   - When VA does include an explicit WITHDRAWN status in the CSV (future
  //     export format), wire that signal into the matched-player update
  //     path so we have a positive signal rather than absence-based proxy.
  // result.withdrawn is incremented per-row in withdrawals-mode above; don't
  // overwrite it here.

  return result;
}

/**
 * Returns the most recent passed window-close date (Jan 15 or Sep 15). Portal
 * entries older than this are considered stale — they belong to a prior window
 * and the player has presumably moved on.
 *
 * Two windows per year aligned with college semester rhythm:
 *   - Jan 15: winter portal closes (spring semester starts)
 *   - Sep 15: summer/fall portal closes (fall semester underway)
 */
function getLastResetCutoff(today: Date): Date {
  const y = today.getFullYear();
  // Month is 0-indexed: 0 = January, 8 = September
  const candidates = [
    new Date(y - 1, 0, 15),
    new Date(y - 1, 8, 15),
    new Date(y, 0, 15),
    new Date(y, 8, 15),
  ].filter((d) => d.getTime() <= today.getTime());
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Clear portal status for players whose entry date is older than the most-recent
 * window-close (Jun 15 or Sep 15). Once a new semester starts, lingering portal
 * entries from the previous window are stale.
 */
async function resetArrivedCommittedPlayers(result: PortalImportResult): Promise<void> {
  const cutoff = getLastResetCutoff(new Date()).toISOString().slice(0, 10);
  const { data, error } = await (supabase as any)
    .from("players")
    .select("id, portal_entry_date")
    .in("portal_status", ["IN PORTAL", "COMMITTED"])
    .not("portal_entry_date", "is", null)
    .lt("portal_entry_date", cutoff)
    .or("portal_manual_override.is.null,portal_manual_override.eq.false");
  if (error || !data || data.length === 0) return;
  const staleIds = (data as Array<{ id: string }>).map((p) => p.id);
  const { error: updErr } = await (supabase as any)
    .from("players")
    .update({
      portal_status: "NOT IN PORTAL",
      transfer_portal: false,
      portal_entry_date: null,
      portal_last_seen_at: null,
      commit_school: null,
      commit_date: null,
      athletic_aid: null,
      contact_cell: null,
      contact_email: null,
      gpa: null,
      va_roster_link: null,
    })
    .in("id", staleIds);
  if (updErr) result.errors.push(`Window-close reset sweep: ${updErr.message}`);
  else result.arrived = staleIds.length;
}

async function insertUnmatched(row: PortalRow, reason: "ambiguous" | "no_match" | "no_stats", candidateIds: string[]): Promise<void> {
  const { error } = await (supabase as any)
    .from("portal_entries_unmatched")
    .insert({
      first_name: row.firstName,
      last_name: row.lastName,
      year_class: row.year || null,
      division: row.division || null,
      current_school: row.currentSchool || null,
      position: row.position,
      high_school: row.highSchool,
      home_state: row.homeState,
      conference: row.conference,
      portal_entry_date: row.portalEntryDate,
      commit_school: row.commitSchool,
      commit_date: row.commitDate,
      athletic_aid: row.athleticAid,
      contact_cell: row.contactCell,
      contact_email: row.contactEmail,
      gpa: row.gpa,
      va_roster_link: row.rosterLink,
      reason,
      candidate_player_ids: candidateIds.length > 0 ? candidateIds : null,
    });
  if (error) throw new Error(`Insert unmatched: ${error.message}`);
}
