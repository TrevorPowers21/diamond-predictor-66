import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Pull ALL distinct seasons (not just the 5 I guessed)
for (const t of ["Pitching Master", "Hitter Master"] as const) {
  const seasonSet = new Set<number>();
  let from = 0;
  while (true) {
    const { data } = await (sb as any).from(t).select("Season").range(from, from+999);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.Season != null) seasonSet.add(r.Season);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`${t} ALL seasons:`, Array.from(seasonSet).sort((a,b)=>a-b));
}

// Same for player_predictions
const predSeasons = new Set<number>();
let from = 0;
while (true) {
  const { data } = await (sb as any).from("player_predictions").select("season").range(from, from+999);
  if (!data || data.length === 0) break;
  for (const r of data) if (r.season != null) predSeasons.add(r.season);
  if (data.length < 1000) break;
  from += 1000;
}
console.log("player_predictions ALL seasons:", Array.from(predSeasons).sort((a,b)=>a-b));
