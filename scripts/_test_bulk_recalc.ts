import { bulkRecalculatePredictionsLocal } from "../src/lib/predictionEngine";

console.log("Calling bulkRecalculatePredictionsLocal on staging (env-loaded supabase client)...");
const result = await bulkRecalculatePredictionsLocal(2027);
console.log("\n=== Result ===");
console.log(JSON.stringify(result, null, 2));
