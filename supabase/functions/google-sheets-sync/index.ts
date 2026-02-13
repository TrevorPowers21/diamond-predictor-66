import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function toBase64Url(input: string | Uint8Array): string {
  let b64: string;
  if (typeof input === "string") {
    b64 = btoa(unescape(encodeURIComponent(input)));
  } else {
    let binary = "";
    for (let i = 0; i < input.length; i++) {
      binary += String.fromCharCode(input[i]);
    }
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Google Auth ──────────────────────────────────────────────────────
async function getGoogleAccessToken(): Promise<string> {
  const jsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!jsonStr) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON secret is not set");

  const sa = JSON.parse(jsonStr);
  const email = sa.client_email;
  const rawKey = sa.private_key;

  if (!email || !rawKey) throw new Error("Invalid service account JSON: missing client_email or private_key");

  // Build JWT
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );

  const unsignedToken = `${header}.${payload}`;

  // Import the private key — handle both literal \n and real newlines
  const pem = rawKey
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/[\n\r\s]/g, "");

  // Decode base64 PEM to binary using Deno std
  const binaryDer = decodeBase64(pem);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = toBase64Url(new Uint8Array(signature));

  const jwt = `${header}.${payload}.${sig}`;

  // Exchange for access token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ── Sheets helpers ───────────────────────────────────────────────────
async function readSheet(
  token: string,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Read sheet failed: ${await res.text()}`);
  const data = await res.json();
  return data.values ?? [];
}

async function writeSheet(
  token: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Write sheet failed: ${await res.text()}`);
}

// ── Column mappings ──────────────────────────────────────────────────
const PLAYER_COLUMNS = [
  "first_name", "last_name", "position", "team", "conference",
  "class_year", "handedness", "height_inches", "weight",
  "home_state", "high_school", "transfer_portal", "portal_entry_date", "notes",
];

const STATS_COLUMNS = [
  "first_name", "last_name", "season", "games", "at_bats", "hits",
  "doubles", "triples", "home_runs", "rbi", "runs", "walks",
  "strikeouts", "stolen_bases", "caught_stealing", "hit_by_pitch",
  "sac_flies", "batting_avg", "on_base_pct", "slugging_pct", "ops",
  "innings_pitched", "earned_runs", "era", "whip", "hits_allowed",
  "pitch_walks", "pitch_strikeouts", "wins", "losses", "saves",
];

