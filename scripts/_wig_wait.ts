import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PID="31d52121-0522-451a-b6dd-a1f2a8e7b9b0";
const ARK="6deca66a-b4c0-403f-9614-a9d32f1d5994";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
(async () => {
  for(let i=0;i<30;i++){
    const { data: pr } = await (sb as any).from("player_predictions").select("p_war,p_rv_plus,p_era,p_fip,market_value,pitcher_role,projected_ip").eq("player_id",PID).eq("season",2027).eq("customer_team_id",ARK).eq("variant","precomputed").maybeSingle();
    const { count } = await (sb as any).from("player_predictions").select("id",{count:"exact",head:true}).eq("player_id",PID).eq("season",2027);
    if(pr){
      console.log(`✓ Arkansas precompute LANDED (total 2027 preds: ${count})`);
      console.log(`  pWAR=${pr.p_war?.toFixed(2)} pRV+=${pr.p_rv_plus?.toFixed(1)} pERA=${pr.p_era?.toFixed(2)} pFIP=${pr.p_fip?.toFixed(2)} MV=$${Math.round(pr.market_value)} role=${pr.pitcher_role} IP=${pr.projected_ip}`);
      process.exit(0);
    }
    console.log(`  poll ${i+1}: ${count} preds, Arkansas pending…`);
    await sleep(5000);
  }
  console.log("timed out waiting for Arkansas precompute");
})().catch(e=>console.error("ERR:",e.message));
