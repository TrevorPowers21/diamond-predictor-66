import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
function ev(f:string,k:string){return readFileSync(f,"utf-8").split("\n").find(l=>l.startsWith(k+"="))?.split("=",2)[1]?.trim()??"";}
function parkCode(s:string|null){ if(!s) return null; const t=s.replace(/\d{9}$/,"").replace(/^cs-/,""); return t||null; }
async function main(){
  const key = ev(".env.local","SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", key, { auth:{persistSession:false}}) as any;
  const dir="docs/drs-reference";
  const files=readdirSync(dir).filter(f=>/DRS Pitch Log\.csv$/.test(f));
  const map=new Map<string,string>();
  for(const f of files){
    const txt=readFileSync(`${dir}/${f}`,"utf-8");
    const lines=txt.split("\n");
    const hdr=lines[0].split(",");
    const ui=hdr.indexOf("uniqPitchId"), gi=hdr.indexOf("gameString");
    if(ui<0||gi<0){ console.log("skip (no cols):",f); continue; }
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(",");
      const u=cols[ui]?.trim(), g=cols[gi]?.trim();
      if(u&&g) map.set(u,g);
    }
    console.log(`read ${f}: map now ${map.size}`);
  }
  const rows=[...map.entries()].map(([u,g])=>({uniq_pitch_id:u, game_string:g, park_code:parkCode(g)}));
  console.log(`upserting ${rows.length} rows...`);
  const B=5000; let done=0;
  for(let i=0;i<rows.length;i+=B){
    const { error } = await sb.from("_park_code_fix").upsert(rows.slice(i,i+B), { onConflict:"uniq_pitch_id" });
    if(error) throw error;
    done+=Math.min(B,rows.length-i);
    if(done % 100000 < B) console.log(`  upserted ${done}`);
  }
  console.log(`DONE loaded ${done}`);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
