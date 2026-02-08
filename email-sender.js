import nodemailer from "nodemailer";
import fs from "fs-extra";
import path from "path";

const reportsDir = "./reports";

function getLatestSummary() {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("summary_") && f.endsWith(".txt"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const raw = fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
  // Strip the header lines (title, model, separator) — keep only the LLM output
  const lines = raw.split("\n");
  const sepIdx = lines.findIndex((l) => /^={5,}/.test(l));
  return sepIdx >= 0 ? lines.slice(sepIdx + 1).join("\n").trim() : raw.trim();
}

function getLatestPicks() {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("picks_") && f.endsWith(".txt"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const raw = fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
  const lines = raw.split("\n");
  const sepIdx = lines.findIndex((l) => /^={5,}/.test(l));
  return sepIdx >= 0 ? lines.slice(sepIdx + 1).join("\n").trim() : raw.trim();
}

function getLatestReport() {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("report_") && f.endsWith(".txt"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
}

function extractScrapeTime(reportText) {
  const match = reportText.match(/^Scraped:\s*(.+)$/m);
  if (!match) return null;
  const d = new Date(match[1].trim());
  if (isNaN(d)) return null;
  return d.toLocaleString("sl-SI", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getNewListingUrls() {
  if (!fs.existsSync(reportsDir)) return new Set();
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.endsWith("_new.txt"))
    .sort()
    .reverse();
  if (files.length === 0) return new Set();
  const content = fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
  const urls = new Set();
  for (const line of content.split("\n")) {
    const match = line.match(/(https?:\/\/\S+)/);
    if (match) urls.add(match[1]);
  }
  return urls;
}

function parseReport(reportText) {
  const groups = [];
  let currentGroup = null;
  const headerMatch = reportText.match(/^(.+)\nActive listings: (\d+)/);
  const totalActive = headerMatch ? parseInt(headerMatch[2]) : 0;
  const reportDate = headerMatch ? headerMatch[1].replace("Classic Hunt Report - ", "") : "";

  for (const line of reportText.split("\n")) {
    const groupMatch = line.match(/^--- (.+) ---$/);
    if (groupMatch) {
      currentGroup = { name: groupMatch[1], cars: [] };
      groups.push(currentGroup);
      continue;
    }
    if (currentGroup && line.trim() && !line.startsWith("Classic Hunt") && !line.startsWith("Active listings") && !line.startsWith("===")) {
      // Parse: price | title | year | km | hp | fuel | gearbox | color | phone | url
      const parts = line.split(" | ");
      if (parts.length >= 8) {
        currentGroup.cars.push({
          price: parts[0].trim(),
          title: parts[1].trim(),
          year: parts[2].trim(),
          km: parts[3].trim(),
          hp: parts[4].trim(),
          fuel: parts[5].trim(),
          gearbox: parts[6].trim(),
          color: parts.length >= 10 ? parts[7].trim() : "N/A",
          phone: parts.length >= 10 ? parts[8].trim() : parts[7].trim(),
          url: parts[parts.length - 1].trim(),
        });
      }
    }
  }
  return { groups, totalActive, reportDate };
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendEmailReport(config) {
  const { email, smtpHost, smtpPort, smtpUser, smtpPass } = config;

  const date = new Date().toLocaleDateString("sl-SI", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const llmSummary = getLatestSummary();
  const llmPicks = getLatestPicks();
  const fullReport = getLatestReport();
  const scrapeTime = fullReport ? extractScrapeTime(fullReport) : null;
  const parsed = fullReport ? parseReport(fullReport) : null;
  const totalActive = parsed ? parsed.totalActive : 0;
  const newUrls = getNewListingUrls();

  // --- Plain text version ---
  let textContent = `Classic Hunt - ${date}\n`;
  if (scrapeTime) {
    textContent += `Data scraped: ${scrapeTime}\n`;
  }
  textContent += `${"=".repeat(50)}\n\n`;

  if (llmSummary) {
    textContent += llmSummary + "\n\n";
    textContent += `${"=".repeat(50)}\n\n`;
  }

  if (parsed) {
    textContent += `${totalActive} active listings\n\n`;
    for (const group of parsed.groups) {
      textContent += `--- ${group.name} (${group.cars.length}) ---\n`;
      for (const car of group.cars) {
        const isNew = newUrls.has(car.url);
        const details = [car.hp, car.fuel, car.gearbox, car.color]
          .filter((v) => v && v !== "N/A")
          .join(" | ");
        textContent += `  ${isNew ? "[NEW] " : ""}${car.price} | ${car.title} | ${car.year} | ${car.km} | ${details}\n`;
        textContent += `  ${car.url}\n\n`;
      }
    }
  }

  if (llmPicks) {
    textContent += `${"=".repeat(50)}\n`;
    textContent += `TOP 5 PICKS FOR YOU\n`;
    textContent += `${"=".repeat(50)}\n\n`;
    textContent += llmPicks + "\n\n";
  }

  // --- HTML version ---
  let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; background: #f5f5f5; margin: 0; }
    .container { max-width: 700px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; }
    h1 { color: #333; font-size: 22px; margin: 0 0 4px 0; }
    .date { color: #888; font-size: 14px; margin-bottom: 16px; }
    .llm-box { background: #f0f7ff; border-left: 4px solid #0066ff; padding: 14px 16px; border-radius: 4px; margin-bottom: 24px; font-size: 14px; line-height: 1.6; color: #333; }
    .stats { color: #666; font-size: 14px; margin-bottom: 20px; }
    .group { margin-bottom: 24px; }
    .group-name { font-size: 16px; font-weight: 700; color: #222; padding: 8px 0; border-bottom: 2px solid #0066ff; margin-bottom: 8px; }
    .group-name span { font-weight: 400; color: #888; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #888; font-weight: 500; font-size: 11px; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #eee; }
    td { padding: 8px; border-bottom: 1px solid #f3f3f3; color: #333; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .price-cell { font-weight: 600; color: #0066ff; white-space: nowrap; }
    .title-cell a { color: #333; text-decoration: none; }
    .title-cell a:hover { color: #0066ff; text-decoration: underline; }
    .meta { color: #888; font-size: 12px; }
    tr.new-listing td { background: #fffde7; }
    .new-badge { display: inline-block; background: #f9a825; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
    .picks-title { font-size: 18px; font-weight: 700; color: #222; margin-top: 30px; padding: 8px 0; border-bottom: 2px solid #e8a000; margin-bottom: 12px; }
    .picks-box { background: #fffbf0; border-left: 4px solid #e8a000; padding: 14px 16px; border-radius: 4px; font-size: 14px; line-height: 1.8; color: #333; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Classic Hunt</h1>
    <div class="date">${date}</div>
${scrapeTime ? `    <div class="date" style="margin-top: -4px;">Data scraped: ${escapeHtml(scrapeTime)}</div>\n` : ""}
`;

  if (llmSummary) {
    htmlContent += `    <div class="llm-box">${escapeHtml(llmSummary).replace(/\n/g, "<br>")}</div>\n`;
  }

  if (parsed) {
    htmlContent += `    <div class="stats"><strong>${totalActive}</strong> active listings</div>\n`;

    for (const group of parsed.groups) {
      htmlContent += `
    <div class="group">
      <div class="group-name">${escapeHtml(group.name)} <span>(${group.cars.length})</span></div>
      <table>
        <tr><th>Price</th><th>Car</th><th>Year</th><th>Km</th><th>Details</th></tr>
`;
      for (const car of group.cars) {
        const isNew = newUrls.has(car.url);
        const details = [car.hp, car.fuel, car.gearbox, car.color]
          .filter((v) => v && v !== "N/A")
          .join(" | ");
        const badge = isNew ? `<span class="new-badge">NEW</span>` : "";
        htmlContent += `        <tr${isNew ? ` class="new-listing"` : ""}>
          <td class="price-cell">${escapeHtml(car.price)}</td>
          <td class="title-cell">${badge}<a href="${escapeHtml(car.url)}">${escapeHtml(car.title)}</a></td>
          <td>${escapeHtml(car.year)}</td>
          <td>${escapeHtml(car.km)}</td>
          <td class="meta">${escapeHtml(details)}</td>
        </tr>\n`;
      }
      htmlContent += `      </table>
    </div>`;
    }
  }

  if (llmPicks) {
    // Turn each pick line into HTML with the URL hidden under the car name
    const picksHtml = llmPicks.split("\n").map((line) => {
      const urlMatch = line.match(/(https?:\/\/\S+)/);
      if (!urlMatch) return escapeHtml(line);
      const url = urlMatch[1];
      // Remove the raw URL from the line
      const cleanLine = line.replace(url, "").replace(/\s*—\s*$/, "").trimEnd();
      // Find the car name: text after "1. " etc, before the first " — "
      const numMatch = cleanLine.match(/^(\d+\.\s*)(.+?)(\s*—\s*.*)$/);
      if (numMatch) {
        return `${escapeHtml(numMatch[1])}<a href="${escapeHtml(url)}">${escapeHtml(numMatch[2])}</a>${escapeHtml(numMatch[3])}`;
      }
      return `<a href="${escapeHtml(url)}">${escapeHtml(cleanLine)}</a>`;
    }).join("<br>");

    htmlContent += `
    <div class="picks-title">Top 5 Picks For You</div>
    <div class="picks-box">${picksHtml}</div>`;
  }

  htmlContent += `
  </div>
</body>
</html>
`;

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  // Send email
  const info = await transporter.sendMail({
    from: smtpUser,
    to: email,
    subject: `Classic Hunt: ${totalActive} listings - ${date}`,
    text: textContent,
    html: htmlContent,
  });

  console.log(`\n📧 Email sent: ${info.messageId}`);
  return info;
}
