import "dotenv/config";
import { resolveMarkets } from "../server/jobs.js";

console.log("resolution:", await resolveMarkets());