// ── Main handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user & role
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    // Use service role for DB operations
    const db = createClient(supabaseUrl, supabaseServiceKey);

    // Check role
    const { data: hasRole } = await db.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    const { data: hasStaff } = await db.rpc("has_role", {
      _user_id: user.id,
      _role: "staff",
    });
    if (!hasRole && !hasStaff) throw new Error("Insufficient permissions");

    const body = await req.json();
    const { action, spreadsheet_id, players_range, stats_range } = body;

    if (!spreadsheet_id) throw new Error("spreadsheet_id is required");

    const token = await getGoogleAccessToken();
    let result: Record<string, unknown> = {};

    if (action === "discover") {
      result = await discoverSheets(token, spreadsheet_id);
    } else if (action === "read_raw") {
      const range = body.range;
      if (!range) throw new Error("range is required for read_raw");
      const rows = await readSheet(token, spreadsheet_id, range);
      result = { rows: rows.slice(0, body.max_rows || 20) };
    } else if (action === "import_players") {
      result = await importPlayers(db, token, spreadsheet_id, players_range || "Players!A:N");
    } else if (action === "import_stats") {
      result = await importStats(db, token, spreadsheet_id, stats_range || "Stats!A:AE");
    } else if (action === "export_players") {
      result = await exportPlayers(db, token, spreadsheet_id, players_range || "Players!A:N");
    } else if (action === "export_stats") {
      result = await exportStats(db, token, spreadsheet_id, stats_range || "Stats!A:AE");
    } else if (action === "import_all") {
      const p = await importPlayers(db, token, spreadsheet_id, players_range || "Players!A:N");
      const s = await importStats(db, token, spreadsheet_id, stats_range || "Stats!A:AE");
      result = { players: p, stats: s };
    } else if (action === "export_all") {
      const p = await exportPlayers(db, token, spreadsheet_id, players_range || "Players!A:N");
      const s = await exportStats(db, token, spreadsheet_id, stats_range || "Stats!A:AE");
      result = { players: p, stats: s };
    } else if (action === "import_returner_predictions") {
      result = await importReturnerPredictions(db, token, spreadsheet_id, body.tab || "Returner Prediction Equation", body.season || 2025);
    } else if (action === "import_transfer_predictions") {
      result = await importTransferPredictions(db, token, spreadsheet_id, body.tab || "Transfer Prediction Equation", body.season || 2025);
    } else if (action === "import_predictions_all") {
      const r = await importReturnerPredictions(db, token, spreadsheet_id, body.returner_tab || "Returner Prediction Equation", body.season || 2025);
      const t = await importTransferPredictions(db, token, spreadsheet_id, body.transfer_tab || "Transfer Prediction Equation", body.season || 2025);
      result = { returner: r, transfer: t };
    } else if (action === "import_conference_stats") {
      result = await importConferenceStats(db, token, spreadsheet_id, body.tab || "'25 Conference Stats+", body.season || 2025);
    } else if (action === "import_park_factors") {
      result = await importParkFactors(db, token, spreadsheet_id, body.tab || "Park Factor+ Full Season", body.season || 2025);
    } else if (action === "import_nil_transfer") {
      result = await importNilValuation(db, token, spreadsheet_id, body.tab || "Transfer NIL Valuation", "transfer", body.season || 2025);
    } else if (action === "import_nil_returner") {
      result = await importNilValuation(db, token, spreadsheet_id, body.tab || "Returner NIL Valuation", "returner", body.season || 2025);
    } else if (action === "import_nil_tcu") {
      result = await importTcuValuation(db, token, spreadsheet_id, body.tab || "TCU Player Valuation", body.season || 2025);
    } else if (action === "import_nil_all") {
      const t = await importNilValuation(db, token, spreadsheet_id, body.transfer_tab || "Transfer NIL Valuation", "transfer", body.season || 2025);
      const r = await importNilValuation(db, token, spreadsheet_id, body.returner_tab || "Returner NIL Valuation", "returner", body.season || 2025);
      const c = await importTcuValuation(db, token, spreadsheet_id, body.tcu_tab || "TCU Player Valuation", body.season || 2025);
      result = { transfer_nil: t, returner_nil: r, tcu_nil: c };
    } else if (action === "import_returner_power_rating") {
      result = await importOffensivePowerRating(db, token, spreadsheet_id, body.tab || "Returner Offensive Power Rating", "returner", body.season || 2025);
    } else if (action === "import_transfer_power_rating") {
      result = await importOffensivePowerRating(db, token, spreadsheet_id, body.tab || "Transfer Offensive Power Rating", "transfer", body.season || 2025);
    } else if (action === "import_power_rating_all") {
      const r = await importOffensivePowerRating(db, token, spreadsheet_id, body.returner_tab || "Returner Offensive Power Rating", "returner", body.season || 2025);
      const t = await importOffensivePowerRating(db, token, spreadsheet_id, body.transfer_tab || "Transfer Offensive Power Rating", "transfer", body.season || 2025);
      result = { returner_power: r, transfer_power: t };
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Sync error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Import players ───────────────────────────────────────────────────
async function importPlayers(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  range: string
) {
  const rows = await readSheet(token, spreadsheetId, range);
  if (rows.length < 2) return { imported: 0, message: "No data rows found" };

  const headers = rows[0].map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (PLAYER_COLUMNS.includes(h) && row[idx] !== undefined && row[idx] !== "") {
        let val: unknown = row[idx];
        if (h === "height_inches" || h === "weight") val = parseInt(row[idx]) || null;
        if (h === "transfer_portal") val = row[idx].toLowerCase() === "true" || row[idx] === "1";
        record[h] = val;
      }
    });

    if (!record.first_name || !record.last_name) {
      skipped++;
      continue;
    }

    // Upsert by first_name + last_name + team
    const { data: existing } = await db
      .from("players")
      .select("id")
      .eq("first_name", record.first_name as string)
      .eq("last_name", record.last_name as string)
      .maybeSingle();

    if (existing) {
      await db.from("players").update(record).eq("id", existing.id);
    } else {
      await db.from("players").insert(record);
    }
    imported++;
  }

  return { imported, skipped };
}

// ── Import stats ─────────────────────────────────────────────────────
async function importStats(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  range: string
) {
  const rows = await readSheet(token, spreadsheetId, range);
  if (rows.length < 2) return { imported: 0, message: "No data rows found" };

  const headers = rows[0].map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const record: Record<string, unknown> = {};
    let firstName = "";
    let lastName = "";

    headers.forEach((h, idx) => {
      if (row[idx] === undefined || row[idx] === "") return;
      if (h === "first_name") { firstName = row[idx]; return; }
      if (h === "last_name") { lastName = row[idx]; return; }
      if (STATS_COLUMNS.includes(h)) {
        const numericFields = STATS_COLUMNS.filter((c) => c !== "first_name" && c !== "last_name");
        if (numericFields.includes(h)) {
          record[h] = parseFloat(row[idx]) || 0;
        } else {
          record[h] = row[idx];
        }
      }
    });

    if (!firstName || !lastName || !record.season) {
      skipped++;
      continue;
    }

    // Look up player
    const { data: player } = await db
      .from("players")
      .select("id")
      .eq("first_name", firstName)
      .eq("last_name", lastName)
      .maybeSingle();

    if (!player) {
      skipped++;
      continue;
    }

    record.player_id = player.id;

    // Upsert by player_id + season
    const { data: existing } = await db
      .from("season_stats")
      .select("id")
      .eq("player_id", player.id)
      .eq("season", record.season as number)
      .maybeSingle();

    if (existing) {
      await db.from("season_stats").update(record).eq("id", existing.id);
    } else {
      await db.from("season_stats").insert(record);
    }
    imported++;
  }

  return { imported, skipped };
}

