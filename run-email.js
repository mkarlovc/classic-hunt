#!/usr/bin/env node

/**
 * Cron runner: send email report
 * Designed to run once daily at noon via launchd
 */

import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { sendEmailReport } from "./email-sender.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

async function main() {
  console.log(`\n[email] Starting at ${new Date().toLocaleString("sl-SI")}`);

  const config = await fs.readJson("./config.json");

  if (!config.email || !config.smtpHost) {
    console.log("Email not configured in config.json — skipping");
    return;
  }

  await sendEmailReport(config);
  console.log("[email] Done");
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
