// Apply the GB-cleanup transform to all hitter ai_scouting_reports on prod.
// Strips sentences that mention ground-ball UNLESS they discuss power
// limitation or air-ball feel (Trevor's only acceptable framings). In
// surviving sentences, neutralizes praise tier words attached to GB.
// Idempotent — re-running gives the same output. input_hash is NOT updated,
// so future regenerator runs still see these rows as "unchanged, skip".

const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PRAISE = "(elite|plus|above[- ]?average|impressive|strong|excellent|outstanding)";
const POWER_OR_AIR = /\b(power|slug\w*|home\s+runs?|HRs?|extra[- ]?base|XBH|in\s+the\s+air|fly[- ]?balls?|elevation|elevat\w+|lift\w*|loft\w*|carry|leverage|gap|gaps|drive\s+(the\s+ball|the\s+baseball|balls|it)|pull[- ]?air|exit\s+velo\w*|EV90?\b|barrel|production|output|offensive\s+impact|run\s+production|drag|wasted|punish)\b/i;
const BANNED_NEAR_GB = /\bground[\s-]?ball\s+(approach|machine)\b|\b(should|will)\s+(travel|carry|hold|play\s+well|translate)\b|\bcarries?\s+up\b|\btranslates?\s+(?:well|up)\b|\b(?:shows?|demonstrate\w*|indicate[s]?|signal[s]?)\s+(skill|bat\s+control|feel|control)\b|\b(?:valuable|productive|useful)\b/i;

function neutralizePraise(s) {
  let out = s;
  out = out.replace(new RegExp(`\\b${PRAISE}\\s+(\\d+(?:\\.\\d+)?%?\\s+)?(ground[\\s-]?ball)`, "gi"), "$2$3");
  out = out.replace(new RegExp(`(ground[\\s-]?ball\\s+\\w+(?:\\s+(?:of|at)\\s+\\d+(?:\\.\\d+)?%?)?)\\s*,\\s*${PRAISE}\\b`, "gi"), "$1");
  out = out.replace(new RegExp(`(ground[\\s-]?ball\\s+rate(?:\\s+of\\s+\\d+(?:\\.\\d+)?%?)?)\\s+(?:is|sits|runs|reads)\\s+${PRAISE}\\b`, "gi"), "$1");
  out = out.replace(new RegExp(`(ground[\\s-]?ball[^\\n]{0,40}?)\\s*\\(${PRAISE}\\)`, "gi"), "$1");
  out = out.replace(/\ban (ground[\s-]?ball)/gi, "a $1");
  out = out.replace(/\ban (\d[\d.]*%?\s+ground[\s-]?ball)/gi, "a $1");
  return out.replace(/\s+,/g, ",").replace(/\s+\)/g, ")").replace(/  +/g, " ").trim();
}

function clean(body) {
  return body.split(/\n\s*\n/).map((para) => {
    const sents = para.split(/(?<=[.!?])\s+/);
    const kept = sents.filter((s) => {
      const hasGb = /ground[\s-]?ball/i.test(s);
      if (!hasGb) return true;
      if (BANNED_NEAR_GB.test(s)) return false;
      return POWER_OR_AIR.test(s);
    }).map((s) => /ground[\s-]?ball/i.test(s) ? neutralizePraise(s) : s);
    return kept.join(" ").replace(/\s+/g, " ").trim();
  }).filter((p) => p.length > 0).join("\n\n");
}

(async () => {
  // Pull ALL hitter reports mentioning ground-ball
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("ai_scouting_reports")
      .select("player_id, body")
      .eq("side", "hitter")
      .ilike("body", "%ground%ball%")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Fetched ${all.length} hitter reports mentioning ground-ball`);

  // Compute changes
  const updates = [];
  for (const r of all) {
    const after = clean(r.body);
    if (after !== r.body) updates.push({ player_id: r.player_id, body: after });
  }
  console.log(`Reports to update: ${updates.length}`);

  // Apply updates in parallel batches
  let written = 0;
  let failed = 0;
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((u) =>
        sb.from("ai_scouting_reports").update({ body: u.body }).eq("player_id", u.player_id).eq("side", "hitter"),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && !s.value.error) written++;
      else failed++;
    }
    process.stdout.write(`\r  ${written}/${updates.length}${failed ? ` (${failed} err)` : ""}`);
  }
  console.log(`\nDone: ${written} written, ${failed} errors`);
})();
