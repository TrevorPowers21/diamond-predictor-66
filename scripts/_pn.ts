import fs from "fs"; import pg from "pg";
const envFile = process.argv.includes("--prod")?".env.production.local":".env.local";
const m = fs.readFileSync(envFile,"utf8").match(/^PGURI=(.*)$/m)!;
(async()=>{const c=new pg.Client({connectionString:m[1].trim().replace(/^["']|["']$/g,"")});await c.connect();
console.log(`### ${envFile.includes("prod")?"PROD":"STAGING"} — how many rows carry REAL toggles?`);
console.table((await c.query(`select
   count(*)::int rows,
   count(*) filter (where (production_notes::jsonb->>'devAggressiveness')::numeric <> 0)::int devagg_nonzero,
   count(*) filter (where (production_notes::jsonb->>'devAggressivenessOverridden')::boolean)::int devagg_overridden,
   count(*) filter (where (production_notes::jsonb->>'classTransitionOverridden')::boolean)::int class_overridden
 from team_build_players where production_notes is not null`)).rows);
console.log("target_board:");
console.table((await c.query(`select count(*)::int rows,
   count(*) filter (where production_notes is not null)::int has_notes,
   count(*) filter (where production_notes is not null and (production_notes::jsonb->>'devAggressiveness')::numeric <> 0)::int devagg_nonzero
 from target_board`)).rows);
await c.end();})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
