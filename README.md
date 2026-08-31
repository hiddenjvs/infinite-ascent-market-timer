# Infinite Ascent — Market Timer

A local dashboard for the world's top 10 stock exchanges: live countdowns to
open/close (relative to your device's local time), and interactive charts for
each exchange's two headline indexes.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:4173**.

## How it works

- `data/markets.json` — the 10 exchanges, their timezone, trading hours, and
  the two index ticker symbols tracked for each.
- `server.js` — a tiny Express server that proxies Yahoo Finance's free
  (unofficial, no API key) chart endpoint, so the browser doesn't hit CORS
  issues, and caches responses for 20s to stay well under informal rate
  limits.
- `public/` — the frontend. Countdown timers are computed entirely in the
  browser using `Intl.DateTimeFormat` to convert each exchange's local
  trading hours into your device's local time, ticking every second. Charts
  use TradingView's free `lightweight-charts` library (via CDN) — drag to
  pan, scroll/pinch to zoom the time axis, and hover to read the exact price
  at any point on the curve. Range buttons (1D/5D/1M/6M/1Y) refetch at an
  appropriate granularity. Prices and charts auto-refresh every 60s.

## Markets covered

NYSE, NASDAQ, London Stock Exchange, Euronext Paris, Deutsche Börse (Xetra),
Japan Exchange Group (Tokyo), Shanghai Stock Exchange, Shenzhen Stock
Exchange, Hong Kong Stock Exchange, and the National Stock Exchange of India.

## Known limitations

- Countdowns assume regular weekday trading hours only — exchange holidays
  aren't accounted for, so a countdown may read "Opens in ~Xh" on a holiday
  when the market is actually closed all day.
- Yahoo Finance's chart API is unofficial/free and occasionally rate-limits
  or hiccups; the server serves stale cached data rather than an error when
  that happens, and the UI shows "N/A" if a symbol has never loaded.
- Tokyo's TOPIX doesn't have a clean public ticker on Yahoo, so it's tracked
  via the Nomura TOPIX ETF (`1306.T`) as a close proxy.
