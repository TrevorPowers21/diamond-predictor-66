import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Comprehensive alias map: short/common name → canonical teams table name
const TEAM_ALIASES: Record<string, string> = {
  // SEC
  "lsu": "Louisiana State University",
  "louisiana state": "Louisiana State University",
  "ole miss": "University of Mississippi",
  "mississippi": "University of Mississippi",
  "mississippi st.": "Mississippi State University",
  "mississippi st": "Mississippi State University",
  "mississippi state": "Mississippi State University",
  "alabama": "University of Alabama",
  "arkansas": "University of Arkansas",
  "auburn": "Auburn University",
  "florida": "University of Florida",
  "georgia": "University of Georgia",
  "kentucky": "University of Kentucky",
  "missouri": "University of Missouri",
  "oklahoma": "University of Oklahoma",
  "south carolina": "University of South Carolina",
  "tennessee": "University of Tennessee",
  "texas": "University of Texas",
  "texas a&m": "Texas A&M University",
  "vanderbilt": "Vanderbilt University",
  // ACC
  "boston college": "Boston College",
  "california": "University of California",
  "cal": "University of California",
  "clemson": "Clemson University",
  "duke": "Duke University",
  "florida state": "Florida State University",
  "florida st.": "Florida State University",
  "georgia tech": "Georgia Tech",
  "louisville": "University of Louisville",
  "miami": "University of Miami",
  "miami (fl)": "University of Miami",
  "north carolina": "University of North Carolina",
  "north carolina state": "North Carolina State University",
  "nc state": "North Carolina State University",
  "notre dame": "University of Notre Dame",
  "pittsburgh": "University of Pittsburgh",
  "pitt": "University of Pittsburgh",
  "stanford": "Stanford University",
  "virginia": "University of Virginia",
  "virginia tech": "Virginia Tech",
  "wake forest": "Wake Forest University",
  "syracuse": "Syracuse University",
  "smu": "SMU",
  // Big Ten
  "illinois": "University of Illinois",
  "indiana": "Indiana University",
  "iowa": "University of Iowa",
  "maryland": "University of Maryland",
  "michigan": "University of Michigan",
  "michigan state": "Michigan State University",
  "michigan st.": "Michigan State University",
  "minnesota": "University of Minnesota",
  "nebraska": "University of Nebraska",
  "northwestern": "Northwestern University",
  "ohio state": "The Ohio State University",
  "ohio st.": "The Ohio State University",
  "oregon": "University of Oregon",
  "penn state": "Penn State University",
  "penn st.": "Penn State University",
  "purdue": "Purdue University",
  "rutgers": "Rutgers University",
  "usc": "University of Southern California",
  "southern california": "University of Southern California",
  "ucla": "UCLA",
  "washington": "University of Washington",
  "wisconsin": "University of Wisconsin-Milwaukee",
  // Big 12
  "arizona": "University of Arizona",
  "arizona state": "Arizona State University",
  "arizona st.": "Arizona State University",
  "baylor": "Baylor University",
  "byu": "Brigham Young University",
  "brigham young": "Brigham Young University",
  "central florida": "University of Central Florida",
  "ucf": "University of Central Florida",
  "cincinnati": "University of Cincinnati",
  "colorado": "University of Colorado",
  "houston": "University of Houston",
  "iowa state": "Iowa State University",
  "iowa st.": "Iowa State University",
  "kansas": "University of Kansas",
  "kansas state": "Kansas State University",
  "kansas st.": "Kansas State University",
  "oklahoma state": "Oklahoma State University",
  "oklahoma st.": "Oklahoma State University",
  "tcu": "Texas Christian University",
  "texas christian": "Texas Christian University",
  "texas tech": "Texas Tech University",
  "utah": "University of Utah",
  "west virginia": "West Virginia University",
  // Big East
  "butler": "Butler University",
  "connecticut": "University of Connecticut",
  "uconn": "University of Connecticut",
  "creighton": "Creighton University",
  "georgetown": "Georgetown University",
  "seton hall": "Seton Hall University",
  "st. john's": "St. John's University (NY)",
  "villanova": "Villanova University",
  "xavier": "Xavier University",
  // Pac-12
  "oregon state": "Oregon State University",
  "oregon st.": "Oregon State University",
  "washington state": "Washington State University",
  "washington st.": "Washington State University",
  // AAC
  "charlotte": "Charlotte",
  "east carolina": "East Carolina",
  "fau": "Florida Atlantic",
  "florida atlantic": "Florida Atlantic",
  "memphis": "Memphis",
  "rice": "Rice",
  "south florida": "South Florida",
  "south fla.": "South Florida",
  "usf": "South Florida",
  "tulane": "Tulane",
  "uab": "UAB",
  "utsa": "UTSA",
  "wichita state": "Wichita State ",
  "wichita st.": "Wichita State ",
  // Sun Belt
  "appalachian state": "Appalachian State University",
  "appalachian st.": "Appalachian State University",
  "app state": "Appalachian State University",
  "arkansas state": "Arkansas State University",
  "arkansas st.": "Arkansas State University",
  "coastal carolina": "Coastal Carolina University",
  "georgia southern": "Georgia Southern University",
  "georgia state": "Georgia State University",
  "james madison": "James Madison University",
  "louisiana": "University of Louisiana at Lafayette",
  "ul-lafayette": "University of Louisiana at Lafayette",
  "ul monroe": "University of Louisiana at Monroe",
  "louisiana-monroe": "University of Louisiana at Monroe",
  "marshall": "Marshall University",
  "old dominion": "Old Dominion University",
  "southern miss": "Southern Mississippi",
  "southern miss.": "Southern Mississippi",
  "south alabama": "South Alabama",
  "texas state": "Texas State University",
  "texas st.": "Texas State University",
  "troy": "Troy University",
  // Mountain West
  "air force": "Air Force Academy",
  "fresno state": "Fresno State",
  "fresno st.": "Fresno State",
  "grand canyon": "Grand Canyon University",
  "nevada": "Nevada",
  "new mexico": "University of New Mexico",
  "san diego state": "San Diego State University",
  "san diego st.": "San Diego State University",
  "sdsu": "San Diego State University",
  "san jose state": "San Jose State University",
  "san jose st.": "San Jose State University",
  "unlv": "UNLV",
  // MVC
  "belmont": "Belmont University",
  "bradley": "Bradley University",
  "evansville": "University of Evansville",
  "illinois state": "Illinois State University",
  "illinois st.": "Illinois State University",
  "indiana state": "Indiana State University",
  "indiana st.": "Indiana State University",
  "missouri state": "Missouri State University",
  "missouri st.": "Missouri State University",
  "murray state": "Murray State University",
  "murray st.": "Murray State University",
  "southern illinois": "Southern Illinois University",
  "siu": "Southern Illinois University",
  "valparaiso": "Valparaiso University",
  "illinois-chicago": "University of Illinois-Chicago",
  "uic": "University of Illinois-Chicago",
  // A-10
  "davidson": "Davidson College",
  "dayton": "University of Dayton",
  "fordham": "Fordham University",
  "george mason": "George Mason University",
  "george washington": "George Washington University",
  "la salle": "La Salle",
  "rhode island": "University of Rhode Island",
  "richmond": "University of Richmond",
  "saint joseph's": "Saint Joseph's University",
  "st. joseph's": "Saint Joseph's University",
  "saint louis": "Saint Louis University",
  "st. louis": "Saint Louis University",
  "st. bonaventure": "St. Bonaventure University",
  "vcu": "Virginia Commonwealth University",
  // CAA
  "campbell": "Campbell University",
  "charleston": "College of Charleston",
  "college of charleston": "College of Charleston",
  "delaware": "University of Delaware",
  "elon": "Elon University",
  "hofstra": "Hofstra University",
  "monmouth": "Monmouth University",
  "north carolina a&t": "North Carolina A&T State University",
  "nc a&t": "North Carolina A&T State University",
  "northeastern": "Northeastern University",
  "stony brook": "Stony Brook University",
  "towson": "Towson University",
  "unc wilmington": "UNC Wilmington",
  "uncw": "UNC Wilmington",
  "william & mary": "College of William & Mary",
  // Southern
  "the citadel": "The Citadel",
  "citadel": "The Citadel",
  "east tennessee state": "East Tennessee State University",
  "east tennessee st.": "East Tennessee State University",
  "etsu": "East Tennessee State University",
  "furman": "Furman University",
  "mercer": "Mercer University",
  "samford": "Samford University",
  "unc greensboro": "UNC Greensboro",
  "uncg": "UNC Greensboro",
  "vmi": "Virginia Military Institute",
  "western carolina": "Western Carolina University",
  "wofford": "Wofford College",
  // MAAC
  "canisius": "Canisius College",
  "fairfield": "Fairfield University",
  "iona": "Iona College",
  "manhattan": "Manhattan College",
  "marist": "Marist College",
  "mount st. mary's": "Mount St. Mary's University",
  "mt. st. mary's": "Mount St. Mary's University",
  "niagara": "Niagara University",
  "quinnipiac": "Quinnipiac University",
  "rider": "Rider University",
  "sacred heart": "Sacred Heart University",
  "saint peter's": "Saint Peter's University",
  "st. peter's": "Saint Peter's University",
  "siena": "Siena College",
  "merrimack": "Merrimack",
  // Big South
  "charleston southern": "Charleston Southern University",
  "gardner webb": "Gardner Webb University",
  "gardner-webb": "Gardner Webb University",
  "high point": "High Point University",
  "longwood": "Longwood University",
  "presbyterian": "Presbyterian College",
  "radford": "Radford University",
  "south carolina upstate": "University of South Carolina Upstate",
  "usc upstate": "University of South Carolina Upstate",
  "unc asheville": "UNC Asheville",
  "winthrop": "Winthrop University",
  // ASUN
  "austin peay": "Austin Peay State University",
  "austin peay state": "Austin Peay State University",
  "bellarmine": "Bellarmine University",
  "central arkansas": "University of Central Arkansas",
  "eastern kentucky": "Eastern Kentucky University",
  "fgcu": "Florida Gulf Coast University",
  "florida gulf coast": "Florida Gulf Coast University",
  "jacksonville": "Jacksonville University",
  "jacksonville state": "Jacksonville State University",
  "jacksonville st.": "Jacksonville State University",
  "kennesaw state": "Kennesaw State University",
  "kennesaw st.": "Kennesaw State University",
  "liberty": "Liberty University",
  "lipscomb": "Lipscomb",
  "north alabama": "University of North Alabama",
  "north florida": "University of North Florida",
  "queens": "Queens University of Charlotte",
  "stetson": "Stetson University",
  "west georgia": "University of West Georgia",
  // Southland
  "houston christian": "Houston Christian",
  "incarnate word": "University of the Incarnate Word",
  "lamar": "Lamar University",
  "mcneese state": "McNeese State University",
  "mcneese st.": "McNeese State University",
  "mcneese": "McNeese State University",
  "new orleans": "University of New Orleans",
  "nicholls state": "Nicholls State University",
  "nicholls st.": "Nicholls State University",
  "nicholls": "Nicholls State University",
  "northwestern state": "Northwestern State University",
  "northwestern st.": "Northwestern State University",
  "southeastern louisiana": "Southeastern Louisiana University",
  "southeastern la.": "Southeastern Louisiana University",
  "stephen f. austin": "Stephen F. Austin State University",
  "stephen f. austin state": "Stephen F. Austin State University",
  "sfa": "Stephen F. Austin State University",
  "texas a&m-corpus christi": "Texas A&M-Corpus Christi",
  "a&m-corpus christi": "Texas A&M-Corpus Christi",
  "utrgv": "University of Texas Rio Grande Valley",
  "texas rio grande valley": "University of Texas Rio Grande Valley",
  // NEC
  "central connecticut state": "Central Connecticut State University",
  "central conn. st.": "Central Connecticut State University",
  "coppin state": "Coppin State",
  "coppin st.": "Coppin State",
  "delaware state": "Delaware State University",
  "delaware st.": "Delaware State University",
  "fairleigh dickinson": "Fairleigh Dickinson University",
  "fdu": "Fairleigh Dickinson University",
  "le moyne": "Le Moyne College",
  "liu": "LIU",
  "mercyhurst": "Mercyhurst",
  "new haven": "New Haven",
  "norfolk state": "Norfolk State University",
  "norfolk st.": "Norfolk State University",
  "stonehill": "Stonehill College",
  "wagner": "Wagner College",
  "umes": "UMES",
  // OVC
  "eastern illinois": "Eastern Illinois University",
  "eastern il.": "Eastern Illinois University",
  "lindenwood": "Lindenwood University",
  "little rock": "Little Rock",
  "morehead state": "Morehead State University",
  "morehead st.": "Morehead State University",
  "southeast missouri state": "Southeast Missouri State University",
  "southeast missouri st.": "Southeast Missouri State University",
  "semo": "Southeast Missouri State University",
  "siue": "Southern Illinois University Edwardsville",
  "southern indiana": "University of Southern Indiana",
  "tennessee tech": "Tennessee Tech University",
  "tennessee st.": "Tennessee State University",
  "ut martin": "University of Tennessee at Martin",
  "tennessee-martin": "University of Tennessee at Martin",
  // Summit League
  "north dakota state": "North Dakota State University",
  "north dakota st.": "North Dakota State University",
  "ndsu": "North Dakota State University",
  "northern colorado": "University of Northern Colorado",
  "omaha": "Omaha",
  "oral roberts": "Oral Roberts University",
  "south dakota state": "South Dakota State University",
  "south dakota st.": "South Dakota State University",
  "sdsu (sd)": "South Dakota State University",
  "st. thomas": "University of St. Thomas (Minn.)",
  "western illinois": "Western Illinois University",
  // MAC
  "akron": "University of Akron",
  "ball state": "Ball State University",
  "ball st.": "Ball State University",
  "bowling green": "Bowling Green State University",
  "central michigan": "Central Michigan University",
  "central mich.": "Central Michigan University",
  "eastern michigan": "Eastern Michigan University",
  "eastern mich.": "Eastern Michigan University",
  "kent state": "Kent State University",
  "kent st.": "Kent State University",
  "massachusetts": "University of Massachusetts",
  "umass": "University of Massachusetts",
  "miami (oh)": "Miami University (Ohio)",
  "northern illinois": "Northern Illinois University",
  "northern ill.": "Northern Illinois University",
  "niu": "Northern Illinois University",
  "ohio": "Ohio University",
  "toledo": "University of Toledo",
  "western michigan": "Western Michigan University",
  "western mich.": "Western Michigan University",
  // WAC
  "abilene christian": "Abilene Christian University",
  "california baptist": "California Baptist University",
  "cal baptist": "California Baptist University",
  "sacramento state": "Sacramento State University",
  "sacramento st.": "Sacramento State University",
  "sac state": "Sacramento State University",
  "tarleton state": "Tarleton State University",
  "tarleton st.": "Tarleton State University",
  "ut arlington": "University of Texas-Arlington",
  "texas-arlington": "University of Texas-Arlington",
  "utah tech": "Utah Tech University",
  "utah valley": "Utah Valley University",
  // Big West
  "cal poly": "Cal Poly",
  "cal state fullerton": "Cal State Fullerton",
  "csuf": "Cal State Fullerton",
  "csu fullerton": "Cal State Fullerton",
  "cal state-northridge": "Cal State-Northridge",
  "csun": "Cal State-Northridge",
  "csu bakersfield": "CSU Bakersfield",
  "hawaii": "University of Hawaii",
  "long beach state": "Long Beach State University",
  "long beach st.": "Long Beach State University",
  "uc davis": "UC Davis",
  "uc irvine": "UC Irvine",
  "uc riverside": "UC Riverside",
  "uc san diego": "UC San Diego",
  "uc santa barbara": "UC Santa Barbara",
  "ucsb": "UC Santa Barbara",
  // Horizon League
  "northern kentucky": "Northern Kentucky University",
  "nku": "Northern Kentucky University",
  "oakland": "Oakland University",
  "wright state": "Wright State University",
  "wright st.": "Wright State University",
  "youngstown state": "Youngstown State University",
  "youngstown st.": "Youngstown State University",
  "milwaukee": "University of Wisconsin-Milwaukee",
  "fort wayne": "Purdue Fort Wayne",
  // WCC
  "gonzaga": "Gonzaga University",
  "loyola marymount": "Loyola Marymount University",
  "lmu": "Loyola Marymount University",
  "pacific": "University of the Pacific",
  "pepperdine": "Pepperdine University",
  "portland": "University of Portland",
  "saint mary's": "Saint Mary's College (CA)",
  "st. mary's": "Saint Mary's College (CA)",
  "san diego": "University of San Diego",
  "san francisco": "University of San Francisco",
  "santa clara": "Santa Clara University",
  "seattle": "Seattle",
  // SWAC
  "alabama a&m": "Alabama A&M University",
  "alabama state": "Alabama State University",
  "alabama st.": "Alabama State University",
  "alcorn state": "Alcorn State",
  "alcorn st.": "Alcorn State",
  "arkansas-pine bluff": "University of Arkansas at Pine Bluff",
  "bethune-cookman": "Bethune-Cookman University",
  "florida a&m": "Florida A&M University",
  "grambling state": "Grambling State University",
  "grambling st.": "Grambling State University",
  "grambling": "Grambling State University",
  "jackson state": "Jackson State University",
  "jackson st.": "Jackson State University",
  "mississippi valley state": "Mississippi Valley State University",
  "mississippi val.": "Mississippi Valley State University",
  "prairie view a&m": "Prairie View A&M University",
  "southern": "Southern University",
  "southern university": "Southern University",
  "texas southern": "Texas Southern University",
  // Ivy League
  "brown": "Brown University",
  "columbia": "Columbia University",
  "cornell": "Cornell University",
  "dartmouth": "Dartmouth College",
  "harvard": "Harvard University",
  "pennsylvania": "University of Pennsylvania",
  "penn": "University of Pennsylvania",
  "princeton": "Princeton University",
  "yale": "Yale University",
  // Patriot League
  "army": "Army West Point",
  "army west point": "Army West Point",
  "bucknell": "Bucknell University",
  "holy cross": "College of the Holy Cross",
  "lafayette": "Lafayette College",
  "lehigh": "Lehigh",
  "navy": "U.S. Naval Academy",
  // CUSA
  "dallas baptist": "Dallas Baptist",
  "dbu": "Dallas Baptist",
  "florida international": "Florida International University",
  "fiu": "Florida International University",
  "louisiana tech": "Louisiana Tech University",
  "la tech": "Louisiana Tech University",
  "middle tennessee state": "Middle Tennessee State University",
  "middle tennessee st.": "Middle Tennessee State University",
  "middle tennessee": "Middle Tennessee State University",
  "mtsu": "Middle Tennessee State University",
  "new mexico state": "New Mexico State University",
  "new mexico st.": "New Mexico State University",
  "sam houston state": "Sam Houston State University",
  "sam houston st.": "Sam Houston State University",
  "sam houston": "Sam Houston State University",
  "western kentucky": "Western Kentucky University",
  "wku": "Western Kentucky University",
  // America East
  "albany": "University at Albany",
  "binghamton": "Binghamton University",
  "bryant": "Bryant University",
  "maine": "University of Maine",
  "njit": "New Jersey Institute of Technology",
  "umass lowell": "UMass Lowell",
  "umbc": "UMBC",
  // Misc / additional aliases
  "new mexico state": "New Mexico State University",
  "csu northridge": "Cal State-Northridge",
  "cal st. fullerton": "Cal State Fullerton",
  "eastern ill.": "Eastern Illinois University",
  "eastern ky.": "Eastern Kentucky University",
  "fort wayne": "Purdue Fort Wayne",
  "georgia st.": "Georgia State University",
  "lmu (ca)": "Loyola Marymount University",
  "maryland eastern shore": "UMES",
  "n.c. a&t": "North Carolina A&T State University",
  "n.c. a&amp;t": "North Carolina A&T State University",
  "north ala.": "University of North Alabama",
  "northern colo.": "University of Northern Colorado",
  "northern ky.": "Northern Kentucky University",
  "siu edwardsville": "Southern Illinois University Edwardsville",
  "southern ill.": "Southern Illinois University",
  "saint mary's (ca)": "Saint Mary's College (CA)",
  "st. john's (ny)": "St. John's University (NY)",
  "texas a&m": "Texas A&M University",
  "texas a&amp;m": "Texas A&M University",
  "ut rio grande valley": "University of Texas Rio Grande Valley",
  "western ky.": "Western Kentucky University",
  "william & mary": "College of William & Mary",
  "william &amp; mary": "College of William & Mary",
  "university of arkansas- pine bluff": "University of Arkansas at Pine Bluff",
  "university of arkansas-pine bluff": "University of Arkansas at Pine Bluff",
  "arkansas pine bluff": "University of Arkansas at Pine Bluff",
  "uapb": "University of Arkansas at Pine Bluff",
  "prairie view a&amp;m": "Prairie View A&M University",
  "alabama a&amp;m": "Alabama A&M University",
  "florida a&amp;m": "Florida A&M University",
  "texas a&amp;m-corpus christi": "Texas A&M-Corpus Christi",
  "north carolina a&amp;t": "North Carolina A&T State University",
  "gardner-webb": "Gardner Webb University",
  "usc upstate": "University of South Carolina Upstate",
  "southeastern la.": "Southeastern Louisiana University",
  "northwestern st.": "Northwestern State University",
  "central conn. st.": "Central Connecticut State University",
  "central mich.": "Central Michigan University",
  "eastern mich.": "Eastern Michigan University",
  "southern miss.": "Southern Mississippi",
  "tennessee state": "Tennessee State University",
  "tennessee st.": "Tennessee State University",
  "delaware state": "Delaware State University",
  "delaware st.": "Delaware State University",
  "miami (fl)": "University of Miami",
  "southern california": "University of Southern California",
  "col. of charleston": "College of Charleston",
  "liu brooklyn": "LIU",
  "seattle u": "Seattle",
  "university of arkansas little rock": "Little Rock",
  "wichita state university": "Wichita State ",
};