// ── Export players ───────────────────────────────────────────────────
async function exportPlayers(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  range: string
) {
  const { data: players, error } = await db
    .from("players")
    .select("*")
    .order("last_name");

  if (error) throw error;
  if (!players?.length) return { exported: 0 };

  const header = PLAYER_COLUMNS;
  const rows = players.map((p: Record<string, unknown>) =>
    header.map((col) => String(p[col] ?? ""))
  );

  await writeSheet(token, spreadsheetId, range, [header, ...rows]);
  return { exported: players.length };
}

// ── Export stats ─────────────────────────────────────────────────────
async function exportStats(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  range: string
) {
  const { data: stats, error } = await db
    .from("season_stats")
    .select("*, players!inner(first_name, last_name)")
    .order("season", { ascending: false });

  if (error) throw error;
  if (!stats?.length) return { exported: 0 };

  const header = STATS_COLUMNS;
  const rows = stats.map((s: Record<string, unknown>) => {
    const player = s.players as Record<string, string>;
    return header.map((col) => {
      if (col === "first_name") return player.first_name ?? "";
      if (col === "last_name") return player.last_name ?? "";
      return String((s as Record<string, unknown>)[col] ?? "");
    });
  });

  await writeSheet(token, spreadsheetId, range, [header, ...rows]);
  return { exported: stats.length };
}

// ── Discover sheets ─────────────────────────────────────────────────
async function discoverSheets(
  token: string,
  spreadsheetId: string
) {
  // Get spreadsheet metadata (sheet names)
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Failed to read spreadsheet: ${await metaRes.text()}`);
  const meta = await metaRes.json();

  const sheetNames: string[] = meta.sheets.map(
    (s: { properties: { title: string } }) => s.properties.title
  );

  // Read first 2 rows (header + sample) from each sheet
  const sheets: Record<string, { headers: string[]; sample: string[] }> = {};
  for (const name of sheetNames) {
    try {
      const rows = await readSheet(token, spreadsheetId, `'${name}'!1:2`);
      sheets[name] = {
        headers: rows[0] ?? [],
        sample: rows[1] ?? [],
      };
    } catch {
      sheets[name] = { headers: [], sample: [] };
    }
  }

  return { sheets };
}

// ── Helper: find or create player by name ────────────────────────────
async function findOrCreatePlayer(
  db: ReturnType<typeof createClient>,
  rawName: string
): Promise<{ id: string; cleanName: string } | null> {
  let cleanName = rawName.replace(/\s*xstats$/i, "").replace(/\s*\(.*\)$/, "").trim();
  if (!cleanName) return null;

  const parts = cleanName.split(/\s+/);
  if (parts.length < 2) return null;

  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");

  const { data: existing } = await db
    .from("players")
    .select("id")
    .eq("first_name", firstName)
    .eq("last_name", lastName)
    .maybeSingle();

  if (existing) return { id: existing.id, cleanName };

  const { data: created, error } = await db
    .from("players")
    .insert({ first_name: firstName, last_name: lastName })
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to create player ${cleanName}:`, error.message);
    return null;
  }

  return { id: created.id, cleanName };
}

// ── Helper: bulk load all players into a name→id map ─────────────────
async function loadPlayerCache(db: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await db
      .from("players")
      .select("id, first_name, last_name")
      .range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const p of data) {
      cache.set(`${p.first_name}|||${p.last_name}`.toLowerCase(), p.id);
    }
    offset += pageSize;
    if (data.length < pageSize) break;
  }
  return cache;
}

