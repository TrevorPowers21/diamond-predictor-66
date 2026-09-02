import pg from "pg";
(async()=>{const c=new pg.Client({connectionString:process.env.PGURI!,query_timeout:900000});await c.connect();await c.query("set statement_timeout=0");
// NULL stale labels on non-data rows so ONE vocabulary remains. They have no stuff_plus and are never displayed.
const r=await c.query(`update pitch_log set pitch_type_reclassified=null, classification_version=null, needs_review=null
 where season=2026 and is_data=false and pitch_type_reclassified is not null`);
console.log(`nulled stale labels on ${r.rowCount} is_data=false rows`);
const v=await c.query(`select count(*) filter (where pitch_type_reclassified='4-Seam Fastball') old_vocab,
 count(distinct pitch_type_reclassified) distinct_labels from pitch_log where season=2026`);
console.log("after:",JSON.stringify(v.rows[0]));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
