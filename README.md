# Infinite Ascent — Market Timer

A live dashboard for the world's major stock exchanges: countdowns to each
market's open/close relative to *your* device's local time, live interactive
index charts, a triangulated FX cross-rate matrix, and a real-time financial
news ticker — all built on free, unauthenticated data sources, no API keys
required.

It started as a "when do markets open" clock and grew into a small
Bloomberg-terminal-adjacent dashboard: dark system-color UI with frosted-glass
materials, a classic scrolling news ticker, and live/health indicators
throughout so you can tell at a glance whether the underlying data is
actually current.

## Features

- **11 major exchanges**, each with a live open/closed status and a
  second-by-second countdown to the next open or close, computed entirely in
  the browser from the exchange's real trading-hours timezone — not a fixed
  UTC offset, so it stays correct across daylight saving transitions.
- **22 live index charts** (two headline indexes per exchange) using
  TradingView's `lightweight-charts` — pan by dragging, zoom the time axis
  with scroll/pinch, hover to read the exact price at any point on the
  curve, switch between 1D/5D/1M/6M/1Y ranges, and a colored marker plus a
  colored last-value label show at a glance whether each index is up or down
  on the day.
- **FX cross-rate matrix**, Bloomberg FXC-style: 13 currencies on both axes,
  every cell showing how much of the column currency buys one unit of the
  row currency, with a colored trend arrow and a tick-flash on update. Rather
  than fetching all 169 possible pairs, the backend fetches each currency's
  rate against USD once and the frontend triangulates every cross rate from
  that — 13 fetches instead of 169.
- **Live financial news ticker** in the header — one headline at a time,
  rolling to the next every 20s pulled from four sources, with headlines
  that link through to the original article.
- **Markets/FX/News health indicators** — small live-status badges (green
  "LIVE" / amber "DEGRADED n/total" / red "DOWN") next to the relevant
  section headings and in a status log under the logo, driven by the actual
  success/failure of each refresh cycle, not decorative.
- **Auto-refreshing throughout**: local clock and countdowns tick every
  second (pure client-side math, no network); index prices, charts, the FX
  matrix, and the news headline all advance together every 20s, driven by
  one shared refresh cycle rather than independent timers.

## Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:4173**.

## Deploy

A `render.yaml` blueprint is included for a one-click deploy to
[Render](https://render.com)'s free tier — it runs `server.js` as a
persistent Node process, so no code changes or serverless adaptation are
needed:

**[https://render.com/deploy?repo=https://github.com/hiddenjvs/infinite-ascent-market-timer](https://render.com/deploy?repo=https://github.com/hiddenjvs/infinite-ascent-market-timer)**

The free tier spins down after 15 minutes of inactivity and takes ~30-50s to
wake back up on the next visit.

## How it works

- **`data/markets.json`** — the 11 exchanges: name, city, IANA timezone,
  local open/close time, trading days, and the two index ticker symbols
  tracked for each.
- **`data/fx.json`** — the 13 currencies in the FX matrix, each with its
  Yahoo Finance ticker (quoted as either `XXXUSD=X` or `USDXXX=X`) and a
  flag noting which direction it needs inverting for the USD-triangulation
  math.
- **`server.js`** — a small Express server that:
  - proxies Yahoo Finance's free, unofficial chart endpoint (`/api/chart/:symbol`)
    so the browser doesn't hit CORS, caching responses for 20s to stay well
    under Yahoo's informal rate limits;
  - fetches and merges four RSS news feeds (`/api/news`), deduping by
    headline and merging **round-robin** across sources rather than a flat
    sort-by-recency — otherwise whichever feed happens to publish fastest
    crowds out the others; cached 90s;
  - embeds the markets/FX metadata directly into the HTML response on `/`
    (`window.__BOOTSTRAP__`) so the frontend builds its full layout
    synchronously on first script execution instead of fetching-then-swapping
    a "Loading…" placeholder — this was the single biggest source of layout
    shift during development and is now eliminated (Lighthouse CLS ~0.001-0.01).
- **`public/`** — the frontend, plain HTML/CSS/JS (no build step, no
  framework). Countdown timers use `Intl.DateTimeFormat` plus a
  double-conversion trick to convert each exchange's local wall-clock
  trading hours into the correct UTC instant, then into the viewer's local
  time. Index charts create their `lightweight-charts` instance only after
  the card is attached to the DOM (creating one inside a detached node
  measures 0 width and visibly resizes once attached — a real, avoidable
  layout shift).

## Markets covered

| Exchange | Country | Indexes |
|---|---|---|
| New York Stock Exchange | United States | S&P 500 · Dow Jones Industrial Average |
| NASDAQ | United States | NASDAQ Composite · NASDAQ 100 |
| London Stock Exchange | United Kingdom | FTSE 100 · FTSE 250 |
| Euronext Paris | France | CAC 40 · Euronext 100 |
| Deutsche Börse (Xetra) | Germany | DAX · MDAX |
| Japan Exchange Group | Japan | Nikkei 225 · TOPIX (ETF proxy) |
| Shanghai Stock Exchange | China | SSE Composite · CSI 300 |
| Shenzhen Stock Exchange | China | SZSE Component · ChiNext |
| Hong Kong Stock Exchange | Hong Kong | Hang Seng Index · Hang Seng China Enterprises |
| Nasdaq Stockholm | Sweden | OMX Stockholm 30 · OMX Stockholm PI |
| National Stock Exchange of India | India | NIFTY 50 · BSE SENSEX |

## FX matrix currencies

USD, EUR, GBP, AUD, NZD, JPY, CNY, HKD, INR, SEK, CHF, CAD, SGD — 13 in
total, covering every currency the exchanges above trade in plus the other
G10/majors.

## News sources

CNBC Business News, WSJ Markets (via Dow Jones' feed infrastructure), Yahoo
Finance, and BBC Business. Reuters and AP no longer offer free public RSS
syndication (both retired it years ago; several endpoint variants for each
were tested and confirmed dead), so these four were chosen as the strongest
free, no-API-key sources still available at a comparable tier — CNBC and
WSJ for US markets depth, Yahoo Finance for volume, BBC Business for a
non-US perspective.

## Known limitations

- Countdowns assume regular weekday trading hours only — exchange holidays
  aren't accounted for, so a countdown may read "Opens in ~Xh" on a holiday
  when the market is actually closed all day.
- Yahoo Finance's chart API is unofficial/free and occasionally rate-limits
  or hiccups; the server serves stale cached data rather than an error when
  that happens, and the UI shows "N/A" if a symbol has never loaded.
- Tokyo's TOPIX doesn't have a clean public ticker on Yahoo, so it's tracked
  via the Nomura TOPIX ETF (`1306.T`) as a close proxy.
- FX cross rates are triangulated through USD rather than fetched directly,
  so they'll drift slightly (typically well under 0.1%) from a live direct
  quote for the same pair — normal cross-quote spread, not a bug.