// ── Helper: resolve player from cache or create ──────────────────────
async function resolvePlayer(
  db: ReturnType<typeof createClient>,
  rawName: string,
  cache: Map<string, string>
): Promise<{ id: string; variant: string } | null> {
  let cleanName = rawName.replace(/\s*xstats$/i, "").replace(/\s*\(.*\)$/, "").trim();
  if (!cleanName) return null;

  const parts = cleanName.split(/\s+/);
  if (parts.length < 2) return null;

  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  const key = `${firstName}|||${lastName}`.toLowerCase();
  const variant = /xstats$/i.test(rawName) ? "xstats" : "regular";

  let id = cache.get(key);
  if (id) return { id, variant };

  // Create player if not in cache
  const { data: created, error } = await db
    .from("players")
    .insert({ first_name: firstName, last_name: lastName })
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to create player ${cleanName}:`, error.message);
    return null;
  }

  cache.set(key, created.id);
  return { id: created.id, variant };
}

// ── Import returner predictions ──────────────────────────────────────
async function importReturnerPredictions(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:V2500`);
  if (rows.length < 5) return { imported: 0, message: "Not enough rows" };

  // Row 3 (index 2) has the config weights
  const configRow = rows[2];
  // Weights are at indices 12-21
  const weightKeys = [
    "pitching_weight_avg_obp", "pitching_weight_slg", "conference_weight",
    "park_weight_avg_obp", "park_weight_slg", "power_rating_weight",
    "ncaa_avg", "ncaa_obp", "ncaa_slg", "ncaa_power_rating"
  ];
  const weightIndices = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  let configImported = 0;
  for (let i = 0; i < weightKeys.length; i++) {
    const val = parseFloat(configRow[weightIndices[i]]);
    if (isNaN(val)) continue;

    const { error } = await db.from("model_config").upsert({
      model_type: "returner",
      config_key: weightKeys[i],
      config_value: val,
      season,
    }, { onConflict: "model_type,config_key,season" });

    if (!error) configImported++;
  }

  // Dev aggressiveness from row 2 (index 1): indices 6,7,8 = conservative, expected, aggressive
  const devRow = rows[1];
  const devKeys = ["dev_aggressiveness_conservative", "dev_aggressiveness_expected", "dev_aggressiveness_aggressive"];
  for (let i = 0; i < 3; i++) {
    const val = parseFloat(devRow[6 + i]);
    if (isNaN(val)) continue;
    await db.from("model_config").upsert({
      model_type: "returner",
      config_key: devKeys[i],
      config_value: val,
      season,
    }, { onConflict: "model_type,config_key,season" });
    configImported++;
  }

  // Player data starts at row 4 (index 3) which is headers, row 5+ (index 4+) is data
  // Headers: Player Name(0), Player AVG(1), OBP(2), SLG(3), Class Transition(4),
  // Dev Aggressiveness(5), EV Score(6), Barrel%(7), Whiff%(8), Chase%(9),
  // Power Rating Score(10), Power Rating+(11), pAVG(12), pOBP(13), pSLG(14),
  // pOPS(15), pISO(16), pWRC(17), pWRC+(18)

  // Pre-load player cache for fast lookups
  const playerCache = await loadPlayerCache(db);

  let imported = 0;
  let skipped = 0;
  const allRecords = new Map<string, Record<string, unknown>>();

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[0]?.trim();
    if (!rawName) { skipped++; continue; }

    const player = await resolvePlayer(db, rawName, playerCache);
    if (!player) { skipped++; continue; }

    // Use composite key to deduplicate — last occurrence wins
    const dedupeKey = `${player.id}|${player.variant}`;
    allRecords.set(dedupeKey, {
      player_id: player.id,
      model_type: "returner",
      variant: player.variant,
      season,
      from_avg: parseFloat(row[1]) || null,
      from_obp: parseFloat(row[2]) || null,
      from_slg: parseFloat(row[3]) || null,
      class_transition: row[4] || null,
      dev_aggressiveness: parseFloat(row[5]) ?? null,
      ev_score: parseFloat(row[6]) || null,
      barrel_score: parseFloat(row[7]) || null,
      whiff_score: parseFloat(row[8]) || null,
      chase_score: parseFloat(row[9]) || null,
      power_rating_score: parseFloat(row[10]) || null,
      power_rating_plus: parseFloat(row[11]) || null,
      p_avg: parseFloat(row[12]) || null,
      p_obp: parseFloat(row[13]) || null,
      p_slg: parseFloat(row[14]) || null,
      p_ops: parseFloat(row[15]) || null,
      p_iso: parseFloat(row[16]) || null,
      p_wrc: parseFloat(row[17]) || null,
      p_wrc_plus: parseFloat(row[18]) || null,
    });
  }

  // Batch upsert deduplicated records
  const BATCH_SIZE = 200;
  const records = Array.from(allRecords.values());
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const { error } = await db.from("player_predictions").upsert(chunk, {
      onConflict: "player_id,model_type,variant,season",
    });
    if (error) {
      console.error(`Batch upsert error:`, error.message);
      skipped += chunk.length;
    } else {
      imported += chunk.length;
    }
  }

  return { imported, skipped, config_imported: configImported };
}

