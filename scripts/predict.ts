import "dotenv/config";
import { runPredictions } from "../server/jobs.js";

// Usage: npm run predict -- [marketLimit]
console.log("predictions:", await runPredictions({ marketLimit: Number(process.argv[2] ?? 6) }));
