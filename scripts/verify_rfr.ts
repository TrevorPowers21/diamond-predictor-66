import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
for (const cy of ["R-FR","R-SO","R-JR"]) {
  for (const v of ["regular","precomputed"]) {
    const { data } = await (sb as any).from("player_predictions").select("class_transition, players!inner(class_year)").eq("season",2027).eq("variant",v).eq("players.class_year",cy).limit(5000);
    const dist: Record<string,number> = {};
    for (const r of (data||[])) { const ct = r.class_transition ?? "NULL"; dist[ct]=(dist[ct]||0)+1; }
    console.log(`${cy.padEnd(5)} ${v.padEnd(11)} → ${Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ")}`);
  }
}
