import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs-extra";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = await fs.readJson("./config.json");

const PROFILE_DIR = path.join(__dirname, ".chrome-profile");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9222;

// Find a free port to avoid conflicts
const findFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

// Launch Chrome as a normal process (no Playwright hooks injected)
const launchChrome = async (port) => {
  await fs.ensureDir(PROFILE_DIR);

  // Check if Chrome is already running — macOS won't start a second instance
  const isRunning = await new Promise((resolve) => {
    const check = spawn("pgrep", ["-f", "Google Chrome"]);
    check.on("close", (code) => resolve(code === 0));
  });

  if (isRunning) {
    console.log("⚠️  Chrome is already running. Quitting it first...");
    await new Promise((resolve) => {
      const quit = spawn("osascript", [
        "-e",
        'tell application "Google Chrome" to quit',
      ]);
      quit.on("close", resolve);
    });
    // Wait for Chrome to fully quit
    await new Promise((r) => setTimeout(r, 2000));
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=*`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
  ];

  const chrome = spawn(CHROME_PATH, args, {
    detached: false,
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderrOutput = "";
  chrome.stderr.on("data", (data) => {
    stderrOutput += data.toString();
  });

  chrome.on("error", (err) => {
    console.error("Failed to launch Chrome:", err.message);
    process.exit(1);
  });

  chrome.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Chrome exited with code ${code}`);
      if (stderrOutput) console.error(stderrOutput.slice(0, 500));
    }
  });

  // Wait for the debug port to become available
  for (let i = 0; i < 30; i++) {
    const ready = await new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
    if (ready) return chrome;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.error("Chrome did not start in time.");
  if (stderrOutput) console.error("Chrome stderr:", stderrOutput.slice(0, 500));
  chrome.kill();
  process.exit(1);
};

const buildURL = (car) => {
  return `https://www.avto.net/Ads/results.asp?znamka=${car.brand}&model=${car.model}&modelID=&tip=katerikoli%20tip&znamka2=&model2=&tip2=katerikoli%20tip&znamka3=&model3=&tip3=katerikoli%20tip&cenaMin=${car.minPrice}&cenaMax=${car.maxPrice}&letnikMin=${car.minYear}&letnikMax=${car.maxYear}&bencin=0&starost2=999&oblika=0&ccmMin=0&ccmMax=99999&mocMin=&mocMax=&kmMin=0&kmMax=9999999&kwMin=0&kwMax=999&motortakt=&motorvalji=&lokacija=0&sirina=&dolzina=&dolzinaMIN=&dolzinaMAX=&nosilnostMIN=&nosilnostMAX=&sedezevMIN=&sedezevMAX=&lezisc=&presek=&premer=&col=&vijakov=&EToznaka=&vozilo=&airbag=&barva=&barvaint=&doseg=&BkType=&BkOkvir=&BkOkvirType=&Bk4=&EQ1=1000000000&EQ2=1000000000&EQ3=1000000000&EQ4=100000000&EQ5=1000000000&EQ6=1000000000&EQ7=1000000120&EQ8=101000000&EQ9=100000002&EQ10=100000000&KAT=1010000000&PIA=&PIAzero=&PIAOut=&PSLO=&akcija=&paketgarancije=&broker=&prikazkategorije=&kategorija=&ONLvid=&ONLnak=&zaloga=&arhiv=&presort=&tipsort=&stran=`;
};

class CloudflareError extends Error {
  constructor(label) {
    super(`Cloudflare challenge detected for ${label}`);
    this.name = "CloudflareError";
  }
}

const checkCloudflare = async (page, label) => {
  const content = await page.content();
  const blocked =
    content.includes("Sorry you have been blocked") ||
    content.includes("challenge-platform") ||
    (content.includes("Cloudflare") && content.includes("challenge"));

  if (blocked) {
    console.log(`\n⚠️  Cloudflare challenge detected for ${label}`);
    throw new CloudflareError(label);
  }
  return true;
};

