import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
for (const s of [2025, 2026] as const) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (sb as any).from("Hitter Master").select("Conference").eq("Season", s).range(from, from+999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  let juco = 0, other = 0;
  for (const r of all) {
    if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) juco++;
    else other++;
  }
  console.log(`Hitter Master ${s}: total=${all.length}  JUCO=${juco}  D1/other=${other}`);
}
