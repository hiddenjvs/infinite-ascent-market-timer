const express = require('express');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const markets = require('./data/markets.json');
const marketsExtra = require('./data/markets-extra.json');
const fxCurrencies = require('./data/fx.json');
const commodities = require('./data/commodities.json');
const bonds = require('./data/bonds.json');

const app = express();
const PORT = process.env.PORT || 4173;

// Read once at boot; injecting markets/fx data directly into the HTML response
// lets the frontend build its layout synchronously on first script execution
// instead of fetching-then-swapping a "Loading…" placeholder (which was the
// dominant cause of layout shift on first load).
const indexTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const bootstrapScript = `<script>window.__BOOTSTRAP__=${JSON.stringify({
  markets,
  marketsExtra,
  fx: fxCurrencies,
  commodities,
  bonds
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

// Datacenter IPs (Render included) get served YouTube's cookie-consent
// interstitial instead of the actual page — it has no videoDetails/canonical
// tag at all, which is why this worked from a residential IP locally but
// 502'd as "no live video found" once deployed. Sending a pre-accepted
// CONSENT cookie skips that interstitial.
const YOUTUBE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+1'
};

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  res.type('html').send(indexHtml);
});

app.get('/api/markets', (req, res) => {
  res.json(markets);
});

app.get('/api/markets-extra', (req, res) => {
  res.json(marketsExtra);
});

app.get('/api/fx', (req, res) => {
  res.json(fxCurrencies);
});

app.get('/api/commodities', (req, res) => {
  res.json(commodities);
});

app.get('/api/bonds', (req, res) => {
  res.json(bonds);
});

// Ticker search for the "add a stock" watchlist feature — proxies Yahoo
// Finance's unofficial search endpoint (same free, no-key deal as everything
// else) so the browser doesn't hit CORS.
// Bond/yield instruments have no dedicated Yahoo quoteType (futures, ETFs,
// and yield indices all mix in under Futures/ETF/Index), so "is this a bond"
// is a name-keyword check rather than a type check.
const BOND_RELEVANCE_RE = /\b(treasury|bond|yield|note|bund|gilt|jgb|t-bill|interest rate)\b/i;

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const kind = (req.query.kind || '').trim().toLowerCase();
  if (!q) return res.json([]);

  try {
    // Ask Yahoo for more candidates when we're about to filter most of them
    // out, so a scoped search still has enough left to actually show.
    const quotesCount = kind ? 20 : 8;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${quotesCount}&newsCount=0`;
    const r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) throw new Error(`Yahoo Finance responded ${r.status}`);
    const json = await r.json();
    const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
    let results = quotes
      .filter((q) => q.symbol && (q.shortname || q.longname))
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname,
        exchange: q.exchDisp || q.exchange || null,
        type: q.typeDisp || q.quoteType || null
      }));

    if (kind === 'commodity') {
      // Every commodity in this app (and on Yahoo generally) is a futures
      // contract — ETFs/equities that merely track a commodity (GLD, GDX)
      // are excluded on purpose, same convention as data/commodities.json.
      results = results.filter((r) => (r.type || '').toLowerCase() === 'futures');
    } else if (kind === 'bond') {
      results = results.filter((r) => BOND_RELEVANCE_RE.test(r.name) || BOND_RELEVANCE_RE.test(r.symbol));
    }

    res.json(results.slice(0, 8));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Live TV — resolves a YouTube channel's CURRENTLY live video id server-side,
// then the frontend embeds that specific video via the standard, universally
// supported /embed/VIDEO_ID pattern. We tried the alternative
// /embed/live_stream?channel=... parameter first (avoids ever needing to
// resolve anything), but it turned out to work for some channels (Bloomberg,
// CNBC) and not others (NBC, Sky News) for reasons that aren't documented —
// resolving the real video id and embedding it directly is more reliable
// and works uniformly across channels. Cached briefly since a channel's
// live video id only changes when one broadcast ends and the next begins.
const LIVETV_CACHE_TTL_MS = 5 * 60 * 1000;
const livetvCache = new Map();

