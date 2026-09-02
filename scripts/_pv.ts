import fs from "fs"; import pg from "pg";
const envFile = process.argv.includes("--prod")?".env.production.local":".env.local";
const m = fs.readFileSync(envFile,"utf8").match(/^PGURI=(.*)$/m)!;
(async()=>{const c=new pg.Client({connectionString:m[1].trim().replace(/^["']|["']$/g,"")});await c.connect();
await c.query("set statement_timeout='9min'");
const tag = envFile.includes("prod")?"PROD":"STAGING";
console.log(`### ${tag}`);
console.log("-- wRC+ : which formula reproduces the STORED value?");
console.table((await c.query(`
 with r as (select pp.p_wrc_plus st, pp.p_avg, pp.p_obp, pp.p_slg, (pp.p_slg-pp.p_avg) iso
   from player_predictions pp join players p on p.id=pp.player_id
   where p.division='D1' and pp.model_type='returner' and pp.variant='regular'
     and pp.customer_team_id is null and pp.season=2027 and pp.p_wrc_plus is not null and pp.p_obp is not null)
 select count(*)::int rows,
   count(*) filter (where abs(st - round(((0.011+0.691*p_obp+0.235*p_slg)/0.3782)*100)) <= 1)::int canonical,
   count(*) filter (where abs(st - round(((0.011+0.450*p_obp+0.300*p_slg+0.15*p_avg+0.10*iso)/0.364)*100)) <= 1)::int legacy,
   round(avg(st)::numeric,2) mean_wrc
 from r`)).rows);
console.log("-- returner pitching, QUALIFIED ip>=40");
console.table((await c.query(`
 select count(*)::int n, round(avg(p_era)::numeric,4) mean_era,
   round((percentile_cont(0.05) within group (order by p_era))::numeric,3) p05,
   round((percentile_cont(0.50) within group (order by p_era))::numeric,3) p50,
   round((percentile_cont(0.90) within group (order by p_era))::numeric,3) p90,
   round(avg(p_bb9)::numeric,3) mean_bb9, round(avg(p_war)::numeric,3) mean_pwar
 from player_predictions pp join players p on p.id=pp.player_id
 where p.division='D1' and pp.model_type='returner' and pp.variant='regular'
   and pp.customer_team_id is null and pp.season=2027 and pp.projected_ip>=40`)).rows);
await c.end();})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
