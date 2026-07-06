import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== Hitter Master 2026 (oldest, newest) ===");
const { data: hmOld } = await (sb as any).from("Hitter Master").select("source_player_id, playerFullName, created_at, updated_at").eq("Season", 2026).order("created_at", { ascending: true }).limit(1);
const { data: hmNew } = await (sb as any).from("Hitter Master").select("source_player_id, playerFullName, created_at, updated_at").eq("Season", 2026).order("created_at", { ascending: false }).limit(1);
const { data: hmUpd } = await (sb as any).from("Hitter Master").select("source_player_id, playerFullName, updated_at").eq("Season", 2026).order("updated_at", { ascending: false }).limit(1);
console.log("oldest created:", hmOld?.[0]);
console.log("newest created:", hmNew?.[0]);
console.log("most recent updated:", hmUpd?.[0]);

console.log("\n=== Pitching Master 2026 (oldest, newest) ===");
const { data: pmOld } = await (sb as any).from("Pitching Master").select("source_player_id, playerFullName, created_at, updated_at").eq("Season", 2026).order("created_at", { ascending: true }).limit(1);
const { data: pmNew } = await (sb as any).from("Pitching Master").select("source_player_id, playerFullName, created_at, updated_at").eq("Season", 2026).order("created_at", { ascending: false }).limit(1);
console.log("oldest created:", pmOld?.[0]);
console.log("newest created:", pmNew?.[0]);

console.log("\n=== player_predictions (oldest, newest, last update) ===");
const { data: ppOld } = await (sb as any).from("player_predictions").select("id, created_at, updated_at, season").eq("season", 2027).order("created_at", { ascending: true }).limit(1);
const { data: ppNew } = await (sb as any).from("player_predictions").select("id, created_at, updated_at, season").eq("season", 2027).order("created_at", { ascending: false }).limit(1);
const { data: ppUpd } = await (sb as any).from("player_predictions").select("id, updated_at, season").eq("season", 2027).order("updated_at", { ascending: false }).limit(1);
console.log("oldest:", ppOld?.[0]);
console.log("newest:", ppNew?.[0]);
console.log("last updated:", ppUpd?.[0]);

console.log("\n=== players table (oldest, newest) ===");
const { data: plOld } = await (sb as any).from("players").select("id, first_name, last_name, created_at").order("created_at", { ascending: true }).limit(1);
const { data: plNew } = await (sb as any).from("players").select("id, first_name, last_name, created_at").order("created_at", { ascending: false }).limit(1);
console.log("oldest:", plOld?.[0]);
console.log("newest:", plNew?.[0]);

console.log("\n=== team_build_players (recent activity — indicator of Peyton's work) ===");
const { data: tbpUpd } = await (sb as any).from("team_build_players").select("id, updated_at, player_snapshot").order("updated_at", { ascending: false }).limit(3);
console.log(JSON.stringify(tbpUpd?.map(r => ({ id: r.id, updated_at: r.updated_at, has_snapshot: !!r.player_snapshot })), null, 2));
