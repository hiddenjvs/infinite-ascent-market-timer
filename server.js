const express = require('express');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const markets = require('./data/markets.json');
const fxCurrencies = require('./data/fx.json');

const app = express();
const PORT = process.env.PORT || 4173;

// Read once at boot; injecting markets/fx data directly into the HTML response
// lets the frontend build its layout synchronously on first script execution
// instead of fetching-then-swapping a "Loading…" placeholder (which was the
// dominant cause of layout shift on first load).
const indexTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const bootstrapScript = `<script>window.__BOOTSTRAP__=${JSON.stringify({
  markets,
  fx: fxCurrencies
})};</script>`;
const indexHtml = indexTemplate.replace('</head>', `${bootstrapScript}</head>`);

// Simple in-memory cache to stay well under Yahoo's informal rate limits
// and keep the dashboard snappy even with 10 markets x 2 indexes = 20 symbols.
const CACHE_TTL_MS = 20 * 1000;
const cache = new Map();

const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json'
};

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  res.type('html').send(indexHtml);
});

app.get('/api/markets', (req, res) => {
  res.json(markets);
});

app.get('/api/fx', (req, res) => {
  res.json(fxCurrencies);
});

// Finance/econ headline ticker — no free public RSS survives from Reuters or
// AP anymore (both retired syndication years ago; confirmed dead ends), so
// this pulls from CNBC Business News and WSJ Markets (via Dow Jones' feed
// infrastructure, which also serves MarketWatch) — same tier of source.
const NEWS_FEEDS = [
  { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', source: 'WSJ Markets' }
];
const NEWS_CACHE_TTL_MS = 3 * 60 * 1000;
const xmlParser = new XMLParser({ ignoreAttributes: true, htmlEntities: true });
let newsCache = null;

async function fetchNewsFeed(feed) {
  const r = await fetch(feed.url, { headers: YF_HEADERS });
  if (!r.ok) throw new Error(`${feed.source} responded ${r.status}`);
  const xml = await r.text();
  const items = xmlParser.parse(xml)?.rss?.channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list
    .map((item) => ({
      headline: typeof item.title === 'string' ? item.title.trim() : '',
      link: typeof item.link === 'string' ? item.link : null,
      pubDate: item.pubDate ? Date.parse(item.pubDate) || null : null,
      source: feed.source
    }))
    .filter((n) => n.headline);
}

app.get('/api/news', async (req, res) => {
  if (newsCache && Date.now() - newsCache.at < NEWS_CACHE_TTL_MS) {
    return res.json(newsCache.data);
  }

  const results = await Promise.allSettled(NEWS_FEEDS.map(fetchNewsFeed));
  const items = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);

  if (items.length === 0) {
    if (newsCache) return res.json(newsCache.data);
    return res.status(502).json({ error: 'No news feeds reachable' });
  }

  items.sort((a, b) => (b.pubDate ?? 0) - (a.pubDate ?? 0));
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.headline.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 24) break;
  }

  newsCache = { at: Date.now(), data: deduped };
  res.json(deduped);
});

app.get('/api/chart/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const range = req.query.range || '1d';
  const interval = req.query.interval || '5m';
  const cacheKey = `${symbol}|${range}|${interval}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

  try {
    const r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) throw new Error(`Yahoo Finance responded ${r.status}`);
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      const reason = json?.chart?.error?.description || 'No data returned';
      throw new Error(reason);
    }

    const { timestamp = [], indicators = {}, meta = {} } = result;
    const closes = indicators?.quote?.[0]?.close || [];
    const points = timestamp
      .map((t, i) => ({ time: t, price: closes[i] }))
      .filter((p) => typeof p.price === 'number');

    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const price = meta.regularMarketPrice ?? points[points.length - 1]?.price ?? null;
    const change = price != null && previousClose ? price - previousClose : null;
    const changePercent =
      change != null && previousClose ? (change / previousClose) * 100 : null;

    const payload = {
      symbol,
      currency: meta.currency || null,
      price,
      previousClose,
      change,
      changePercent,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      marketTime: meta.regularMarketTime ?? null,
      marketState: meta.marketState || null,
      exchangeName: meta.exchangeName || null,
      points
    };

    cache.set(cacheKey, { at: Date.now(), data: payload });
    res.json(payload);
  } catch (err) {
    // Serve stale cache rather than nothing if Yahoo hiccups
    if (cached) return res.json(cached.data);
    res.status(502).json({ error: err.message, symbol });
  }
});

app.listen(PORT, () => {
  console.log(`Infinite Ascent — Market Timer running at http://localhost:${PORT}`);
});
