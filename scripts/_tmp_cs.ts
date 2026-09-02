import { calculateConferenceStuffPlusV2 } from "@/savant/lib/conferenceStuffPlusV2";
(async()=>{
  const u=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||"";
  console.log("ENV:", /trbvxuoliwrfowibatkm/.test(u)?"PROD":"STAGING");
  const r:any = await calculateConferenceStuffPlusV2(2026, { dryRun: true } as any);
  const rows=(r?.report?.overall)||[];
  console.log(`conferences computed: ${rows.length}`);
  rows.slice(0,6).forEach((x:any)=>console.log(`  ${String(x.conference_id??x.conference).slice(0,8)}  stuff+ ${Number(x.stuff_plus??x.value).toFixed(2)}  pitches ${x.pitches??x.total_pitches??"?"}`));
  console.log("errors:", JSON.stringify(r?.errors??[]).slice(0,200));
})().catch(e=>{console.error("FATAL",e.message);process.exit(1);});