const scrapeCarWithPage = async (page, car) => {
  const URL = buildURL(car);
  const label = `${car.brand} ${car.model}`;
  console.log(`\n🔍 Searching for ${label}...`);

  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));

  await checkCloudflare(page, label);

  const count = await page.locator(".GO-Results-Row").count();
  if (count === 0) {
    console.log(`⚠️  No listings found for ${car.brand} ${car.model}`);
    return;
  }

  // Scroll to bottom to load all lazy-loaded results
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 400);
    });
  });

  await new Promise((r) => setTimeout(r, 1000));
  const scrapeTime = new Date().toISOString();

  const cars = await page.$$eval(".GO-Results-Row", (rows) =>
    rows.map((row) => {
      const allText = row.innerText || "";

      const yearMatch =
        allText.match(/(\d{1,2}\/\d{4})/) || allText.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;

      const kmMatch = allText.match(/([\d.]+)\s*km/);
      const kilometers = kmMatch ? kmMatch[1] + " km" : null;

      const imgElement = row.querySelector("img");
      const titleImageUrl = imgElement ? imgElement.src : null;

      const gearboxMatch = allText.match(
        /(?:ročni|avtomatski|polavtomatski|avtomatik)/i
      );
      const gearbox = gearboxMatch ? gearboxMatch[0] : null;

      const hpMatch = allText.match(/(\d+)\s*(?:KM|kM|HP|hp|KS|ks|konji)/);
      const hp = hpMatch ? hpMatch[1] + " HP" : null;

      const fuelMatch = allText.match(
        /(?:bencin|diesel|dizel|plin|elektr|hybrid|hibrid|LPG|CNG)/i
      );
      const fuel = fuelMatch ? fuelMatch[0] : null;

      const colorMatch = allText.match(
        /(?:bela|črna|siva|srebrna|rdeča|modra|zelena|rumena|oranžna|rjava|bež|vijolična|bordo|grafitna|antracitna|zlatna|temno\s*(?:modra|siva|zelena|rdeča)|svetlo\s*(?:modra|siva|zelena))/i
      );
      const color = colorMatch ? colorMatch[0] : null;

      // Slovenian phone numbers: 0X0 XXX XXX, 0X XXX XX XX, +386 ...
      const phoneMatch = allText.match(
        /(?:\+386[\s-]?\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|0[1-7]\d[\s-]?\d{3}[\s-]?\d{3}|0[1-7][\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})/
      );
      const phone = phoneMatch ? phoneMatch[0].trim() : null;

      return {
        title:
          row.querySelector(".GO-Results-Naziv")?.innerText.trim() || null,
        price:
          (() => {
            let p = row.querySelector(".GO-Results-Price")?.innerText.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim() || null;
            if (p && p.startsWith("AKCIJSKA CENA")) {
              const prices = p.match(/[\d.]+\s*€/g);
              if (prices && prices.length > 1) p = prices[prices.length - 1].trim();
            } else if (p && p.includes("oz.")) {
              const prices = p.match(/[\d.]+\s*€/g);
              if (prices && prices.length > 0) p = prices[0].trim();
            }
            return p;
          })(),
        year,
        kilometers,
        hp,
        gearbox,
        fuel,
        color,
        phone,
        titleImageUrl,
        link: row.querySelector("a")?.href || null,
      };
    })
  );

  console.log(`✅ Found ${cars.length} listings for ${car.brand} ${car.model}`);
  await fs.ensureDir("output");
  const filename = `${car.brand.toLowerCase()}_${car.model.toLowerCase()}.json`;

  let existingCars = [];
  try {
    existingCars = await fs.readJson(`output/${filename}`);
  } catch (error) {
    // File doesn't exist yet
  }

  const existingMap = new Map();
  for (const existing of existingCars) {
    if (existing.link) {
      existingMap.set(existing.link, existing);
    }
  }

  const updatedCars = cars.map((car) => {
    const existing = existingMap.get(car.link);
    return {
      ...car,
      status: "active",
      first_seen: existing?.first_seen || scrapeTime,
      last_update: scrapeTime,
    };
  });

  const newLinks = new Set(updatedCars.map((c) => c.link));
  for (const [link, existingCar] of existingMap.entries()) {
    if (!newLinks.has(link)) {
      updatedCars.push({
        ...existingCar,
        status: "inactive",
      });
    }
  }

  await fs.writeJson(`output/${filename}`, updatedCars, { spaces: 2 });
  console.log(`💾 Saved results to output/${filename}`);
};

const MAX_RESTARTS = 5;

