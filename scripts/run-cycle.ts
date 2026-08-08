import "dotenv/config";
import { resolveMarkets, runPredictions, syncMarkets } from "../server/jobs.js";

// Usage: npm run sync -- [marketLimit] [horizonDays]
const marketLimit = Number(process.argv[2] ?? 6);
const horizonDays = process.argv[3] ? Number(process.argv[3]) : undefined;

console.log("sync:", await syncMarkets(marketLimit * 2, horizonDays));
console.log("predictions:", await runPredictions({ marketLimit }));
console.log("resolution:", await resolveMarkets());
