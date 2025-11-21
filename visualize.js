import fs from "fs-extra";
import path from "path";

const outputDir = "./output";
const htmlFile = "./results.html";
const config = await fs.readJson("./config.json");
const newListingDays = config.newListingDays || 3;

const isNewListing = (firstSeen) => {
  if (!firstSeen) return false;
  const daysAgo = (Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo <= newListingDays;
};

// Read all JSON files from output directory
const files = await fs.readdir(outputDir);
const jsonFiles = files.filter(f => f.endsWith(".json"));

let allCars = [];

for (const file of jsonFiles) {
  const data = await fs.readJson(path.join(outputDir, file));
  const [brand, model] = file.replace(".json", "").split("_");

  // Filter only active listings and sort by price (low to high)
  const activeCars = data.filter(car => car.status !== 'inactive');
  const sortedCars = activeCars.sort((a, b) => {
    const priceA = parseFloat(a.price?.replace(/[^0-9.]/g, '') || '999999999');
    const priceB = parseFloat(b.price?.replace(/[^0-9.]/g, '') || '999999999');
    return priceA - priceB;
  });

  allCars.push({
    brand: brand.charAt(0).toUpperCase() + brand.slice(1),
    model: model.toUpperCase(),
    cars: sortedCars
  });
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Avto.net Results</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #fafafa;
      padding: 30px 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    h1 {
      color: #333;
      margin-bottom: 30px;
      font-size: 2em;
    }

    .brand-section {
      margin-bottom: 50px;
    }

    .brand-header {
      color: #333;
      padding: 0 0 16px 0;
      border-bottom: 1px solid #e0e0e0;
      font-size: 1.1em;
      font-weight: 500;
      letter-spacing: 0.3px;
    }

    .cars-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
      padding: 20px 0;
    }

    .car-card {
      border: 1px solid #f0f0f0;
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.3s ease;
      background: white;
      display: flex;
      flex-direction: column;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .car-card.new-listing {
      background: #fffde7;
      border-color: #fff59d;
    }

    .car-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      border-color: #e0e0e0;
    }

    .car-image {
      display: block;
      background: #f8f8f8;
      align-self: center;
      margin: 12px;
    }

    .car-content {
      padding: 0 12px 12px 12px;
    }

    .car-title {
      font-size: 0.8em;
      font-weight: 500;
      color: #1a1a1a;
      margin-bottom: 10px;
      line-height: 1.4;
    }

    .car-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 0;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.7em;
      padding: 3px 0;
    }

    .info-label {
      color: #999;
      font-weight: 400;
      text-transform: uppercase;
      font-size: 0.9em;
      letter-spacing: 0.3px;
    }

    .info-value {
      color: #333;
      font-weight: 500;
    }

    .price {
      color: #0066ff;
      font-size: 1em;
      font-weight: 600;
    }

    .car-title-link {
      text-decoration: none;
      color: inherit;
      display: block;
    }

    .car-title-link:hover .car-title {
      color: #0066ff;
    }

    .car-image {
      cursor: pointer;
      transition: all 0.3s ease;
    }

    a:hover .car-image {
      opacity: 0.9;
      transform: scale(1.02);
    }

    .no-results {
      padding: 40px;
      text-align: center;
      color: #999;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    ${allCars.map(group => `
      <div class="brand-section">
        <div class="brand-header">
          ${group.brand} ${group.model} <span style="opacity: 0.7; font-size: 0.85em;">(${group.cars.length} listing${group.cars.length !== 1 ? 's' : ''})</span>
        </div>
        ${group.cars.length > 0 ? `
          <div class="cars-grid">
            ${group.cars.map(car => `
              <div class="car-card${isNewListing(car.first_seen) ? ' new-listing' : ''}">
                ${car.titleImageUrl ? `<a href="${car.link || '#'}" target="_blank"><img src="${car.titleImageUrl}" alt="${car.title || 'Car'}" class="car-image"></a>` : ''}
                <div class="car-content">
                  <a href="${car.link || '#'}" target="_blank" class="car-title-link"><div class="car-title">${car.title || 'N/A'}</div></a>
                  <div class="car-info">
                    <div class="info-row">
                      <span class="info-label">Price:</span>
                      <span class="info-value price">${car.price || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Year:</span>
                      <span class="info-value">${car.year || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Kilometers:</span>
                      <span class="info-value">${car.kilometers || 'N/A'}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Gearbox:</span>
                      <span class="info-value">${car.gearbox || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div class="no-results">No results found</div>'}
      </div>
    `).join('')}
  </div>
</body>
</html>`;

await fs.writeFile(htmlFile, html);
console.log(`✅ HTML visualization created: ${htmlFile}`);
