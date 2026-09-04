/**
 * One-time seed of the agent directory from Trevor's list (2026-09-04).
 *
 * There is deliberately NO CSV upload path in the app — this is a scripted,
 * auditable seed. Future bulk loads get rethought separately.
 *
 *   npx tsx scripts/seed-agents.ts            # DRY RUN — reports, writes nothing
 *   npx tsx scripts/seed-agents.ts --apply    # writes
 *
 * Writes go through resolve_or_create_agency / resolve_or_create_agent so the
 * dedupe rules are identical to what the UI uses. Re-running is safe: both are
 * find-or-create, so a second run inserts nothing.
 *
 * ⚠ Dedupe is EXACT match on lower(btrim(name)). Near-misses like
 * "Ballangee" vs "Ballengee Group" are therefore two different agencies. This
 * script does NOT auto-merge them — merging is a data judgment call, so it
 * reports collisions and leaves the source data intact.
 */
import pg from "pg";

// Raw source, kept verbatim so it can be diffed against the original.
// Tab-separated: First / Last / Company. Phone and Email arrived empty.
const RAW = `
Brady	Aiken	Excel
Grant	Alvarez	Paragon
Damon	Alvis	Stadium Ventures
Jonah	Arenado	The Team (Wasserman)
Tom	Battista	AMG Sports
Hudson	Belinsky	Waverly Avenue Sports
Chris	Betts	CAA
Scott	Bikowski
Hunter	Bledsoe	Bledsoe Agency
Michael	Bradshaw	Ballplayer Agency
Derek	Braunecker	Frontline
Chase	Brewer	Excel
Jim	Bullinger	Velocity Sports Management
Jesse	Burke	PSI
Riley	Carter	Alliance Baseball
Nic	Castonguay	Waverly Avenue Sports
Erik	Castro	Vayner
Preston	Chapman	Kares Sports Management
Ethan	Chapman	Paragon
Tony	Ciccolella	Ascend Sports
Casey	Close	Excel
Alex	Cotto	AC Sports
James	Covington	BC Sports
Charisse	Dash	MVMT Baseball
Mike	DeCicco	Stadium Ventures
Bob	Dunhurst	Meister Sports
Aaron	Elking	Republik Sports
Ryan	Erickson	Klutch
Ty	Evans	Paragon
Matt	Feld	Vanguard Sports
Jeff	Gatch	PSI
Carmine	Giardina	Full Circle
Al	Goetz	The Team (Wasserman)
Fernanado	Gonzalez
Garrett	Gore	Boras
Brian	Grieper	Paragon
Joseph	Guzman	Empowerment Sports
Charles	Hairston	Culture 39 Sports
Carter	Hall	Excel
Matt	Hannaford	Align
Brian	Hannaford	Align
Drew	Hardee	Jackson Merrill
Cedric	Harris	Culture 39 Sports
Matt	Harris	Aces
Patrick	Higley	Simon Sports Agency
Alex	Hintz	Ballplayer Agency
Eric	Hirschbein-Bodnar	Octagon
Michael	Hollimon	ISE
George	Iskenderian	Vayner
Reggie	Jefferson
Clarence	Johns	Dynasty Elite
Kevin	Keyes	ZS Sports
Trevor	Kieboom	Aces
Josh	Knipp	Kares Sports Management
Greg	Landry	Former Paragon
Chris	Lemonis	Covenant Sports Group
Brad	Levinson	Aces
Scott	Lonergan	Ballangee
Dylan	Manwaring	Align
Derek	Marquez	Latitude
Bryson	Massey	Evolv
Kent	Matthes	Stadium Ventures
Michael	Maulini	The Team (Wasserman)
Matt	McConnell	ISE
Eric	McQueen	Aces
Mark	Menaker	Octagon
Vic	Menocal	Excel
Andrew	Miester	Miester Sports
Alex	Ministeri	Olympic Agency Sports
Sam	Mueller	220ne Sports Group
Andrew	Nacario	CAA
X	Nady	Boras
David	O'hagan	Excel
Brandon	O'Hearn	Vayner
Joe	Oliver
Alex	Ott	The Team (Wasserman)
Tyler	Pastornicky	The Team (Wasserman)
DJ	Peterson
Mark	Pieper	ISE - CEO
Nate	Plotts	Excel
Brian	Porter
David	Ramsey	Ballengee Group
Jeff	Randazzo	Covenant Sports Group
Steve	Rath	Ballengee Group
Will	Ray	Vayner
Jordan	Reid	Frontline
Alec	Ritch	Apex
Rob	Rivard	Diamond Pros
Matt	Rodriguez	Frontline
Craig	Rose	Paragon
Adam	Rosenthal	Octagon
Jake	Rosner	Octagon
Dan	Rosquete	Evolv Sports
Gary	Russo	Bledsoe Agency
Sam	Samardzija	The Team (Wasserman)
George	Sandel
Mike	Sanders	Roc Nation
Hank	Sargent	The Team (Wasserman)
Scott	Shapiro	Magnus Media
Andy	Shaw	Equity Sports
Steve	Skrinar	Ballangee
Ty	Smith	Rosenhaus
Henri	Stanley	Ballangee
Lenny	Strelitz	Boras
Matt	Thomas	Boras
Tucker	Ward	Evolv
Brooks	Webb	Excel
Zach	Weisz	Weisz Sports
Matt	White	Boras
`;

