# Avto.net Scraper

A web scraper for collecting car listings from Avto.net (Slovenia's largest car marketplace).

## Features

- Scrapes multiple car brands/models based on configuration
- Extracts: title, price, year, kilometers, gearbox type, and image URL
- Saves results to JSON files
- Generates an HTML visualization of results
- Includes anti-detection measures to avoid bot blocking

## Installation

```bash
npm install
```

## Configuration

Edit `config.json` to specify which cars to scrape:

```json
{
  "cars": [
    {
      "brand": "Saab",
      "model": "900",
      "minPrice": 0,
      "maxPrice": 999999,
      "minYear": 0,
      "maxYear": 2090
    }
  ]
}
```

## Usage

### Scrape car listings

```bash
node scraper.js
```

Results are saved to `output/` directory as JSON files (e.g., `saab_900.json`).

### Visualize results

```bash
node visualize.js
```

Opens `results.html` showing all scraped listings with images, sorted by price.

## Important Usage Guidelines

⚠️ **CLOUDFLARE PROTECTION**: Avto.net uses Cloudflare to protect against bots. To avoid being blocked:

### Best Practices

1. **Run scraper MAXIMUM once per day**
   - More frequent runs will trigger Cloudflare blocking
   - If blocked, wait 24-48 hours before trying again

2. **Limit number of cars**
   - Scrape 2-3 car models maximum per run
   - Too many searches in one session triggers blocking

3. **Add delays between runs**
   - Built-in random delays (3-7 seconds) between car searches
   - Don't run the scraper multiple times in quick succession

4. **If you get blocked**
   - You'll see: `⚠️ Blocked by Cloudflare`
   - Wait 24-48 hours before running again
   - Try from a different network/IP if urgent
   - Manual browsing on Avto.net still works during blocks

### What Gets Scraped

Each car listing includes:
- `title` - Car model and variant
- `price` - Listing price
- `year` - Year of first registration
- `kilometers` - Total kilometers driven
- `gearbox` - Transmission type (ročni/avtomatski)
- `titleImageUrl` - Thumbnail image URL
- `link` - URL to full listing
- `ts` - Timestamp when scraped (ISO 8601 format)

## File Structure

```
avtonet-scraper/
├── config.json          # Car search configuration
├── scraper.js           # Main scraper
├── visualize.js         # HTML generator
├── output/              # Scraped JSON files
├── results.html         # Generated visualization
└── README.md           # This file
```

## Troubleshooting

### "Blocked by Cloudflare"
- **Cause**: Too many requests or automated behavior detected
- **Solution**: Wait 24-48 hours, then reduce scraping frequency

### "No listings found"
- **Cause**: Either genuinely no results, or Cloudflare blocking
- **Solution**: Check the URL manually in a browser to confirm listings exist

### Scraper times out
- **Cause**: Slow network or page taking too long to load
- **Solution**: Increase timeout in scraper.js (line 16: `timeout: 45000`)

## Technical Details

- Built with Playwright (Chromium)
- Uses anti-detection techniques:
  - Slovenian locale and timezone
  - Randomized mouse movements
  - Realistic viewport and headers
  - Navigator.webdriver override
- Random delays between 3-7 seconds per car search
- Handles pagination automatically (first page only)

## Limitations

- Only scrapes the first page of results (~20-30 listings per search)
- Cannot bypass aggressive Cloudflare protection
- Requires waiting periods between runs
- Some fields (color, interior) not available in search results

## License

For personal use only. Respect Avto.net's terms of service and rate limits.
