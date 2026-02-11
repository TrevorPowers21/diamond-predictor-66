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
