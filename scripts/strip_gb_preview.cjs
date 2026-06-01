const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Hitter rule (per Trevor 2026-05-31):
//   Acceptable framings for ground-ball:
//     (1) high GB rate => power potential is limited
//     (2) low GB rate => shows feel for hitting the ball in the air
//   Strip every other sentence that mentions ground-ball.
// Broadened context: any power-related or air-ball-related token. If a GB
// sentence contains ANY of these, it's discussing GB in one of the two
// acceptable framings (limits power / shows air-ball feel).
const POWER_OR_AIR = /\b(power|slug\w*|home\s+runs?|HRs?|extra[- ]?base|XBH|in\s+the\s+air|fly[- ]?balls?|elevation|elevat\w+|lift\w*|loft\w*|carry|leverage|gap|gaps|drive\s+(the\s+ball|the\s+baseball|balls|it)|pull[- ]?air|exit\s+velo\w*|EV90?\b|barrel|production|output|offensive\s+impact|run\s+production|drag|wasted|punish)\b/i;

const PRAISE = "(elite|plus|above[- ]?average|impressive|strong|excellent|outstanding)";

function neutralizePraise(s) {
  let out = s;
  // "elite 25% ground-ball" → "25% ground-ball"
  out = out.replace(new RegExp(`\\b${PRAISE}\\s+(\\d+(?:\\.\\d+)?%?\\s+)?(ground[\\s-]?ball)`, "gi"), "$2$3");
  // "ground-ball rate of 33.6, plus" → "ground-ball rate of 33.6"
  out = out.replace(new RegExp(`(ground[\\s-]?ball\\s+\\w+(?:\\s+(?:of|at)\\s+\\d+(?:\\.\\d+)?%?)?)\\s*,\\s*${PRAISE}\\b`, "gi"), "$1");
  // "ground-ball rate is plus" → "ground-ball rate"
  out = out.replace(new RegExp(`(ground[\\s-]?ball\\s+rate(?:\\s+of\\s+\\d+(?:\\.\\d+)?%?)?)\\s+(?:is|sits|runs|reads)\\s+${PRAISE}\\b`, "gi"), "$1");
  // "ground-ball heavy at 33.3 (plus)" → "ground-ball heavy at 33.3"
  // Use \S/\s (allow decimal points) but cap at 40 chars to stay within sentence
  out = out.replace(new RegExp(`(ground[\\s-]?ball[^\\n]{0,40}?)\\s*\\(${PRAISE}\\)`, "gi"), "$1");
  // "an ground-ball" / "an 37.6 ground-ball" → "a ..."
  out = out.replace(/\ban (ground[\s-]?ball)/gi, "a $1");
  out = out.replace(/\ban (\d[\d.]*%?\s+ground[\s-]?ball)/gi, "a $1");
  return out.replace(/\s+,/g, ",").replace(/\s+\)/g, ")").replace(/  +/g, " ").trim();
}

// Banned framings: positively-framed GB context. Even if a sentence has
// power/air context, these specific POSITIVE framings are not acceptable.
// Negative framings ("GB tendency is a drag on production") are FINE — they
// are Trevor's intended use case.
const BANNED_NEAR_GB = /\bground[\s-]?ball\s+(approach|machine)\b|\b(should|will)\s+(travel|carry|hold|play\s+well|translate)\b|\bcarries?\s+up\b|\btranslates?\s+(?:well|up)\b|\b(?:shows?|demonstrate\w*|indicate[s]?|signal[s]?)\s+(skill|bat\s+control|feel|control)\b|\b(?:valuable|productive|useful)\b/i;

function clean(body) {
  return body.split(/\n\s*\n/).map((para) => {
    const sents = para.split(/(?<=[.!?])\s+/);
    const kept = sents.filter((s) => {
      const hasGb = /ground[\s-]?ball/i.test(s);
      if (!hasGb) return true;
      // Banned framings override the keep, even when power/air context exists
      if (BANNED_NEAR_GB.test(s)) return false;
      return POWER_OR_AIR.test(s);
    }).map((s) => /ground[\s-]?ball/i.test(s) ? neutralizePraise(s) : s);
    return kept.join(" ").replace(/\s+/g, " ").trim();
  }).filter((p) => p.length > 0).join("\n\n");
}

(async () => {
  const { data: gb } = await sb
    .from("ai_scouting_reports")
    .select("body, player_id")
    .eq("side", "hitter")
    .ilike("body", "%ground%ball%")
    .limit(3000);
  console.log(`Sample size: ${gb.length}`);

  let changedCount = 0;
  let droppedSentences = 0;
  let keptGbSentences = 0;
  for (const r of gb) {
    const before = r.body;
    const after = clean(before);
    if (after !== before) changedCount++;
    const ba = before.split(/(?<=[.!?])\s+/).filter((s) => /ground[\s-]?ball/i.test(s));
    const aa = after.split(/(?<=[.!?])\s+/).filter((s) => /ground[\s-]?ball/i.test(s));
    droppedSentences += ba.length - aa.length;
    keptGbSentences += aa.length;
  }
  console.log(`Reports that would change: ${changedCount} of ${gb.length}`);
  console.log(`GB sentences dropped: ${droppedSentences}`);
  console.log(`GB sentences kept (power/air context): ${keptGbSentences}`);

  console.log("\n=== 8 EXAMPLES ===");
  let n = 0;
  for (const r of gb) {
    const before = r.body;
    const after = clean(before);
    if (after === before) continue;
    n++;
    console.log(`\n--- Example ${n} ---`);
    const ba = before.split(/(?<=[.!?])\s+/);
    for (const b of ba) {
      if (!/ground[\s-]?ball/i.test(b)) continue;
      const banned = BANNED_NEAR_GB.test(b);
      const hasContext = POWER_OR_AIR.test(b);
      if (banned || !hasContext) { console.log("DROPPED:", b); continue; }
      const neut = neutralizePraise(b);
      if (neut === b) console.log("KEPT   :", b);
      else { console.log("BEFORE :", b); console.log("AFTER  :", neut); }
    }
    if (n >= 8) break;
  }
})();
