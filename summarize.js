#!/usr/bin/env node

/**
 * Summarize reports using a local Ollama LLM (mistral model).
 * Produces two outputs:
 *   - summary_YYYY-MM-DD.txt  (comparison or single-report summary)
 *   - picks_YYYY-MM-DD.txt    (top 5 car recommendations)
 * Works as standalone (node summarize.js) and as importable module.
 */

import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPromptConfig() {
  const configPath = join(__dirname, "prompt-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "prompt-config.json not found. Create it with ollamaUrl, ollamaModel, and prompt templates."
    );
  }
  return fs.readJsonSync(configPath);
}

function getLastTwoReports() {
  const reportsDir = join(__dirname, "reports");
  if (!fs.existsSync(reportsDir)) {
    throw new Error("No reports/ directory found.");
  }

  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("report_") && f.endsWith(".txt"))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error("No reports found in reports/ directory.");
  }

  const latest = {
    name: files[0],
    content: fs.readFileSync(join(reportsDir, files[0]), "utf-8"),
  };

  let previous = null;
  if (files.length >= 2) {
    previous = {
      name: files[1],
      content: fs.readFileSync(join(reportsDir, files[1]), "utf-8"),
    };
  }

  return { latest, previous };
}

function extractDateFromFilename(filename) {
  const match = filename.match(/report_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.txt/);
  if (match) {
    return `${match[1]} ${match[2]}:${match[3]}:${match[4]}`;
  }
  return filename;
}

function buildPrompt(template, latest, previous, config) {
  const maxChars = config.maxReportChars || 15000;

  let latestContent = latest.content;
  if (latestContent.length > maxChars) {
    latestContent = latestContent.slice(0, maxChars) + "\n... [truncated]";
  }

  let result = template
    .replace("{{LATEST_REPORT}}", latestContent)
    .replace("{{LATEST_DATE}}", extractDateFromFilename(latest.name));

  if (previous) {
    let previousContent = previous.content;
    if (previousContent.length > maxChars) {
      previousContent = previousContent.slice(0, maxChars) + "\n... [truncated]";
    }
    result = result
      .replace("{{PREVIOUS_REPORT}}", previousContent)
      .replace("{{PREVIOUS_DATE}}", extractDateFromFilename(previous.name));
  }

  return result;
}

