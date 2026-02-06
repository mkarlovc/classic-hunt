#!/usr/bin/env node

/**
 * Main runner script for Classic Hunt
 * Runs the scraper, generates visualization, and sends email report
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs-extra";
import { sendEmailReport } from "./email-sender.js";
import { generateSummary } from "./summarize.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Change to script directory to ensure relative paths work
process.chdir(__dirname);

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Running: ${scriptPath}`);
    console.log('='.repeat(50));

    const child = spawn("node", [scriptPath], {
      stdio: "inherit",
      cwd: __dirname,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${scriptPath} exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  const startTime = new Date();
  console.log(`\nClassic Hunt - Starting at ${startTime.toLocaleString('sl-SI')}`);
  console.log('='.repeat(50));

  try {
    // Load config
    const config = await fs.readJson("./config.json");

    // Step 1: Run scraper
    console.log("\n[1/4] Running scraper...");
    await runScript("scraper.js");

    // Step 2: Generate visualization
    console.log("\n[2/4] Generating visualization...");
    await runScript("visualize.js");

    // Step 3: LLM Summary (non-fatal)
    console.log("\n[3/4] Generating LLM summary...");
    try {
      await generateSummary();
    } catch (err) {
      console.warn(`    LLM summary skipped: ${err.message}`);
    }

    // Step 4: Send email if configured
    if (config.email && config.smtpHost) {
      console.log("\n[4/4] Sending email report...");
      await sendEmailReport(config);
    } else {
      console.log("\n[4/4] Email not configured - skipping");
      console.log("    Add email settings to config.json to enable email reports");
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Completed in ${duration} minutes`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main();