/**
 * Corrections, ruled on by Trevor 2026-09-04. Kept as an explicit layer rather
 * than edited into RAW above, so the source stays diffable against what he sent
 * and every deviation from it is visible here.
 *
 * null = the agent becomes independent (no agency).
 */
const AGENCY_FIX: Record<string, string | null> = {
  // Same shop, two spellings. "Ballengee Group" is correct.
  "Ballangee": "Ballengee Group",
  // Fuller name wins.
  "Evolv": "Evolv Sports",
  // Andrew Miester's own surname says "Miester" is right; Dunhurst's entry is the typo.
  "Meister Sports": "Miester Sports",
  // "- CEO" was a job title in the company cell — moved to TITLE_FIX below.
  "ISE - CEO": "ISE",
  // Landry left Paragon; a status is not an employer.
  "Former Paragon": null,
  // "Jackson Merrill" is a Padres player, not an agency. Trevor supplied the real one.
  "Jackson Merrill": "KHG Sports Management",
};

const TITLE_FIX: Record<string, string> = { "Mark|Pieper": "CEO" };

const NAME_FIX: Record<string, { first?: string; last?: string }> = {
  "Fernanado|Gonzalez": { first: "Fernando" },
  "David|O'hagan": { last: "O'Hagan" },
  // ⚠ Inferred, NOT confirmed: Trevor could not find him on the Boras site, so the
  // Boras affiliation is unverified — the name is corrected, the agency is not.
  "X|Nady": { first: "Xavier" },
};

type Row = { first: string; last: string; company: string | null; title: string | null };

const rows: Row[] = RAW.trim().split("\n").map((line) => {
  const [f, l, c] = line.split("\t");
  let first = (f ?? "").trim();
  let last = (l ?? "").trim();
  let company: string | null = (c ?? "").trim() || null;

  const nk = `${first}|${last}`;
  if (NAME_FIX[nk]) { first = NAME_FIX[nk].first ?? first; last = NAME_FIX[nk].last ?? last; }
  if (company && company in AGENCY_FIX) company = AGENCY_FIX[company];

  return { first, last, company, title: TITLE_FIX[nk] ?? null };
});

const apply = process.argv.includes("--apply");

const agencies = [...new Set(rows.map((r) => r.company).filter(Boolean) as string[])].sort();
const independents = rows.filter((r) => !r.company);

console.log(`\n  ${apply ? "APPLY" : "DRY RUN — nothing will be written"}`);
console.log(`  ${rows.length} agents · ${agencies.length} distinct agencies · ${independents.length} independent (no agency)\n`);

console.log(`  ${Object.keys(AGENCY_FIX).length} agency corrections · ${Object.keys(NAME_FIX).length} name corrections · ${Object.keys(TITLE_FIX).length} title moved out of the company cell\n`);

// ── Anything still ambiguous AFTER the corrections. Should be empty. ──
const problems: string[] = [];

for (const r of rows) {
  if (r.company && /\s-\s(ceo|president|partner|vp)\b/i.test(r.company)) {
    problems.push(`"${r.first} ${r.last}" — company "${r.company}" still looks like agency + title`);
  }
  if (r.company && /^former\b/i.test(r.company)) {
    problems.push(`"${r.first} ${r.last}" — company "${r.company}" is a status, not an agency`);
  }
  if (r.first.length <= 1) problems.push(`"${r.first} ${r.last}" — single-character first name`);
}

// Same person listed twice would collapse silently via find-or-create.
const seen = new Map<string, number>();
for (const r of rows) {
  const k = `${r.first.toLowerCase()}|${r.last.toLowerCase()}|${(r.company ?? "").toLowerCase()}`;
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
for (const [k, n] of seen) if (n > 1) problems.push(`duplicate row (${n}×): ${k.replace(/\|/g, " · ")}`);

if (problems.length) {
  console.log("  ⚠ NEEDS A DECISION — not auto-corrected:");
  for (const p of problems) console.log(`     · ${p}`);
  console.log("");
}

if (!apply) {
  console.log("  Agencies that would be created:");
  console.log(agencies.map((a) => `     ${a}`).join("\n"));
  console.log(`\n  Independent agents (no agency): ${independents.map((r) => `${r.first} ${r.last}`).join(", ")}`);
  console.log("\n  Re-run with --apply to write.\n");
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.PGURI });
await client.connect();
const { rows: [who] } = await client.query("select current_database() db");
console.log(`  connected: ${who.db}`);

let createdAgencies = 0, createdAgents = 0, existing = 0;
try {
  await client.query("BEGIN");
  for (const r of rows) {
    const before = await client.query("select count(*)::int n from public.agents");
    await client.query(
      "select public.resolve_or_create_agent($1, $2, null, $3, $4)",
      [r.first, r.last, r.company, r.title],
    );
    const after = await client.query("select count(*)::int n from public.agents");
    if (after.rows[0].n > before.rows[0].n) createdAgents++; else existing++;
  }
  createdAgencies = (await client.query("select count(*)::int n from public.agencies")).rows[0].n;
  await client.query("COMMIT");
  console.log(`  ✅ agents created: ${createdAgents} · already present: ${existing} · agencies now: ${createdAgencies}`);
} catch (e: any) {
  await client.query("ROLLBACK");
  console.log(`  ❌ rolled back: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