async function callOllama(prompt, config) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    (config.timeoutSeconds || 120) * 1000
  );

  try {
    const response = await fetch(config.ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${config.timeoutSeconds || 120} seconds.`);
    }
    if (err.cause?.code === "ECONNREFUSED") {
      throw new Error(
        "Could not connect to Ollama. Is it running? Start it with: ollama serve"
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function filterByPrice(reportContent, maxPrice) {
  const lines = reportContent.split("\n");
  const filtered = [];
  let currentGroup = null;
  let groupLines = [];

  function flushGroup() {
    if (currentGroup && groupLines.length > 0) {
      filtered.push(currentGroup);
      filtered.push(...groupLines);
    }
    groupLines = [];
  }

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      flushGroup();
      currentGroup = line;
      continue;
    }
    if (line.startsWith("Classic Hunt") || line.startsWith("Active listings") || line.startsWith("===")) {
      flushGroup();
      currentGroup = null;
      filtered.push(line);
      continue;
    }
    if (!currentGroup || !line.trim()) continue;

    // Extract price: first segment before " | ", parse leading number
    const priceStr = line.split(" | ")[0].trim();
    const priceMatch = priceStr.match(/^[\d.,]+/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[0].replace(/\./g, "").replace(",", "."));
      if (price <= maxPrice) {
        groupLines.push(line);
      }
    }
    // Skip lines without a numeric price (e.g. "Pokličite za ceno")
  }
  flushGroup();

  // Update active listings count
  const carLines = filtered.filter((l) => l.includes(" | ") && !l.startsWith("==="));
  const result = filtered.join("\n").replace(
    /Active listings: \d+/,
    `Active listings: ${carLines.length}`
  );
  return result;
}

function extractUrlsFromReport(reportContent) {
  const urls = new Set();
  for (const line of reportContent.split("\n")) {
    if (!line.includes(" | ")) continue;
    const match = line.match(/(https?:\/\/\S+)/);
    if (match) urls.add(match[1]);
  }
  return urls;
}

function extractTimestampFromFilename(filename) {
  const match = filename.match(/report_(.+)\.txt/);
  return match ? match[1] : filename;
}

function diffReports(latest, previous) {
  const prevUrls = extractUrlsFromReport(previous.content);
  const newListings = [];

  for (const line of latest.content.split("\n")) {
    if (!line.includes(" | ")) continue;
    const match = line.match(/(https?:\/\/\S+)/);
    if (match && !prevUrls.has(match[1])) {
      newListings.push(line);
    }
  }

  return newListings;
}

function makeHeader(title, model) {
  const now = new Date();
  return `${title} - ${now.toLocaleString("sl-SI")}\nModel: ${model}\n${"=".repeat(60)}\n\n`;
}

export async function generateSummary() {
  const config = loadPromptConfig();
  const { latest, previous } = getLastTwoReports();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // --- 1. Comparison summary (only when two reports exist) ---
  let summaryPath = null;
  if (previous) {
    console.log(`Comparing reports:`);
    console.log(`  Previous: ${previous.name}`);
    console.log(`  Latest:   ${latest.name}`);

    const summaryPrompt = buildPrompt(config.comparisonPrompt, latest, previous, config);
    console.log(`Calling Ollama (${config.ollamaModel}) for comparison...`);
    const summary = await callOllama(summaryPrompt, config);

    summaryPath = join(__dirname, "reports", `summary_${dateStr}.txt`);
    await fs.writeFile(summaryPath, makeHeader("Classic Hunt LLM Summary", config.ollamaModel) + summary);
    console.log(`Summary saved to: ${summaryPath}`);
  } else {
    console.log(`Only one report found — skipping comparison`);
  }

  // --- 1b. Programmatic diff: new listings ---
  let diffPath = null;
  if (previous) {
    const newListings = diffReports(latest, previous);
    const prevTs = extractTimestampFromFilename(previous.name);
    const latestTs = extractTimestampFromFilename(latest.name);
    diffPath = join(__dirname, "reports", `${prevTs}_${latestTs}_new.txt`);

    if (newListings.length > 0) {
      const diffContent = `New listings: ${newListings.length}\n` +
        `Previous: ${previous.name}\n` +
        `Latest: ${latest.name}\n` +
        `${"=".repeat(80)}\n\n` +
        newListings.join("\n") + "\n";
      await fs.writeFile(diffPath, diffContent);
      console.log(`${newListings.length} new listing(s) saved to: ${diffPath}`);
    } else {
      await fs.writeFile(diffPath, `No new listings.\nPrevious: ${previous.name}\nLatest: ${latest.name}\n`);
      console.log(`No new listings between reports.`);
    }
  }

  // --- 2. Top 5 picks (budget-filtered) ---
  const maxPrice = config.picksMaxPrice || 6000;
  const filteredContent = filterByPrice(latest.content, maxPrice);
  const filteredLatest = { name: latest.name, content: filteredContent };
  const carCount = (filteredContent.match(/ \| /g) || []).length;
  console.log(`Filtered to ${carCount} listings under ${maxPrice} EUR for picks`);
  const picksPrompt = buildPrompt(config.recommendationPrompt, filteredLatest, null, config);
  console.log(`Calling Ollama (${config.ollamaModel}) for picks...`);
  const picks = await callOllama(picksPrompt, config);

  const picksPath = join(__dirname, "reports", `picks_${dateStr}.txt`);
  await fs.writeFile(picksPath, makeHeader("Classic Hunt Top Picks", config.ollamaModel) + picks);
  console.log(`Picks saved to: ${picksPath}`);

  return { summaryPath, picksPath, diffPath };
}

// Run standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSummary()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\nError: ${err.message}`);
      process.exit(1);
    });
}
