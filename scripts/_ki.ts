import fs from "fs"; import pg from "pg";
pg.types.setTypeParser(1700,(v:any)=>v===null?null:Number(v));
const envFile = process.argv.includes("--prod")?".env.production.local":".env.local";
const m = fs.readFileSync(envFile,"utf8").match(/^PGURI=(.*)$/m)!;
(async()=>{const c=new pg.Client({connectionString:m[1].trim().replace(/^["']|["']$/g,"")});await c.connect();
console.log(`### ${envFile.includes("prod")?"PROD":"STAGING"} — TWP own-side check`);
console.table((await c.query(`select pl.last_name nm, tbp.position_slot slot,
   (tbp.player_snapshot->>'market_value') mv,
   round((tbp.player_snapshot->>'twp_hitter_market_value')::numeric,0) twp_h,
   round((tbp.player_snapshot->>'twp_pitcher_market_value')::numeric,0) twp_p,
   round((tbp.player_snapshot->>'p_war')::numeric,2) pwar
 from team_build_players tbp join players pl on pl.id=tbp.player_id
 where pl.is_twp=true and tbp.player_snapshot is not null order by pl.last_name limit 8`)).rows);
await c.end();})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