// ── Import transfer predictions ──────────────────────────────────────
async function importTransferPredictions(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:AA2500`);
  if (rows.length < 4) return { imported: 0, message: "Not enough rows" };

  // Row 2 (index 1) has weights at indices 20-25
  const configRow = rows[1];
  const weightKeys = [
    "pitching_weight_avg_obp", "pitching_weight_slg", "conference_weight",
    "park_weight_avg_obp", "park_weight_slg", "power_rating_weight"
  ];

  let configImported = 0;
  for (let i = 0; i < weightKeys.length; i++) {
    const val = parseFloat(configRow[20 + i]);
    if (isNaN(val)) continue;
    const { error } = await db.from("model_config").upsert({
      model_type: "transfer",
      config_key: weightKeys[i],
      config_value: val,
      season,
    }, { onConflict: "model_type,config_key,season" });
    if (!error) configImported++;
  }

  // Pre-load player cache for fast lookups
  const playerCache = await loadPlayerCache(db);

  let imported = 0;
  let skipped = 0;
  const allRecords = new Map<string, Record<string, unknown>>();

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[0]?.trim();
    if (!rawName) { skipped++; continue; }

    const player = await resolvePlayer(db, rawName, playerCache);
    if (!player) { skipped++; continue; }

    const dedupeKey = `${player.id}|${player.variant}`;
    allRecords.set(dedupeKey, {
      player_id: player.id,
      model_type: "transfer",
      variant: player.variant,
      season,
      from_avg: parseFloat(row[1]) || null,
      from_obp: parseFloat(row[2]) || null,
      from_slg: parseFloat(row[3]) || null,
      from_avg_plus: parseFloat(row[4]) || null,
      from_obp_plus: parseFloat(row[5]) || null,
      from_slg_plus: parseFloat(row[6]) || null,
      to_avg_plus: parseFloat(row[7]) || null,
      to_obp_plus: parseFloat(row[8]) || null,
      to_slg_plus: parseFloat(row[9]) || null,
      from_stuff_plus: parseFloat(row[10]) || null,
      to_stuff_plus: parseFloat(row[11]) || null,
      from_park_factor: parseFloat(row[12]) || null,
      to_park_factor: parseFloat(row[13]) || null,
      ev_score: parseFloat(row[14]) || null,
      barrel_score: parseFloat(row[15]) || null,
      whiff_score: parseFloat(row[16]) || null,
      chase_score: parseFloat(row[17]) || null,
      power_rating_score: parseFloat(row[18]) || null,
      power_rating_plus: parseFloat(row[19]) || null,
      p_avg: parseFloat(row[20]) || null,
      p_obp: parseFloat(row[21]) || null,
      p_slg: parseFloat(row[22]) || null,
      p_ops: parseFloat(row[23]) || null,
      p_iso: parseFloat(row[24]) || null,
      p_wrc: parseFloat(row[25]) || null,
      p_wrc_plus: parseFloat(row[26]) || null,
    });
  }

  const BATCH_SIZE = 200;
  const records = Array.from(allRecords.values());
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const { error } = await db.from("player_predictions").upsert(chunk, {
      onConflict: "player_id,model_type,variant,season",
    });
    if (error) {
      console.error(`Batch upsert error:`, error.message);
      skipped += chunk.length;
    } else {
      imported += chunk.length;
    }
  }

  return { imported, skipped, config_imported: configImported };
}

// ── Import conference stats ──────────────────────────────────────────
async function importConferenceStats(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `${tab}!A1:AC200`);
  if (rows.length < 2) return { imported: 0, message: "No data rows" };

  // Row 1 (index 0) is headers:
  // Team(0), AVG(1), OBP(2), SLG(3), OPS(4), ISO(5), WRC(6),
  // EV Score(7), Barrel Score(8), Whiff% Score(9), Chase% Score(10),
  // Offensive Power Rating(11), AVG+(12), OBP+(13), SLG+(14), OPS+(15),
  // ISO+(16), WRC+(17), Power Rating+(18), Stuff+(19), ""(20),
  // OFF Value(21), RAA(22), Replacement Runs(23), RAR(24),
  // NCAA oWAR(25), Conference oWAR(26), NIL Valuation(27)

  let imported = 0;
  let skipped = 0;
  let confStatsImported = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const conference = row[0]?.trim();
    if (!conference) { skipped++; continue; }

    // ── 1. Upsert into conference_stats (dedicated columns) ──
    const confStatsRecord = {
      conference,
      season,
      avg: parseFloat(row[1]) || null,
      obp: parseFloat(row[2]) || null,
      slg: parseFloat(row[3]) || null,
      ops: parseFloat(row[4]) || null,
      iso: parseFloat(row[5]) || null,
      wrc: parseFloat(row[6]) || null,
      // H-L stored for future pitching use
      ev_score: parseFloat(row[7]) || null,
      barrel_score: parseFloat(row[8]) || null,
      whiff_score: parseFloat(row[9]) || null,
      chase_score: parseFloat(row[10]) || null,
      offensive_power_rating: parseFloat(row[11]) || null,
      // M-R: critical plus-stats for transfer portal equation
      avg_plus: parseFloat(row[12]) || null,
      obp_plus: parseFloat(row[13]) || null,
      slg_plus: parseFloat(row[14]) || null,
      ops_plus: parseFloat(row[15]) || null,
      iso_plus: parseFloat(row[16]) || null,
      wrc_plus: parseFloat(row[17]) || null,
      power_rating_plus: parseFloat(row[18]) || null,
      stuff_plus: parseFloat(row[19]) || null,
    };

    const { error: csError } = await db.from("conference_stats").upsert(confStatsRecord, {
      onConflict: "conference,season",
    });
    if (csError) {
      console.error(`conference_stats upsert failed for ${conference}:`, csError.message);
    } else {
      confStatsImported++;
    }

    // ── 2. Keep power_ratings in sync (legacy) ──
    const powerRating = parseFloat(row[11]) || null;
    const rating = parseFloat(row[18]) || null; // Power Rating+

    const record = {
      conference,
      season,
      rating: rating ?? 100,
      rank: null as number | null,
      strength_of_schedule: null as number | null,
      notes: JSON.stringify({
        avg: parseFloat(row[1]) || null,
        obp: parseFloat(row[2]) || null,
        slg: parseFloat(row[3]) || null,
        ops: parseFloat(row[4]) || null,
        iso: parseFloat(row[5]) || null,
        wrc: parseFloat(row[6]) || null,
        ev_score: parseFloat(row[7]) || null,
        barrel_score: parseFloat(row[8]) || null,
        whiff_score: parseFloat(row[9]) || null,
        chase_score: parseFloat(row[10]) || null,
        offensive_power_rating: powerRating,
        avg_plus: parseFloat(row[12]) || null,
        obp_plus: parseFloat(row[13]) || null,
        slg_plus: parseFloat(row[14]) || null,
        ops_plus: parseFloat(row[15]) || null,
        iso_plus: parseFloat(row[16]) || null,
        wrc_plus: parseFloat(row[17]) || null,
        stuff_plus: parseFloat(row[19]) || null,
        off_value: parseFloat(row[21]) || null,
        raa: parseFloat(row[22]) || null,
        replacement_runs: parseFloat(row[23]) || null,
        rar: parseFloat(row[24]) || null,
        ncaa_owar: parseFloat(row[25]) || null,
        conference_owar: parseFloat(row[26]) || null,
        nil_valuation: row[27] || null,
      }),
    };

    const { data: existing } = await db
      .from("power_ratings")
      .select("id")
      .eq("conference", conference)
      .eq("season", season)
      .maybeSingle();

    if (existing) {
      const { error } = await db.from("power_ratings").update(record).eq("id", existing.id);
      if (error) { console.error(`Failed to update ${conference}:`, error.message); skipped++; continue; }
    } else {
      const { error } = await db.from("power_ratings").insert(record);
      if (error) { console.error(`Failed to insert ${conference}:`, error.message); skipped++; continue; }
    }
    imported++;
  }

  return { imported, skipped, conference_stats_imported: confStatsImported };
}

// ── Import park factors ──────────────────────────────────────────────
async function importParkFactors(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:AF400`);
  if (rows.length < 3) return { imported: 0, message: "No data rows" };

  // Row 1 (index 0): NCAA averages at cols 7-12
  // Row 2 (index 1): Headers
  // Row 3+ (index 2+): Data
  // Layout per row:
  //   A-F (0-5): Home hitting — team, BA, OBP, SLG, OPS, ISO
  //   G (6): empty
  //   H-M (7-12): Away/pitching — team, BA, OBP, SLG, OPS, ISO
  //   N (13): empty
  //   O-AF (14-31): Park factors — team(14), Home AVG+(15), Pitching AVG+(16),
  //     AVG+ Impact(17), Home OBP+(18), Pitching OBP+(19), OBP+ Impact(20),
  //     Home SLG+(21), Pitching SLG+(22), SLG+ Impact(23),
  //     Home OPS+(24), Pitching OPS+(25), OPS Impact(26),
  //     Home ISO+(27), Pitching ISO+(28), ISO Impact(29),
  //     Park Factor WRC(30), Park Factor+ WRC+(31)

  // Delete existing park factors for this season, then batch insert
  await db.from("park_factors").delete().eq("season", season);

  const records: Record<string, unknown>[] = [];

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const team = row[0]?.trim() || row[14]?.trim();
    if (!team) continue;

    const overallFactor = parseFloat(row[30]) || null;
    const overallFactorPlus = parseFloat(row[31]) || null;

    const detail: Record<string, unknown> = {
      home_avg: parseFloat(row[1]) || null,
      home_obp: parseFloat(row[2]) || null,
      home_slg: parseFloat(row[3]) || null,
      away_avg: parseFloat(row[8]) || null,
      away_obp: parseFloat(row[9]) || null,
      away_slg: parseFloat(row[10]) || null,
      home_avg_plus: parseFloat(row[15]) || null,
      pitching_avg_plus: parseFloat(row[16]) || null,
      home_obp_plus: parseFloat(row[18]) || null,
      pitching_obp_plus: parseFloat(row[19]) || null,
      home_slg_plus: parseFloat(row[21]) || null,
      pitching_slg_plus: parseFloat(row[22]) || null,
      home_ops_plus: parseFloat(row[24]) || null,
      pitching_ops_plus: parseFloat(row[25]) || null,
      home_iso_plus: parseFloat(row[27]) || null,
      pitching_iso_plus: parseFloat(row[28]) || null,
      park_factor_wrc_plus: overallFactorPlus,
    };

    records.push({
      team,
      season,
      overall_factor: overallFactor ? overallFactor / 100 : 1.0,
      hits_factor: parseFloat(row[17]) ? parseFloat(row[17]) / 100 : null,
      bb_factor: parseFloat(row[20]) ? parseFloat(row[20]) / 100 : null,
      hr_factor: parseFloat(row[29]) ? parseFloat(row[29]) / 100 : null,
      runs_factor: parseFloat(row[26]) ? parseFloat(row[26]) / 100 : null,
      venue_name: JSON.stringify(detail),
    });
  }

  // Batch insert in chunks of 50
  let imported = 0;
  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50);
    const { error } = await db.from("park_factors").insert(chunk);
    if (error) {
      console.error(`Batch insert failed at offset ${i}:`, error.message);
    } else {
      imported += chunk.length;
    }
  }

  return { imported, skipped: rows.length - 2 - records.length };
}