app.get('/api/livetv/:channel', async (req, res) => {
  const { channel } = req.params;
  const cached = livetvCache.get(channel);
  if (cached && Date.now() - cached.at < LIVETV_CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://www.youtube.com/channel/${encodeURIComponent(channel)}/live`;
    const r = await fetch(url, { headers: YOUTUBE_HEADERS });
    if (!r.ok) throw new Error(`YouTube responded ${r.status}`);
    const html = await r.text();
    // videoDetails is present on the actual watch page; the canonical link
    // tag is a fallback that's survived past YouTube markup changes better.
    const match =
      html.match(/"videoDetails":\{"videoId":"([A-Za-z0-9_-]{11})"/) ||
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
    if (!match) {
      // Temporary diagnostic: the first debug pass showed the deployed
      // instance is getting served a completely different (WIZ-framework)
      // YouTube page template than the classic one this scrapes locally —
      // 1.3MB of real page, not a consent/bot-block wall — so it has none of
      // the markers this looked for. Report which known markers are/aren't
      // present so the right one to key off can be picked without more
      // round trips.
      const markers = [
        'videoDetails',
        'ytInitialPlayerResponse',
        'ytInitialData',
        '"videoId":"',
        'canonical',
        'isLiveContent',
        'og:video',
        'watch?v='
      ];
      const found = {};
      markers.forEach((m) => {
        const idx = html.indexOf(m);
        found[m] = idx === -1 ? null : html.slice(idx, idx + 150).replace(/\s+/g, ' ');
      });
      console.error(`livetv/${channel}: no match. length=${html.length} markers=${JSON.stringify(found)}`);
      const err = new Error('No live video found for this channel');
      err.debugMarkers = found;
      err.debugLength = html.length;
      throw err;
    }

    const data = { videoId: match[1] };
    livetvCache.set(channel, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error(`livetv/${channel} failed:`, err.message);
    if (cached) return res.json(cached.data);
    res.status(502).json({ error: err.message, debugMarkers: err.debugMarkers, debugLength: err.debugLength });
  }
});

// Finance/econ headline ticker — no free public RSS survives from Reuters or
// AP anymore (both retired syndication years ago; confirmed dead ends).
// CNBC's general "Business News" feed and BBC's general "Business" feed both
// mix in non-market fluff (luxury real estate, health news, personal-finance
// advice columns), so this pulls CNBC's dedicated Economy/Finance/Earnings/
// Investing category feeds instead of its catch-all one, plus WSJ Markets
// (already tightly market-focused) and BBC Business (kept for a non-US
// perspective, filtered same as everything else below).
const NEWS_FEEDS = [
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'CNBC Economy' },
  { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC Finance' },
  { url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Earnings' },
  { url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html', source: 'CNBC Investing' },
  { url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', source: 'WSJ Markets' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business' }
];
const NEWS_CACHE_TTL_MS = 90 * 1000; // short enough that the ticker visibly refreshes
const xmlParser = new XMLParser({ ignoreAttributes: true, htmlEntities: true });
let newsCache = null;

// Safety net on top of source selection: only keep headlines that actually
// read as market/finance/econ/policy news, so a stray off-topic item from
// any one feed (BBC Business in particular) doesn't slip through.
const MARKET_RELEVANCE_RE = new RegExp(
  '\\b(' +
    [
      'stocks?', 'shares?', 'markets?', 'earnings', 'revenue', 'profits?', 'ipo', 'merger',
      'acquisitions?', 'acquir\\w*', 'buyout', 'ceo', 'cfo', 'wall street', 'federal reserve',
      'fed', 'rate hike', 'rate cut', 'interest rates?', 'inflation', 'gdp', 'econom\\w*',
      'recession', 'trade war', 'tariffs?', 'dollar', 'currenc\\w*', 'yen', 'euro', 'yuan',
      'bonds?', 'treasury', 'yield', 'deficit', 'budget', 'dividends?', 'quarterly', 'fiscal',
      'nasdaq', 'dow jones', 's&p', 'nyse', 'crypto\\w*', 'bitcoin', 'ethereum', 'oil prices?',
      'crude', 'gold prices?', 'commodit\\w*', 'central bank', 'unemployment', 'jobs report',
      'payrolls?', 'exports?', 'imports?', 'supply chain', 'semiconductors?', 'chip stocks?',
      'valuation', 'buyback', 'guidance', 'forecast', 'outlook', 'downgrade', 'upgrade',
      'analysts?', 'bankrupt\\w*', 'default', 'credit rating', 'sanctions?', 'opec', 'stake',
      'private equity', 'hedge fund', 'investors?', 'billion deal', 'takeover', 'trillion',
      'sec\\b', 'antitrust', 'regulators?', 'tax\\w*', 'debt', 'housing market', 'jobless'
    ].join('|') +
    ')\\b',
  'i'
);

async function fetchNewsFeed(feed) {
  const r = await fetch(feed.url, { headers: YF_HEADERS });
  if (!r.ok) throw new Error(`${feed.source} responded ${r.status}`);
  const xml = await r.text();
  const items = xmlParser.parse(xml)?.rss?.channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list
    .map((item) => {
      const headline = typeof item.title === 'string' ? item.title.trim() : '';
      const description = typeof item.description === 'string' ? item.description : '';
      return {
        headline,
        link: typeof item.link === 'string' ? item.link : null,
        pubDate: item.pubDate ? Date.parse(item.pubDate) || null : null,
        source: feed.source,
        _relevanceText: `${headline} ${description}`
      };
    })
    .filter((n) => n.headline && MARKET_RELEVANCE_RE.test(n._relevanceText));
}

app.get('/api/news', async (req, res) => {
  if (newsCache && Date.now() - newsCache.at < NEWS_CACHE_TTL_MS) {
    return res.json(newsCache.data);
  }

  const results = await Promise.allSettled(NEWS_FEEDS.map(fetchNewsFeed));
  // Keep each source's own items sorted by recency, but merge round-robin
  // (one from each source per round) instead of a flat sort-by-recency —
  // a feed that simply updates more often would otherwise crowd out the rest.
  const bySource = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.sort((a, b) => (b.pubDate ?? 0) - (a.pubDate ?? 0)));

  if (bySource.length === 0) {
    if (newsCache) return res.json(newsCache.data);
    return res.status(502).json({ error: 'No news feeds reachable' });
  }

  const seen = new Set();
  const deduped = [];
  for (let i = 0; deduped.length < 24; i++) {
    let addedAny = false;
    for (const list of bySource) {
      if (i >= list.length) continue;
      addedAny = true;
      const key = list[i].headline.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(list[i]);
      if (deduped.length >= 24) break;
    }
    if (!addedAny) break;
  }

  const payload = deduped.map(({ headline, link, pubDate, source }) => ({
    headline,
    link,
    pubDate,
    source
  }));

  newsCache = { at: Date.now(), data: payload };
  res.json(payload);
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
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      marketTime: meta.regularMarketTime ?? null,
      marketState: meta.marketState || null,
      exchangeName: meta.exchangeName || null,
      fullExchangeName: meta.fullExchangeName || null,
      longName: meta.longName || meta.shortName || null,
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