interface FilePlayer {
  firstName: string;
  lastName: string;
  team2025: string;
  position: string;
  batsHand: string;
  throwsHand: string;
  age: number;
  ab: number;
  ba: number;
  obp: number;
  slg: number;
  ops: number;
  iso: number;
}

function parseMarkdownTable(raw: string): FilePlayer[] {
  const lines = raw.split("\n").filter(l => l.trim().startsWith("|") && !l.includes("---"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").map(s => s.trim()).filter(Boolean);
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const firstNameIdx = idx("playerfirstname");
  const lastNameIdx = idx("player");
  const teamIdx = idx("newestteamlocation");
  const posIdx = idx("pos");
  const batsIdx = idx("batshand");
  const throwsIdx = idx("throwshand");
  const ageIdx = idx("age");
  const abIdx = idx("ab");
  const baIdx = idx("ba");
  const obpIdx = idx("obp");
  const slgIdx = idx("slg");
  const opsIdx = idx("ops");
  const isoIdx = idx("iso");

  if (firstNameIdx < 0 || lastNameIdx < 0 || teamIdx < 0) throw new Error("Missing columns");
  const players: FilePlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|").map(s => s.trim()).filter(Boolean);
    if (cols.length < Math.max(firstNameIdx, lastNameIdx, teamIdx) + 1) continue;
    const firstName = cols[firstNameIdx];
    const lastName = cols[lastNameIdx];
    const team2025 = cols[teamIdx];
    if (!firstName || !lastName || !team2025) continue;
    players.push({
      firstName,
      lastName,
      team2025,
      position: posIdx >= 0 ? cols[posIdx] : "",
      batsHand: batsIdx >= 0 ? cols[batsIdx] : "",
      throwsHand: throwsIdx >= 0 ? cols[throwsIdx] : "",
      age: ageIdx >= 0 ? parseInt(cols[ageIdx]) || 0 : 0,
      ab: abIdx >= 0 ? parseInt(cols[abIdx]) || 0 : 0,
      ba: baIdx >= 0 ? parseFloat(cols[baIdx]) || 0 : 0,
      obp: obpIdx >= 0 ? parseFloat(cols[obpIdx]) || 0 : 0,
      slg: slgIdx >= 0 ? parseFloat(cols[slgIdx]) || 0 : 0,
      ops: opsIdx >= 0 ? parseFloat(cols[opsIdx]) || 0 : 0,
      iso: isoIdx >= 0 ? parseFloat(cols[isoIdx]) || 0 : 0,
    });
  }
  return players;
}

function resolveTeamName(playerTeam: string, teamMap: Map<string, string>): string | null {
  if (!playerTeam) return null;
  // Decode HTML entities that may come from scraped data
  const decoded = playerTeam.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const lower = decoded.toLowerCase().trim();
  // Direct match in teams table
  if (teamMap.has(lower)) return teamMap.get(lower)!;
  // Check alias map
  const alias = TEAM_ALIASES[lower];
  if (alias && teamMap.has(alias.toLowerCase())) {
    return teamMap.get(alias.toLowerCase())!;
  }
  // Also try the original (non-decoded) version in aliases
  const origLower = playerTeam.toLowerCase().trim();
  if (origLower !== lower) {
    const alias2 = TEAM_ALIASES[origLower];
    if (alias2 && teamMap.has(alias2.toLowerCase())) {
      return teamMap.get(alias2.toLowerCase())!;
    }
  }
  // No fuzzy matching - only explicit aliases to avoid bad matches
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "fix_conferences";
    const dryRun = body.dryRun === true;

    if (action === "fix_conferences") {
      // Load all teams with conferences
      let allTeams: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("teams").select("name, conference").range(from, from + PAGE - 1);
        if (error) throw error;
        allTeams = allTeams.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      // Build map: lowercase team name → conference
      const teamMap = new Map<string, string>();
      for (const t of allTeams) {
        if (t.conference) teamMap.set(t.name.toLowerCase(), t.conference);
      }

      // Load all players
      let allPlayers: any[] = [];
      from = 0;
      while (true) {
        const { data, error } = await db.from("players").select("id, team, from_team, conference").range(from, from + PAGE - 1);
        if (error) throw error;
        allPlayers = allPlayers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`Loaded ${allTeams.length} teams, ${allPlayers.length} players`);

      let fixed = 0;
      let unresolved = 0;
      const actions: string[] = [];
      const unresolvedTeams = new Set<string>();
      const updates: Promise<any>[] = [];

      for (const p of allPlayers) {
        if (!p.team) continue;
        const resolvedConf = resolveTeamName(p.team, teamMap);
        if (!resolvedConf) {
          unresolved++;
          unresolvedTeams.add(p.team);
          continue;
        }
        if (p.conference !== resolvedConf) {
          fixed++;
          actions.push(`FIX: ${p.team} ${p.conference || "NULL"} → ${resolvedConf}`);
          if (!dryRun) {
            updates.push(db.from("players").update({ conference: resolvedConf }).eq("id", p.id));
            if (updates.length >= 50) {
              await Promise.all(updates.splice(0, 50));
            }
          }
        }
      }
      if (updates.length > 0) await Promise.all(updates);

      return new Response(JSON.stringify({
        success: true, dryRun, fixed, unresolved,
        unresolvedTeams: [...unresolvedTeams].sort(),
        actions: actions.slice(0, 100),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "populate_stats") {
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-transfer-stats.txt");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const filePlayers = parseMarkdownTable(rawText);
      console.log(`Parsed ${filePlayers.length} players from file`);

      let allTransfers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players")
          .select("id, first_name, last_name, team, from_team, conference")
          .eq("transfer_portal", true)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allTransfers = allTransfers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`Found ${allTransfers.length} transfer portal players`);

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allTransfers) {
        const key = normalize(p.first_name) + "|" + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }

      let matched = 0;
      let skipped = 0;
      const actions: string[] = [];
      const updates: Promise<any>[] = [];

      for (const fp of filePlayers) {
        const key = normalize(fp.firstName) + "|" + normalize(fp.lastName);
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) { skipped++; continue; }
        const player = matches[0];

        matched++;
        actions.push(`MATCH: ${fp.firstName} ${fp.lastName} → BA:${fp.ba} OBP:${fp.obp} SLG:${fp.slg} OPS:${fp.ops}`);

        if (!dryRun) {
          const playerUpdate: any = {};
          if (fp.batsHand && fp.batsHand !== "0") playerUpdate.bats_hand = fp.batsHand;
          if (fp.throwsHand && fp.throwsHand !== "0") playerUpdate.throws_hand = fp.throwsHand;
          if (fp.age > 0) playerUpdate.age = fp.age;
          if (fp.position) playerUpdate.position = fp.position;
          if (Object.keys(playerUpdate).length > 0) {
            updates.push(db.from("players").update(playerUpdate).eq("id", player.id));
          }

          updates.push(
            db.from("player_predictions").update({
              from_avg: fp.ba,
              from_obp: fp.obp,
              from_slg: fp.slg,
              p_avg: fp.ba,
              p_obp: fp.obp,
              p_slg: fp.slg,
              p_ops: fp.ops,
              p_iso: fp.iso,
            })
            .eq("player_id", player.id)
            .eq("model_type", "transfer")
            .eq("season", 2025)
            .eq("status", "active")
          );

          if (updates.length >= 50) {
            await Promise.all(updates.splice(0, 50));
          }
        }
      }

      if (updates.length > 0) await Promise.all(updates);

      return new Response(JSON.stringify({ success: true, dryRun, matched, skipped, total: filePlayers.length, actions: actions.slice(0, 50) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "populate_scouting") {
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-power-ratings.csv");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const lines = rawText.split("\n");

      interface ScoutRow { name: string; variant: string; evScore: number; barrelScore: number; whiffScore: number; chaseScore: number; offPwrRating: number; pwrRating: number; }
      const scoutRows: ScoutRow[] = [];
      let pastMin = false;
      for (const line of lines) {
        const cols = line.split(",").map(s => s.trim());
        if (!cols[0]) continue;
        if (cols[0] === "Min") { pastMin = true; continue; }
        if (!pastMin) continue;
        if (cols[0].startsWith("25 ") || cols[0] === "Max" || cols[0] === "NCAA") continue;
        const name = cols[0];
        const evScore = parseFloat(cols[5]) || 0;
        const barrelScore = parseFloat(cols[6]) || 0;
        const whiffScore = parseFloat(cols[7]) || 0;
        const chaseScore = parseFloat(cols[8]) || 0;
        const offPwrRating = parseFloat(cols[9]) || 0;
        const pwrRating = parseFloat(cols[10]) || 0;
        if (evScore === 0 && barrelScore <= 1 && offPwrRating === 0) continue;
        const isXstats = name.toLowerCase().endsWith(" xstats");
        const cleanName = isXstats ? name.replace(/ xstats$/i, "") : name;
        scoutRows.push({ name: cleanName, variant: isXstats ? "xstats" : "regular", evScore, barrelScore, whiffScore, chaseScore, offPwrRating, pwrRating });
      }
      console.log(`Parsed ${scoutRows.length} scouting rows from CSV`);

      let allTransfers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players")
          .select("id, first_name, last_name")
          .eq("transfer_portal", true)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allTransfers = allTransfers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`Found ${allTransfers.length} transfer portal players`);

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allTransfers) {
        const key = normalize(p.first_name) + " " + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }

      let matched = 0;
      let skipped = 0;
      const actions: string[] = [];
      const updates: Promise<any>[] = [];

      for (const sr of scoutRows) {
        const nameParts = sr.name.trim().split(/\s+/);
        if (nameParts.length < 2) { skipped++; continue; }
        const firstName = normalize(nameParts[0]);
        const lastName = normalize(nameParts.slice(1).join(""));
        const key = firstName + " " + lastName;
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) { skipped++; continue; }
        const player = matches[0];

        matched++;
        actions.push(`MATCH: ${sr.name} (${sr.variant}) → EV:${sr.evScore} BBL:${sr.barrelScore} WH:${sr.whiffScore} CH:${sr.chaseScore} OPR:${sr.offPwrRating} PWR+:${sr.pwrRating}`);

        if (!dryRun) {
          updates.push(
            db.from("player_predictions").update({
              ev_score: sr.evScore,
              barrel_score: sr.barrelScore,
              whiff_score: sr.whiffScore,
              chase_score: sr.chaseScore,
              power_rating_score: sr.offPwrRating,
              power_rating_plus: sr.pwrRating,
            })
            .eq("player_id", player.id)
            .eq("model_type", "transfer")
            .eq("season", 2025)
            .eq("variant", sr.variant)
            .eq("status", "active")
          );

          if (updates.length >= 50) {
            await Promise.all(updates.splice(0, 50));
          }
        }
      }

      if (updates.length > 0) await Promise.all(updates);

      return new Response(JSON.stringify({ success: true, dryRun, matched, skipped, total: scoutRows.length, actions: actions.slice(0, 50) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "flag_unflagged") {
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-teams-parsed.txt");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const filePlayers = parseMarkdownTable(rawText);

      let allPlayers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players").select("id, first_name, last_name, team, conference, from_team, transfer_portal")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allPlayers = allPlayers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }

      let allTeams: any[] = [];
      from = 0;
      while (true) {
        const { data, error } = await db.from("teams").select("name, conference").range(from, from + PAGE - 1);
        if (error) throw error;
        allTeams = allTeams.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      const teamConfMap: Record<string, string> = {};
      for (const t of allTeams) { if (t.conference) teamConfMap[t.name.toLowerCase()] = t.conference; }

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allPlayers) {
        const key = normalize(p.first_name) + "|" + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }
      const normalizeTeam = (t: string) => {
        return t.toLowerCase().replace(/university|college|of|the/gi, "").replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
      };

      let flagged = 0;
      const actions: string[] = [];

      for (const fp of filePlayers) {
        const key = normalize(fp.firstName) + "|" + normalize(fp.lastName);
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) continue;
        const player = matches[0];
        if (player.transfer_portal) continue;

        const fileTeamNorm = normalizeTeam(fp.team2025);
        const currentTeamNorm = normalizeTeam(player.team || "");
        const sameTeam = currentTeamNorm === fileTeamNorm || currentTeamNorm.includes(fileTeamNorm) || fileTeamNorm.includes(currentTeamNorm);

        if (!sameTeam && player.team && fp.team2025) {
          flagged++;
          const destConf = teamConfMap[player.team?.toLowerCase() || ""] || player.conference;
          actions.push(`FLAG: ${fp.firstName} ${fp.lastName} from ${fp.team2025} → ${player.team} (conf: ${destConf})`);
          
          if (!dryRun) {
            await db.from("players").update({
              transfer_portal: true,
              from_team: fp.team2025,
              conference: destConf,
            }).eq("id", player.id);

            await db.from("player_predictions")
              .update({ status: "departed" })
              .eq("player_id", player.id)
              .eq("model_type", "returner")
              .eq("season", 2025);

            const { data: existing } = await db.from("player_predictions")
              .select("id")
              .eq("player_id", player.id)
              .eq("model_type", "transfer")
              .eq("season", 2025)
              .limit(1);

            if (!existing?.length) {
              await db.from("player_predictions").insert({
                player_id: player.id,
                model_type: "transfer",
                season: 2025,
                variant: "regular",
                status: "active",
              });
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true, dryRun, flagged, actions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