// ── Parse dollar value string ────────────────────────────────────────
function parseDollar(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ── Import NIL Valuation (Transfer or Returner) ─────────────────────
async function importNilValuation(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  modelType: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:J100`);
  if (rows.length < 2) return { imported: 0, message: "No data rows" };

  // Row 1 (index 0): Headers
  // Player Name(0), pWRC+(1), OFF Value(2), RAA(3), Replacement Runs(4),
  // RAR(5), NCAA oWAR(6), Conference oWAR(7), NIL Valuation(8)

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[0]?.trim();
    if (!rawName || rawName === "#N/A") { skipped++; continue; }

    const player = await findOrCreatePlayer(db, rawName);
    if (!player) { skipped++; continue; }

    const nilValue = parseDollar(row[8]);
    const wrcPlus = parseFloat(row[1]);
    if (isNaN(wrcPlus)) { skipped++; continue; }

    const offValue = parseFloat(row[2]) || null;
    const raa = parseFloat(row[3]) || null;
    const replacementRuns = parseFloat(row[4]) || null;
    const rar = parseFloat(row[5]) || null;
    const ncaaOwar = parseFloat(row[6]) || null;

    const breakdown = {
      model_type: modelType,
      variant: /xstats$/i.test(rawName) ? "xstats" : "regular",
      off_value: offValue,
      raa,
      replacement_runs: replacementRuns,
      rar,
      ncaa_owar: ncaaOwar,
    };

    // Upsert into nil_valuations
    const { data: existing } = await db
      .from("nil_valuations")
      .select("id")
      .eq("player_id", player.id)
      .eq("season", season)
      .eq("model_version", `${modelType}_${breakdown.variant}`)
      .maybeSingle();

    const record = {
      player_id: player.id,
      season,
      estimated_value: nilValue,
      offensive_effectiveness: wrcPlus,
      model_version: `${modelType}_${breakdown.variant}`,
      component_breakdown: breakdown,
    };

    if (existing) {
      await db.from("nil_valuations").update(record).eq("id", existing.id);
    } else {
      await db.from("nil_valuations").insert(record);
    }
    imported++;
  }

  return { imported, skipped };
}

// ── Import TCU Player Valuation ──────────────────────────────────────
async function importTcuValuation(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:J100`);
  if (rows.length < 2) return { imported: 0, message: "No data rows" };

  // Headers: Player Name(0), pAVG(1), pOBP(2), pSLG(3), pOPS(4),
  // pISO(5), pWRC(6), pWRC+(7), NIL Valuation(8)

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[0]?.trim();
    if (!rawName) { skipped++; continue; }

    const player = await findOrCreatePlayer(db, rawName);
    if (!player) { skipped++; continue; }

    const isXstats = /xstats$/i.test(rawName);
    const variant = isXstats ? "xstats" : "regular";
    const nilValue = parseDollar(row[8]);
    const wrcPlus = parseFloat(row[7]) || null;

    const breakdown = {
      model_type: "tcu_valuation",
      variant,
      p_avg: parseFloat(row[1]) || null,
      p_obp: parseFloat(row[2]) || null,
      p_slg: parseFloat(row[3]) || null,
      p_ops: parseFloat(row[4]) || null,
      p_iso: parseFloat(row[5]) || null,
      p_wrc: parseFloat(row[6]) || null,
    };

    const { data: existing } = await db
      .from("nil_valuations")
      .select("id")
      .eq("player_id", player.id)
      .eq("season", season)
      .eq("model_version", `tcu_${variant}`)
      .maybeSingle();

    const record = {
      player_id: player.id,
      season,
      estimated_value: nilValue,
      offensive_effectiveness: wrcPlus,
      model_version: `tcu_${variant}`,
      component_breakdown: breakdown,
    };

    if (existing) {
      await db.from("nil_valuations").update(record).eq("id", existing.id);
    } else {
      await db.from("nil_valuations").insert(record);
    }
    imported++;
  }

  return { imported, skipped };
}

