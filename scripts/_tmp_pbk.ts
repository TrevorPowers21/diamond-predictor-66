import pg from "pg";
(async()=>{
  const uri=process.env.PGURI!;
  if(!uri.includes("trbvxuoliwrfowibatkm")){console.error("✗ NOT PROD");process.exit(1);}
  const c=new pg.Client({connectionString:uri,query_timeout:1800000}); await c.connect(); await c.query("set statement_timeout=0");
  // 1) pitch_log labels + scores
  const e1=await c.query(`select to_regclass('_v2_prechain_backup') r`);
  if(e1.rows[0].r) console.log("  _v2_prechain_backup exists — skip");
  else { console.log("  creating _v2_prechain_backup …");
    await c.query(`create table _v2_prechain_backup as select uniq_pitch_id, pitch_type_reclassified,
      classification_version, needs_review, stuff_plus from pitch_log where season=2026`);
    await c.query(`create unique index on _v2_prechain_backup (uniq_pitch_id)`); }
  const n1=await c.query(`select count(*) n, count(pitch_type_reclassified) lbl, count(stuff_plus) sp from _v2_prechain_backup`);
  console.log(`  _v2_prechain_backup: ${n1.rows[0].n} rows | labeled ${n1.rows[0].lbl} | stuff_plus ${n1.rows[0].sp}`);
  // 2) both Masters
  for(const [t,bk] of [["Hitter Master","_hm_prestep5_backup"],["Pitching Master","_pm_prestep5_backup"]] as [string,string][]){
    const e=await c.query(`select to_regclass($1) r`,[bk]);
    if(e.rows[0].r){console.log(`  ${bk} exists — skip`);}
    else{ await c.query(`create table ${bk} as select * from "${t}"`);
          await c.query(`create index on ${bk} (source_player_id, "Season")`); }
    const n=await c.query(`select count(*) n from ${bk}`);
    console.log(`  ${bk}: ${n.rows[0].n} rows`); }
  console.log("\n✅ PROD BACKUPS COMPLETE — chain is fully reversible");
  await c.end();
})().catch(e=>{console.error("FATAL",e.message);process.exit(1);});
