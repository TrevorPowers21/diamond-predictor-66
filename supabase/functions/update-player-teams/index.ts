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
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(): Promise<string> {
  const jsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!jsonStr) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const sa = JSON.parse(jsonStr);
  const email = sa.client_email;
  const rawKey = sa.private_key;
  if (!email || !rawKey) throw new Error("Invalid SA JSON");

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  }));
  const unsignedToken = `${header}.${payload}`;
  const pem = rawKey.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "").replace(/[\n\r\s]/g, "");
  const binaryDer = decodeBase64(pem);
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsignedToken));
  const sig = toBase64Url(new Uint8Array(signature));
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function readSheet(token: string, spreadsheetId: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Read sheet failed: ${await res.text()}`);
  return (await res.json()).values ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const SPREADSHEET_ID = "1UwtImwQ74ThQlMJizsqMSp6b4tG39uXuiI8nrQ46ZAE";
    const token = await getGoogleAccessToken();

    // Read the returner prediction tab - player name is Col A (0), team info might be available
    // Actually, we need to find where team data lives. Let's read the Transfer/Returner tabs
    // The prediction tabs have player name in col A. We need to find a tab with team data.
    
    // Strategy: Read the returner prediction tab which has player names, 
    // then look up their team from the 64analytics scrape (but using the "Previous Team" column for transfers)
    // Better: Read the Players tab if it exists, or the Returner Prediction tab and match with teams table
    
    const body = await req.json().catch(() => ({}));
    const { action = "update_teams" } = body;

    if (action === "discover") {
      // List all sheet tabs and headers
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`;
      const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!metaRes.ok) throw new Error(`Failed: ${await metaRes.text()}`);
      const meta = await metaRes.json();
      const sheetNames = meta.sheets.map((s: any) => s.properties.title);
      
      const sheets: Record<string, string[]> = {};
      for (const name of sheetNames) {
        try {
          const rows = await readSheet(token, SPREADSHEET_ID, `'${name}'!1:2`);
          sheets[name] = rows[0] ?? [];
        } catch { sheets[name] = []; }
      }
      
      return new Response(JSON.stringify({ success: true, sheets }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_teams") {
      // Read returner prediction tab to get player names, then match with teams
      // The Returner Prediction Equation tab has: Player Name (A), stats...
      // We need team data from somewhere - let's check if there's a Players tab
      
      // First, let's try reading a tab that might have team data
      const tabName = body.tab || "Returner Prediction Equation";
      const rows = await readSheet(token, SPREADSHEET_ID, `'${tabName}'!A1:V2500`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        totalRows: rows.length,
        headers: rows[0] || [],
        sampleRow3: rows[3] || [],
        sampleRow4: rows[4] || [],
        sampleRow5: rows[5] || [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      success: false, error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