async function runScrapeSession() {
  const port = await findFreePort();
  console.log("🚗 Classic Hunt - launching Chrome...");
  console.log(`   Profile: ${PROFILE_DIR}`);
  console.log(`   Debug port: ${port}\n`);

  const chromeProcess = await launchChrome(port);
  console.log("✅ Chrome launched, connecting via CDP...");

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  console.log(`   Contexts: ${browser.contexts().length}`);

  const context = browser.contexts()[0];
  if (!context) {
    console.error("❌ No browser context found. Exiting.");
    chromeProcess.kill();
    throw new Error("No browser context");
  }

  console.log(`   Pages in context: ${context.pages().length}`);

  let page = context.pages()[0];
  if (!page) {
    console.log("   No existing page, creating one...");
    page = await context.newPage();
  }
  console.log(`   Page URL: ${page.url()}`);

  try {
    // Warm up: visit homepage first
    console.log("\n🏠 Visiting homepage...");
    try {
      await page.goto("https://www.avto.net", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (err) {
      console.log(`   goto error: ${err.message}`);
    }
    console.log(`   Page loaded: ${page.url()}`);
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));

    await checkCloudflare(page, "homepage");
    console.log("✅ Homepage OK\n");

    // Filter enabled cars and apply defaults
    const enabledCars = config.cars
      .filter((c) => c.enabled !== false)
      .map((c) => ({
        brand: c.brand,
        model: c.model,
        minPrice: c.minPrice ?? 0,
        maxPrice: c.maxPrice ?? 999999,
        minYear: c.minYear ?? 0,
        maxYear: c.maxYear ?? 2090,
      }));

    console.log(`🚗 Scraping ${enabledCars.length}/${config.cars.length} enabled models\n`);

    for (let i = 0; i < enabledCars.length; i++) {
      await scrapeCarWithPage(page, enabledCars[i]);

      if (i < enabledCars.length - 1) {
        const delay = Math.floor(Math.random() * 5000) + 5000;
        console.log(
          `⏳ Waiting ${(delay / 1000).toFixed(1)}s before next search...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } finally {
    await browser.close();
    chromeProcess.kill();
  }
}

(async () => {
  const scrapeStarted = new Date();
  for (let attempt = 1; attempt <= MAX_RESTARTS; attempt++) {
    try {
      await runScrapeSession();
      break; // success — exit loop
    } catch (err) {
      if (err instanceof CloudflareError && attempt < MAX_RESTARTS) {
        const wait = attempt * 30;
        console.log(`\n🔄 Restarting Chrome (attempt ${attempt}/${MAX_RESTARTS}) in ${wait}s...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        console.error(`\n❌ ${err.message}`);
        if (attempt >= MAX_RESTARTS) {
          console.error("All restart attempts failed. Exiting.");
          process.exit(1);
        }
        throw err;
      }
    }
  }

  // Generate report
  console.log("\n📝 Generating report...");
  const outputDir = "./output";
  const files = await fs.readdir(outputDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  // Only include cars that are enabled in the config
  const enabledFiles = new Set(
    config.cars
      .filter((c) => c.enabled !== false)
      .map((c) => `${c.brand.toLowerCase()}_${c.model.toLowerCase()}.json`)
  );

  let allAds = [];
  for (const file of jsonFiles) {
    if (!enabledFiles.has(file)) continue;
    const data = await fs.readJson(path.join(outputDir, file));
    const [brand, model] = file.replace(".json", "").split("_");
    const modelName = `${brand.charAt(0).toUpperCase() + brand.slice(1)} ${model.toUpperCase()}`;
    for (const car of data) {
      if (car.status === "active") {
        allAds.push({ ...car, modelName });
      }
    }
  }

  // Parse price string to number (e.g. "24.000 €" -> 24000)
  const parsePrice = (p) => {
    if (!p) return Infinity;
    const digits = p.replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : Infinity;
  };

  // Sort by model name, then by price numerically
  allAds.sort((a, b) => {
    const modelCmp = a.modelName.localeCompare(b.modelName);
    if (modelCmp !== 0) return modelCmp;
    return parsePrice(a.price) - parsePrice(b.price);
  });

  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  await fs.ensureDir("reports");
  const reportName = `reports/report_${timestamp}.txt`;

  let report = `Classic Hunt Report - ${now.toLocaleString("sl-SI")}\n`;
  report += `Scraped: ${scrapeStarted.toISOString()}\n`;
  report += `Active listings: ${allAds.length}\n`;
  report += "=".repeat(120) + "\n\n";

  let currentModel = "";
  for (const ad of allAds) {
    if (ad.modelName !== currentModel) {
      currentModel = ad.modelName;
      report += `--- ${currentModel} ---\n`;
    }
    const parts = [
      ad.price || "N/A",
      ad.title || "N/A",
      ad.year || "N/A",
      ad.kilometers || "N/A",
      ad.hp || "N/A",
      ad.fuel || "N/A",
      ad.gearbox || "N/A",
      ad.color || "N/A",
      ad.phone || "N/A",
      ad.link || "",
    ];
    report += parts.join(" | ") + "\n";
  }

  await fs.writeFile(reportName, report);
  console.log(`✅ Report saved to ${reportName}`);

  console.log("\n✨ All done!");
})();
