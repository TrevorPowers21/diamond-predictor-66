import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").trim();
}

interface CsvPlayer {
  firstName: string;
  lastName: string;
  variant: "regular" | "xstats";
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc: number | null;
  p_wrc_plus: number | null;
}

function parseCsv(text: string): CsvPlayer[] {
  const lines = text.split("\n");
  const players: CsvPlayer[] = [];

  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim());
    const rawName = cols[0];
    if (!rawName) continue;
    // Skip header/config rows
    if (rawName === "Player Name" || rawName.startsWith(",,")) continue;
    if (rawName.includes("Avg.") || rawName === "Team") continue;

    // Must have at least AVG in col B
    const fromAvg = parseFloat(cols[1]);
    if (isNaN(fromAvg)) continue;

    const isXstats = rawName.toLowerCase().endsWith(" xstats");
    const cleanName = isXstats ? rawName.replace(/\s*xstats$/i, "") : rawName;
    const nameParts = cleanName.trim().split(/\s+/);
    if (nameParts.length < 2) continue;

    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");

    const fromObp = parseFloat(cols[2]);
    const fromSlg = parseFloat(cols[3]);
    const pAvg = parseFloat(cols[12]);
    const pObp = parseFloat(cols[13]);
    const pSlg = parseFloat(cols[14]);
    const pOps = parseFloat(cols[15]);
    const pIso = parseFloat(cols[16]);
    const pWrc = parseFloat(cols[17]);
    const pWrcPlus = parseFloat(cols[18]);

    players.push({
      firstName,
      lastName,
      variant: isXstats ? "xstats" : "regular",
      from_avg: isNaN(fromAvg) ? null : fromAvg,
      from_obp: isNaN(fromObp) ? null : fromObp,
      from_slg: isNaN(fromSlg) ? null : fromSlg,
      p_avg: isNaN(pAvg) ? null : pAvg,
      p_obp: isNaN(pObp) ? null : pObp,
      p_slg: isNaN(pSlg) ? null : pSlg,
      p_ops: isNaN(pOps) ? null : pOps,
      p_iso: isNaN(pIso) ? null : pIso,
      p_wrc: isNaN(pWrc) ? null : pWrc,
      p_wrc_plus: isNaN(pWrcPlus) ? null : pWrcPlus,
    });
  }
  return players;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { storagePath, dryRun = true } = body;

    if (!storagePath) {
      return new Response(JSON.stringify({ error: "storagePath required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from("imports")
      .download(storagePath);

    if (dlErr || !fileData) {
      return new Response(
        JSON.stringify({ error: `Download failed: ${dlErr?.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const csvText = await fileData.text();
    const csvPlayers = parseCsv(csvText);

    const csvLookup = new Map<string, CsvPlayer>();
    for (const p of csvPlayers) {
      const key = `${normalizeName(p.firstName)}|${normalizeName(p.lastName)}|${p.variant}`;
      csvLookup.set(key, p);
    }

    // Fetch all active predictions in batches
    let allPredictions: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const { data: batch, error: batchErr } = await supabase
        .from("player_predictions")
        .select(`
          id, player_id, variant, model_type, status, locked,
          from_avg, from_obp, from_slg,
          p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc, p_wrc_plus,
          players!inner(id, first_name, last_name)
        `)
        .eq("status", "active")
        .range(offset, offset + batchSize - 1);

      if (batchErr) throw batchErr;
      if (!batch || batch.length === 0) break;
      allPredictions = allPredictions.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    const fromUpdates: Array<{ predId: string; name: string; variant: string; modelType: string; fields: Record<string, number | null> }> = [];
    const predUpdates: Array<{ predId: string; name: string; variant: string; modelType: string; fields: Record<string, number | null> }> = [];
    const toUnlock: string[] = [];

    for (const pred of allPredictions) {
      const p = pred as any;
      const player = p.players;
      const key = `${normalizeName(player.first_name)}|${normalizeName(player.last_name)}|${p.variant}`;
      const csvMatch = csvLookup.get(key);
      if (!csvMatch) continue;

      let needsFromFill = false;
      let needsPredFill = false;

      // Fill from_avg/from_obp/from_slg if blank (for ALL players)
      const fromBlank = p.from_avg == null && p.from_obp == null && p.from_slg == null;
      if (fromBlank) {
        const fields: Record<string, number | null> = {};
        if (csvMatch.from_avg != null) fields.from_avg = csvMatch.from_avg;
        if (csvMatch.from_obp != null) fields.from_obp = csvMatch.from_obp;
        if (csvMatch.from_slg != null) fields.from_slg = csvMatch.from_slg;
        if (Object.keys(fields).length > 0) {
          needsFromFill = true;
          fromUpdates.push({
            predId: p.id,
            name: `${player.first_name} ${player.last_name}`,
            variant: p.variant,
            modelType: p.model_type,
            fields,
          });
        }
      }

      // Fill predicted stats ONLY for returners
      if (p.model_type === "returner") {
        const predBlank = p.p_avg == null && p.p_obp == null && p.p_slg == null;
        if (predBlank) {
          const fields: Record<string, number | null> = {};
          if (csvMatch.p_avg != null) fields.p_avg = csvMatch.p_avg;
          if (csvMatch.p_obp != null) fields.p_obp = csvMatch.p_obp;
          if (csvMatch.p_slg != null) fields.p_slg = csvMatch.p_slg;
          if (csvMatch.p_ops != null) fields.p_ops = csvMatch.p_ops;
          if (csvMatch.p_iso != null) fields.p_iso = csvMatch.p_iso;
          if (csvMatch.p_wrc != null) fields.p_wrc = csvMatch.p_wrc;
          if (csvMatch.p_wrc_plus != null) fields.p_wrc_plus = csvMatch.p_wrc_plus;
          if (Object.keys(fields).length > 0) {
            needsPredFill = true;
            predUpdates.push({
              predId: p.id,
              name: `${player.first_name} ${player.last_name}`,
              variant: p.variant,
              modelType: p.model_type,
              fields,
            });
          }
        }
      }

      if ((needsFromFill || needsPredFill) && p.locked) {
        toUnlock.push(p.id);
      }
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        mode: "dry_run",
        csvPlayersParsed: csvPlayers.length,
        predictionsChecked: allPredictions.length,
        fromStatsFills: fromUpdates.length,
        predStatsFills: predUpdates.length,
        toUnlock: toUnlock.length,
        fromUpdates: fromUpdates.map((u) => ({ name: u.name, variant: u.variant, modelType: u.modelType, fields: u.fields })),
        predUpdates: predUpdates.map((u) => ({ name: u.name, variant: u.variant, modelType: u.modelType, fields: u.fields })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Execute updates - combine from + pred fields per prediction
    const merged = new Map<string, Record<string, number | null>>();
    for (const u of [...fromUpdates, ...predUpdates]) {
      const existing = merged.get(u.predId) || {};
      merged.set(u.predId, { ...existing, ...u.fields });
    }

    const results: string[] = [];
    const errors: string[] = [];
    const unlockedCount: number = toUnlock.length;

    // First unlock those that need filling
    if (toUnlock.length > 0) {
      const { error: unlockErr } = await supabase
        .from("player_predictions")
        .update({ locked: false })
        .in("id", toUnlock);
      if (unlockErr) {
        console.error("Unlock error:", unlockErr);
        errors.push(`Failed to unlock batch: ${unlockErr.message}`);
      }
    }

    // Now update stats
    for (const [predId, fields] of merged) {
      try {
        const { error } = await supabase
          .from("player_predictions")
          .update(fields)
          .eq("id", predId);
        if (error) throw error;
        results.push(`${predId}: filled ${Object.keys(fields).join(", ")}`);
      } catch (err) {
        errors.push(`${predId}: ${(err as Error).message}`);
      }
    }

    return new Response(JSON.stringify({
      mode: "execute",
      filled: results.length,
      unlocked: unlockedCount,
      results,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
