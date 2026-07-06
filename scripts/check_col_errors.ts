import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Check Hitter Master columns on staging
const { data: hSample } = await (STAGING as any).from("Hitter Master").select("*").limit(1);
console.log("Hitter Master columns (staging, sorted):");
console.log(Object.keys(hSample?.[0] || {}).sort().join("\n"));

const { data: pSample } = await (STAGING as any).from("Pitching Master").select("*").limit(1);
console.log("\nPitching Master columns (staging, sorted):");
console.log(Object.keys(pSample?.[0] || {}).sort().filter(k => k.toLowerCase().includes("stuff") || k.toLowerCase().includes("vel") || k.toLowerCase().includes("velo") || k.toLowerCase().includes("power") || k.toLowerCase().includes("score")).join("\n"));
