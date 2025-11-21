import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs-extra";

// Add stealth plugin
chromium.use(StealthPlugin());

const config = await fs.readJson("./config.json");

const buildURL = (car) => {
  return `https://www.avto.net/Ads/results.asp?znamka=${car.brand}&model=${car.model}&modelID=&tip=katerikoli%20tip&znamka2=&model2=&tip2=katerikoli%20tip&znamka3=&model3=&tip3=katerikoli%20tip&cenaMin=${car.minPrice}&cenaMax=${car.maxPrice}&letnikMin=${car.minYear}&letnikMax=${car.maxYear}&bencin=0&starost2=999&oblika=0&ccmMin=0&ccmMax=99999&mocMin=&mocMax=&kmMin=0&kmMax=9999999&kwMin=0&kwMax=999&motortakt=&motorvalji=&lokacija=0&sirina=&dolzina=&dolzinaMIN=&dolzinaMAX=&nosilnostMIN=&nosilnostMAX=&sedezevMIN=&sedezevMAX=&lezisc=&presek=&premer=&col=&vijakov=&EToznaka=&vozilo=&airbag=&barva=&barvaint=&doseg=&BkType=&BkOkvir=&BkOkvirType=&Bk4=&EQ1=1000000000&EQ2=1000000000&EQ3=1000000000&EQ4=100000000&EQ5=1000000000&EQ6=1000000000&EQ7=1000000120&EQ8=101000000&EQ9=100000002&EQ10=100000000&KAT=1010000000&PIA=&PIAzero=&PIAOut=&PSLO=&akcija=&paketgarancije=&broker=&prikazkategorije=&kategorija=&ONLvid=&ONLnak=&zaloga=&arhiv=&presort=&tipsort=&stran=`;
};

const scrapeCarWithPage = async (page, car) => {

  const URL = buildURL(car);
  console.log(`\n🔍 Searching for ${car.brand} ${car.model}...`);

  // Navigate with longer timeout
  await page.goto(URL, { waitUntil: "load", timeout: 45000 });

  // Wait longer for the page to fully render and bypass any checks
  await page.waitForTimeout(5000);

  // Add some random mouse movements to appear more human
  await page.mouse.move(Math.random() * 100, Math.random() * 100);
  await page.waitForTimeout(500);
  await page.mouse.move(Math.random() * 200 + 100, Math.random() * 200 + 100);

  // Check if we got blocked by Cloudflare
  const pageContent = await page.content();
  if (pageContent.includes('Sorry you have been blocked') || pageContent.includes('Cloudflare')) {
    console.log(`⚠️ Blocked by Cloudflare for ${car.brand} ${car.model} - skipping`);
    return;
  }

  // Check if listings exist
  const count = await page.locator(".GO-Results-Row").count();
  if (count === 0) {
    console.log(`⚠️ No listings found for ${car.brand} ${car.model}`);
    return;
  }

  // Scroll to bottom to ensure all lazy-loaded results appear
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

  const scrapeTime = new Date().toISOString();

  const cars = await page.$$eval(".GO-Results-Row", (rows) =>
    rows.map((row) => {
      // Get all text content from the row
      const allText = row.innerText || '';

      // Extract year (format: MM/YYYY or just YYYY)
      const yearMatch = allText.match(/(\d{1,2}\/\d{4})/) || allText.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;

      // Extract kilometers (format: number km)
      const kmMatch = allText.match(/([\d.]+)\s*km/);
      const kilometers = kmMatch ? kmMatch[1] + ' km' : null;

      // Extract image URL
      const imgElement = row.querySelector('img');
      const titleImageUrl = imgElement ? imgElement.src : null;

      // Extract gearbox (ročni/avtomatski/polavtomatski)
      const gearboxMatch = allText.match(/(?:ročni|avtomatski|polavtomatski|avtomatik)/i);
      const gearbox = gearboxMatch ? gearboxMatch[0] : null;

      return {
        title: row.querySelector(".GO-Results-Naziv")?.innerText.trim() || null,
        price: row.querySelector(".GO-Results-Price")?.innerText.trim() || null,
        year: year,
        kilometers: kilometers,
        gearbox: gearbox,
        titleImageUrl: titleImageUrl,
        link: row.querySelector("a")?.href || null,
      };
    })
  );

  console.log(`✅ Found ${cars.length} listings for ${car.brand} ${car.model}`);
  await fs.ensureDir("output");
  const filename = `${car.brand.toLowerCase()}_${car.model.toLowerCase()}.json`;

  // Load existing data if available
  let existingCars = [];
  try {
    existingCars = await fs.readJson(`output/${filename}`);
  } catch (error) {
    // File doesn't exist yet, that's fine
  }

  // Create a map of existing cars by link (unique identifier)
  const existingMap = new Map();
  for (const existing of existingCars) {
    if (existing.link) {
      existingMap.set(existing.link, existing);
    }
  }

  // Update new cars with status and last_update
  const updatedCars = cars.map(car => {
    const existing = existingMap.get(car.link);
    return {
      ...car,
      status: 'active',
      first_seen: existing?.first_seen || scrapeTime,
      last_update: scrapeTime,
    };
  });

  // Create map of newly scraped links
  const newLinks = new Set(updatedCars.map(c => c.link));

  // Mark old cars as inactive if they weren't in the new scrape
  for (const [link, existingCar] of existingMap.entries()) {
    if (!newLinks.has(link)) {
      updatedCars.push({
        ...existingCar,
        status: 'inactive',
        // Keep the last_update from when it was last seen as active
      });
    }
  }

  await fs.writeJson(`output/${filename}`, updatedCars, { spaces: 2 });
  console.log(`💾 Saved results to output/${filename}`);
};

(async () => {
  // Stealth plugin handles most anti-detection automatically
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  // Create browser context with Slovenian settings
  const context = await browser.newContext({
    locale: 'sl-SI',
    timezoneId: 'Europe/Ljubljana',
  });

  for (let i = 0; i < config.cars.length; i++) {
    // Create a new page for each search
    const page = await context.newPage();

    try {
      await scrapeCarWithPage(page, config.cars[i]);
    } catch (error) {
      console.log(`❌ Error scraping ${config.cars[i].brand} ${config.cars[i].model}: ${error.message}`);
    } finally {
      await page.close();
    }

    // Add random delay between 3-7 seconds (except after the last car)
    if (i < config.cars.length - 1) {
      const delay = Math.floor(Math.random() * 4000) + 3000; // 3000-7000ms
      console.log(`⏳ Waiting ${(delay / 1000).toFixed(1)}s before next search...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  await context.close();
  await browser.close();
  console.log("\n✨ All scraping completed!");
})();
