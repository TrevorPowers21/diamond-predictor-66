import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const s of [2025, 2026] as const) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (sb as any).from("Pitching Master").select("Conference, IP").eq("Season", s).range(from, from+999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const isJuco: Record<string, number> = { JUCO: 0, "D1/other": 0 };
  for (const r of all) {
    if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) isJuco.JUCO++;
    else isJuco["D1/other"]++;
  }
  console.log(`Season ${s}: total=${all.length}  JUCO=${isJuco.JUCO}  D1/other=${isJuco["D1/other"]}`);
}
