#!/usr/bin/env node

/**
 * Cron runner: scrape + summarize (no email)
 * Designed to run every 30 minutes via launchd
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { generateSummary } from "./summarize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
      stdio: "inherit",
      cwd: __dirname,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const start = new Date();
  console.log(`\n[scrape+summarize] Starting at ${start.toLocaleString("sl-SI")}`);

  // Step 1: Scrape
  console.log("\n[1/3] Scraping...");
  await runScript("scraper.js");

  // Step 2: Visualize
  console.log("\n[2/3] Visualizing...");
  await runScript("visualize.js");

  // Step 3: LLM Summary (non-fatal)
  console.log("\n[3/3] LLM summary...");
  try {
    await generateSummary();
  } catch (err) {
    console.warn(`    LLM summary skipped: ${err.message}`);
  }

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`\n[scrape+summarize] Done in ${mins} minutes`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
