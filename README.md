# Classic Hunt

Automated scraper for classic/cool cars on [Avto.net](https://www.avto.net) (Slovenian marketplace). Scrapes listings, generates LLM-powered summaries and personalized picks via Ollama, and sends daily email reports.

## Prerequisites

- **Node.js** v18+
- **Google Chrome** installed at `/Applications/Google Chrome.app`
- **Ollama** running locally with `mistral` model

```bash
ollama pull mistral
ollama serve
```

## Setup

```bash
npm install
bash setup.sh    # Installs dependencies + configures scheduled tasks
```

## Configuration

### `config.json`

```json
{
  "newListingDays": 1,
  "email": "you@gmail.com",
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "smtpUser": "you@gmail.com",
  "smtpPass": "your-16-char-app-password",
  "cars": [
    { "brand": "Audi", "model": "TT", "enabled": true },
    { "brand": "Fiat", "model": "500", "enabled": true, "maxYear": 2020 }
  ]
}
```

**Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-Step Verification), create an app password, paste it as `smtpPass`.

### `prompt-config.json`

LLM settings and prompt templates:

| Field | Description |
|---|---|
| `ollamaUrl` | Ollama API endpoint (default: `http://localhost:11434/api/generate`) |
| `ollamaModel` | Model name (default: `mistral`) |
| `timeoutSeconds` | LLM request timeout (default: `120`) |
| `picksMaxPrice` | Max price filter for recommendations (default: `6000`) |
| `comparisonPrompt` | Template for comparing two reports |
| `recommendationPrompt` | Template for top 5 car picks |

## Commands

### Run individually

```bash
npm run scrape       # Scraper only
npm run summarize    # LLM summary + top 5 picks (requires Ollama)
npm run email        # Send email report
npm run visualize    # Generate HTML visualization
```

### Run full pipeline

```bash
npm start            # Scrape → Visualize → Summarize → Email
```

### Cron runner

```bash
npm run cron:scrape  # Scrape + Visualize + Summarize (no email)
```

## Scheduled Tasks (launchd)

| Task | Schedule | Runner |
|---|---|---|
| Scrape + Summarize | Every 30 minutes | `com.classic-hunt.scrape.plist` |
| Email report | Daily at 12:00 | `com.classic-hunt.email.plist` |

### Install

```bash
bash setup.sh
```

### Status

```bash
launchctl list | grep classic-hunt
```

### Stop

```bash
launchctl unload ~/Library/LaunchAgents/com.classic-hunt.scrape.plist
launchctl unload ~/Library/LaunchAgents/com.classic-hunt.email.plist
```

### Restart

```bash
launchctl unload ~/Library/LaunchAgents/com.classic-hunt.scrape.plist
launchctl load ~/Library/LaunchAgents/com.classic-hunt.scrape.plist
```

### Logs

```bash
tail -f logs/scrape.log
tail -f logs/email.log
tail -f logs/scrape-error.log
```

## Output Files

```
output/
  audi_tt.json                     # Raw scraped data per model
  fiat_500.json
reports/
  report_2026-02-05T12-34-25.txt   # Full listing snapshot
  summary_2026-02-05.txt           # LLM comparison of last two reports
  picks_2026-02-05.txt             # LLM top 5 car recommendations
```

## Email Format

1. **Comparison summary** — what changed since the last scrape
2. **Full listing table** — all active cars grouped by model, with clickable links
3. **Top 5 Picks** — LLM-recommended cars matching your preferences

## Cloudflare Handling

The scraper uses a real Chrome instance (not headless) to avoid detection. If Cloudflare presents a challenge:

- Waits up to 2 minutes for manual solving
- On failure, retries up to 5 times with increasing backoff (10s, 20s, 30s...)
- If all retries fail for a model, skips it and continues with the rest
- Same retry logic applies to the homepage warmup

## License

For personal use only. Respect Avto.net's terms of service.
