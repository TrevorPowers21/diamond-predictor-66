/**
 * Per-school primary + secondary color seeds for the AdminTeams branding
 * auto-fill. Keyed by lowercased Teams Table `full_name` so a superadmin
 * onboarding a team only has to pick the linked D1 program — name, mascot
 * (from Teams Table), and these colors all pre-populate.
 *
 * Schools not in this map fall back to the form's default color picker.
 * Add a row whenever you onboard a customer not already covered. This is
 * intentionally a code constant rather than a DB table — the dataset is
 * small, mostly static, and a one-line edit beats running a migration.
 */
export type SchoolColors = {
  primary: string;
  secondary: string;
};

const SCHOOL_COLORS: Record<string, SchoolColors> = {
  // SEC
  "alabama crimson tide": { primary: "#9E1B32", secondary: "#FFFFFF" },
  "arkansas razorbacks": { primary: "#9D2235", secondary: "#FFFFFF" },
  "auburn tigers": { primary: "#0C2340", secondary: "#E87722" },
  "florida gators": { primary: "#0021A5", secondary: "#FA4616" },
  "georgia bulldogs": { primary: "#BA0C2F", secondary: "#000000" },
  "kentucky wildcats": { primary: "#0033A0", secondary: "#FFFFFF" },
  "lsu tigers": { primary: "#461D7C", secondary: "#FDD023" },
  "mississippi state bulldogs": { primary: "#5D1725", secondary: "#FFFFFF" },
  "missouri tigers": { primary: "#F1B82D", secondary: "#000000" },
  "ole miss rebels": { primary: "#14213D", secondary: "#CE1126" },
  "oklahoma sooners": { primary: "#841617", secondary: "#FDF9D8" },
  "south carolina gamecocks": { primary: "#73000A", secondary: "#000000" },
  "tennessee volunteers": { primary: "#FF8200", secondary: "#FFFFFF" },
  "texas longhorns": { primary: "#BF5700", secondary: "#FFFFFF" },
  "texas a&m aggies": { primary: "#500000", secondary: "#FFFFFF" },
  "vanderbilt commodores": { primary: "#000000", secondary: "#866D4B" },

  // Big 12
  "arizona wildcats": { primary: "#0C234B", secondary: "#AB0520" },
  "arizona state sun devils": { primary: "#8C1D40", secondary: "#FFC627" },
  "baylor bears": { primary: "#003015", secondary: "#FFB81C" },
  "byu cougars": { primary: "#002E5D", secondary: "#FFFFFF" },
  "cincinnati bearcats": { primary: "#E00122", secondary: "#000000" },
  "colorado buffaloes": { primary: "#CFB87C", secondary: "#000000" },
  "houston cougars": { primary: "#C8102E", secondary: "#FFFFFF" },
  "iowa state cyclones": { primary: "#C8102E", secondary: "#F1BE48" },
  "kansas jayhawks": { primary: "#0051BA", secondary: "#E8000D" },
  "kansas state wildcats": { primary: "#512888", secondary: "#FFFFFF" },
  "oklahoma state cowboys": { primary: "#FF7300", secondary: "#000000" },
  "tcu horned frogs": { primary: "#4D1979", secondary: "#A3A9AC" },
  "texas tech red raiders": { primary: "#CC0000", secondary: "#000000" },
  "ucf knights": { primary: "#000000", secondary: "#FFC904" },
  "utah utes": { primary: "#CC0000", secondary: "#FFFFFF" },
  "west virginia mountaineers": { primary: "#002855", secondary: "#EAAA00" },

  // ACC
  "boston college eagles": { primary: "#8C2232", secondary: "#BC9B6A" },
  "california golden bears": { primary: "#003262", secondary: "#FDB515" },
  "clemson tigers": { primary: "#F66733", secondary: "#522D80" },
  "duke blue devils": { primary: "#012169", secondary: "#FFFFFF" },
  "florida state seminoles": { primary: "#782F40", secondary: "#CEB888" },
  "georgia tech yellow jackets": { primary: "#B3A369", secondary: "#003057" },
  "louisville cardinals": { primary: "#AD0000", secondary: "#FFFFFF" },
  "miami hurricanes": { primary: "#F47321", secondary: "#005030" },
  "nc state wolfpack": { primary: "#CC0000", secondary: "#FFFFFF" },
  "north carolina tar heels": { primary: "#7BAFD4", secondary: "#FFFFFF" },
  "notre dame fighting irish": { primary: "#0C2340", secondary: "#C99700" },
  "pittsburgh panthers": { primary: "#003594", secondary: "#FFB81C" },
  "smu mustangs": { primary: "#0033A0", secondary: "#C8102E" },
  "stanford cardinal": { primary: "#8C1515", secondary: "#FFFFFF" },
  "syracuse orange": { primary: "#F76900", secondary: "#000E54" },
  "virginia cavaliers": { primary: "#232D4B", secondary: "#F84C1E" },
  "virginia tech hokies": { primary: "#861F41", secondary: "#E5751F" },
  "wake forest demon deacons": { primary: "#9E7E38", secondary: "#000000" },

  // Big Ten
  "illinois fighting illini": { primary: "#13294B", secondary: "#E84A27" },
  "indiana hoosiers": { primary: "#990000", secondary: "#EEEDEB" },
  "iowa hawkeyes": { primary: "#000000", secondary: "#FFCD00" },
  "maryland terrapins": { primary: "#E03A3E", secondary: "#FFD520" },
  "michigan wolverines": { primary: "#00274C", secondary: "#FFCB05" },
  "michigan state spartans": { primary: "#18453B", secondary: "#FFFFFF" },
  "minnesota golden gophers": { primary: "#7A0019", secondary: "#FFCC33" },
  "nebraska cornhuskers": { primary: "#E41C38", secondary: "#FFFFFF" },
  "northwestern wildcats": { primary: "#4E2A84", secondary: "#FFFFFF" },
  "ohio state buckeyes": { primary: "#BB0000", secondary: "#666666" },
  "oregon ducks": { primary: "#154733", secondary: "#FEE123" },
  "penn state nittany lions": { primary: "#041E42", secondary: "#FFFFFF" },
  "purdue boilermakers": { primary: "#CFB991", secondary: "#000000" },
  "rutgers scarlet knights": { primary: "#CC0033", secondary: "#000000" },
  "ucla bruins": { primary: "#2774AE", secondary: "#FFD100" },
  "usc trojans": { primary: "#990000", secondary: "#FFC72C" },
  "washington huskies": { primary: "#4B2E83", secondary: "#B7A57A" },
  "wisconsin badgers": { primary: "#C5050C", secondary: "#FFFFFF" },
};

const normalize = (name: string | null | undefined): string =>
  (name ?? "").toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Looks up colors by Teams Table `full_name`. Returns null when no match
 * — the form should fall back to its default color picker so the user can
 * pick manually.
 */
export function lookupSchoolColors(fullName: string | null | undefined): SchoolColors | null {
  return SCHOOL_COLORS[normalize(fullName)] ?? null;
}