// ── Import Offensive Power Rating (conference-level → player) ────────
async function importOffensivePowerRating(
  db: ReturnType<typeof createClient>,
  token: string,
  spreadsheetId: string,
  tab: string,
  modelType: string,
  season: number
) {
  const rows = await readSheet(token, spreadsheetId, `'${tab}'!A1:K200`);
  if (rows.length < 4) return { imported: 0, message: "Not enough rows" };

  // Row 1 (index 0): header labels (Avg. Exit Velo, Barrel%, Whiff%, Chase%, SDs)
  // Row 2 (index 1): NCAA averages for those metrics
  // Row 3 (index 2): Column headers: Team(0), Avg Exit Velocity(1), Barrel%(2),
  //   Whiff%(3), Chase%(4), EV Score(5), Barrel Score(6), Whiff% Score(7),
  //   Chase% Score(8), Offensive Power Rating(9), Power Rating(10)
  // Row 4+ (index 3+): Conference data

  // Build conference → scores map
  const confMap = new Map<string, {
    ev_score: number | null;
    barrel_score: number | null;
    whiff_score: number | null;
    chase_score: number | null;
    power_rating_score: number | null;
    power_rating_plus: number | null;
  }>();

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const rawConf = row[0]?.trim();
    if (!rawConf) continue;

    // Strip year prefix (e.g., "25 ACC" → "ACC")
    const conf = rawConf.replace(/^\d+\s+/, "");

    confMap.set(conf.toLowerCase(), {
      ev_score: parseFloat(row[5]) || null,
      barrel_score: parseFloat(row[6]) || null,
      whiff_score: parseFloat(row[7]) || null,
      chase_score: parseFloat(row[8]) || null,
      power_rating_score: parseFloat(row[9]) || null,
      power_rating_plus: parseFloat(row[10]) || null,
    });
  }

  // Get all player predictions for this model type + season
  const { data: predictions } = await db
    .from("player_predictions")
    .select("id, player_id")
    .eq("model_type", modelType)
    .eq("season", season);

  if (!predictions || predictions.length === 0) {
    return { imported: 0, skipped: 0, message: "No predictions found for this model type" };
  }

  // Get player conferences/teams
  const playerIds = predictions.map((p: { player_id: string }) => p.player_id);
  const { data: players } = await db
    .from("players")
    .select("id, conference, team")
    .in("id", playerIds);

  const playerConfMap = new Map<string, string>();
  for (const p of players || []) {
    // Use conference if available, otherwise try to extract from team
    const conf = p.conference || p.team || "";
    playerConfMap.set(p.id, conf.toLowerCase());
  }

  let imported = 0;
  let skipped = 0;

  for (const pred of predictions) {
    const confKey = playerConfMap.get(pred.player_id);
    if (!confKey) { skipped++; continue; }

    // Try exact match, then partial match
    let scores = confMap.get(confKey);
    if (!scores) {
      // Try partial matching (e.g., player conf "SEC" matches "sec")
      for (const [key, val] of confMap) {
        if (key.includes(confKey) || confKey.includes(key)) {
          scores = val;
          break;
        }
      }
    }

    if (!scores) { skipped++; continue; }

    const update: Record<string, unknown> = {};
    if (scores.ev_score != null) update.ev_score = scores.ev_score;
    if (scores.barrel_score != null) update.barrel_score = scores.barrel_score;
    if (scores.whiff_score != null) update.whiff_score = scores.whiff_score;
    if (scores.chase_score != null) update.chase_score = scores.chase_score;
    if (scores.power_rating_score != null) update.power_rating_score = scores.power_rating_score;
    if (scores.power_rating_plus != null) update.power_rating_plus = scores.power_rating_plus;

    if (Object.keys(update).length === 0) { skipped++; continue; }

    const { error } = await db.from("player_predictions").update(update).eq("id", pred.id);
    if (error) {
      console.error(`Failed to update power rating for pred ${pred.id}:`, error.message);
      skipped++;
    } else {
      imported++;
    }
  }

  return { imported, skipped, conferences_found: confMap.size };
}
