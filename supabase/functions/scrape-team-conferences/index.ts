import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeTeamName(input: string): string {
  return input
    .toLowerCase()
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[.'&-]/g, " ")
    .replace(/\buniversity\b/g, "")
    .replace(/\bcollege\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { startPage = 1, endPage = 222 } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRole);

    const teamToConference = new Map<string, { team: string; conference: string; count: number }>();

    for (let page = startPage; page <= endPage; page++) {
      const url = `https://www.64analytics.com/players?page=${page}&division=D-I&sport=Baseball`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const html = await resp.text();

      const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
      const rows = html.match(rowRegex) || [];
      for (const row of rows) {
        if (row.includes("<th")) continue;
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = cellRegex.exec(row)) !== null) {
          const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          cells.push(text);
        }
        if (cells.length < 3) continue;
        const team = (cells[1] || "").trim();
        const conference = (cells[2] || "").trim();
        if (!team || !conference) continue;
        const key = normalizeTeamName(team);
        const existing = teamToConference.get(key);
        if (!existing) {
          teamToConference.set(key, { team, conference, count: 1 });
        } else if (existing.conference === conference) {
          existing.count += 1;
        } else {
          // Keep most frequent conference for the normalized team key.
          existing.count -= 1;
          if (existing.count <= 0) {
            teamToConference.set(key, { team, conference, count: 1 });
          }
        }
      }
    }

    const { data: teams, error: teamErr } = await db.from("teams").select("id, name, conference");
    if (teamErr) throw teamErr;

    let updated = 0;
    let inserted = 0;

    const existingByNorm = new Map<string, { id: string; name: string; conference: string | null }>();
    for (const t of teams || []) {
      const key = normalizeTeamName(t.name);
      if (!existingByNorm.has(key)) existingByNorm.set(key, t);
    }

    for (const [, item] of teamToConference) {
      const existing = existingByNorm.get(normalizeTeamName(item.team));
      if (existing) {
        if (existing.conference !== item.conference) {
          const { error } = await db.from("teams").update({ conference: item.conference }).eq("id", existing.id);
          if (!error) updated++;
        }
      } else {
        const { error } = await db
          .from("teams")
          .insert({ name: item.team, conference: item.conference, park_factor: null });
        if (!error) inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scraped: teamToConference.size,
        updated,
        inserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
