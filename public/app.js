// ---------- Timezone-aware clock helpers ----------

function getOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday]
  };
}

// Converts a desired wall-clock time in `timeZone` into the correct UTC Date instant.
function zonedWallTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

function addDaysToParts(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function computeMarketStatus(market, now) {
  const [openH, openM] = market.open.split(':').map(Number);
  const [closeH, closeM] = market.close.split(':').map(Number);
  const nowParts = getZonedParts(now, market.timezone);

  const todayOpen = zonedWallTimeToUtc(
    { ...nowParts, hour: openH, minute: openM },
    market.timezone
  );
  const todayClose = zonedWallTimeToUtc(
    { ...nowParts, hour: closeH, minute: closeM },
    market.timezone
  );

  const isTradingDay = market.days.includes(nowParts.weekday);

  if (isTradingDay && now >= todayOpen && now < todayClose) {
    return { isOpen: true, target: todayClose, label: 'Closes in' };
  }

  // Find next open: check today (if before open) then subsequent days.
  for (let i = 0; i <= 7; i++) {
    const dayParts = i === 0 ? nowParts : addDaysToParts(nowParts, i);
    const weekday = i === 0 ? nowParts.weekday : new Date(Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day)).getUTCDay();
    if (!market.days.includes(weekday)) continue;
    const candidateOpen = zonedWallTimeToUtc(
      { year: dayParts.year, month: dayParts.month, day: dayParts.day, hour: openH, minute: openM },
      market.timezone
    );
    if (candidateOpen > now) {
      return { isOpen: false, target: candidateOpen, label: 'Opens in' };
    }
  }
  // Fallback (should not happen)
  return { isOpen: false, target: new Date(now.getTime() + 86400000), label: 'Opens in' };
}

function formatCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ---------- Local clock ----------

function tickLocalClock() {
  const now = new Date();
  const el = document.getElementById('local-time');
  const tzEl = document.getElementById('local-tz');
  el.textContent = now.toLocaleTimeString([], { hour12: false });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  tzEl.textContent = `Your local time — ${tz}`;
}
setInterval(tickLocalClock, 1000);
tickLocalClock();

// ---------- Logo pulse + API health (driven by the actual refresh cycle) ----------

function pulseLogo() {
  const el = document.querySelector('.brand-logo');
  if (!el) return;
  el.classList.remove('flicker');
  void el.offsetWidth; // force reflow so the animation restarts even if still mid-flicker
  el.classList.add('flicker');
}

function updateApiStatus(key, succeeded, total) {
  let cls, label, liveLabel;
  if (total === 0) {
    cls = 'down';
    label = 'NO DATA';
    liveLabel = 'DOWN';
  } else if (succeeded === total) {
    cls = 'ok';
    label = 'CONNECTED';
    liveLabel = 'LIVE';
  } else if (succeeded > 0) {
    cls = 'degraded';
    label = `PARTIAL ${succeeded}/${total}`;
    liveLabel = 'DEGRADED';
  } else {
    cls = 'down';
    label = 'UNREACHABLE';
    liveLabel = 'DOWN';
  }

  const dot = document.querySelector(`[data-role="${key}-dot"]`);
  const state = document.querySelector(`[data-role="${key}-state"]`);
  if (dot) dot.className = `api-dot ${cls}`;
  if (state) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state.textContent = `${label} · ${time}`;
  }

  const liveDot = document.querySelector(`[data-role="${key}-live-dot"]`);
  const liveText = document.querySelector(`[data-role="${key}-live-text"]`);
  if (liveDot) liveDot.className = `live-dot ${cls}`;
  if (liveText) {
    liveText.className = `live-text ${cls}`;
    liveText.textContent = liveLabel;
  }
}

// ---------- Chart ranges ----------

const RANGES = [
  { key: '1D', range: '1d', interval: '5m' },
  { key: '5D', range: '5d', interval: '15m' },
  { key: '1M', range: '1mo', interval: '60m' },
  { key: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' }
];

function formatPrice(price, currency) {
  if (price == null) return '—';
  const digits = price >= 1000 ? 0 : 2;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) + (currency ? ` ${currency}` : '');
}

class IndexPanel {
  constructor(container, symbol, name) {
    this.symbol = symbol;
    this.name = name;
    this.container = container;
    this.rangeIdx = 0;

    container.innerHTML = `
      <div class="index-head">
        <div>
          <div class="index-name">${name}</div>
          <div class="index-price" data-role="price">—</div>
          <div class="index-change flat" data-role="change">—</div>
        </div>
        <div class="range-controls" data-role="ranges"></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-tooltip" data-role="tooltip"></div>
        <div class="chart-canvas" style="width:100%;height:100%;"></div>
      </div>
    `;

    this.priceEl = container.querySelector('[data-role="price"]');
    this.changeEl = container.querySelector('[data-role="change"]');
    this.tooltipEl = container.querySelector('[data-role="tooltip"]');
    this.chartEl = container.querySelector('.chart-canvas');
    this.rangesEl = container.querySelector('[data-role="ranges"]');

    this.currency = '';
    this.buildRangeButtons();
    this.buildChart();
  }

  buildRangeButtons() {
    this.rangesEl.innerHTML = '';
    RANGES.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.className = 'range-btn' + (i === this.rangeIdx ? ' active' : '');
      btn.textContent = r.key;
      btn.addEventListener('click', () => {
        this.rangeIdx = i;
        [...this.rangesEl.children].forEach((c, ci) =>
          c.classList.toggle('active', ci === i)
        );
        this.load();
      });
      this.rangesEl.appendChild(btn);
    });
  }

  buildChart() {
    this.chart = LightweightCharts.createChart(this.chartEl, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#8a93a6',
        fontSize: 10
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(255,255,255,0.04)' }
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true
    });

    this.series = this.chart.addAreaSeries({
      lineColor: '#5fb3ff',
      topColor: 'rgba(95,179,255,0.35)',
      bottomColor: 'rgba(95,179,255,0.02)',
      lineWidth: 2,
      priceLineVisible: false
    });

    this.chart.applyOptions({
      width: this.chartEl.clientWidth,
      height: this.chartEl.clientHeight
    });

    let lastW = this.chartEl.clientWidth;
    let lastH = this.chartEl.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = this.chartEl.clientWidth;
      const h = this.chartEl.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w;
        lastH = h;
        this.chart.applyOptions({ width: w, height: h });
      }
    });
    ro.observe(this.chartEl);

    this.chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData || !param.seriesData.get(this.series)) {
        this.tooltipEl.innerHTML = this.currentSummary();
        return;
      }
      const point = param.seriesData.get(this.series);
      const date = new Date(param.time * 1000);
      const timeLabel = date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      this.tooltipEl.innerHTML = `<span class="price">${formatPrice(
        point.value,
        this.currency
      )}</span><br/>${timeLabel}`;
    });
  }

  currentSummary() {
    if (this.lastPrice == null) return '';
    return `<span class="price">${formatPrice(this.lastPrice, this.currency)}</span>`;
  }

  async load() {
    const r = RANGES[this.rangeIdx];
    try {
      const res = await fetch(`/api/chart/${encodeURIComponent(this.symbol)}?range=${r.range}&interval=${r.interval}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      this.currency = data.currency || '';
      this.lastPrice = data.price;

      this.priceEl.textContent = formatPrice(data.price, data.currency);
      const changeCls = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
      const sign = data.change > 0 ? '+' : '';
      this.changeEl.className = `index-change ${changeCls}`;
      this.changeEl.textContent =
        data.change != null
          ? `${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)`
          : '—';

      this.tooltipEl.innerHTML = this.currentSummary();

      const seriesData = data.points.map((p) => ({ time: p.time, value: p.price }));
      this.series.setData(seriesData);
      this.chart.timeScale().fitContent();

      const trendUp = (data.change ?? 0) >= 0;
      const trendColor = trendUp ? '#3ecf8e' : '#f0616d';
      const trendFill = trendUp ? 'rgba(62,207,142,' : 'rgba(240,97,109,';
      this.series.applyOptions({
        lineColor: trendColor,
        topColor: trendFill + '0.35)',
        bottomColor: trendFill + '0.02)',
        priceLineColor: trendColor,
        lastValueVisible: true
      });
      if (seriesData.length && typeof this.series.setMarkers === 'function') {
        const last = seriesData[seriesData.length - 1];
        this.series.setMarkers([
          { time: last.time, position: 'inBar', color: trendColor, shape: 'circle', size: 1.4 }
        ]);
      }
      return true;
    } catch (err) {
      this.tooltipEl.textContent = '';
      this.priceEl.textContent = 'N/A';
      this.changeEl.textContent = 'data unavailable';
      this.changeEl.className = 'index-change flat';
      return false;
    }
  }
}

// ---------- Market cards ----------

const panels = [];
const statusEls = [];
let openGrid, closedGrid, openCountEl, closedCountEl;

function buildMarketCard(market) {
  const card = document.createElement('div');
  card.className = 'market-card';
  card.innerHTML = `
    <div class="market-card-head">
      <div class="market-title">
        <span class="market-flag">${market.flag}</span>
        <div>
          <div class="market-name">${market.name}</div>
          <div class="market-meta">${market.city} · ${market.open}–${market.close} local</div>
        </div>
      </div>
      <div class="status-block">
        <span class="status-pill" data-role="pill"><span class="dot"></span><span data-role="pill-text">—</span></span>
        <div class="countdown" data-role="countdown">--:--:--</div>
        <div class="countdown-label" data-role="countdown-label">—</div>
      </div>
    </div>
    <div class="indexes" data-role="indexes"></div>
  `;

  const entry = {
    market,
    card,
    isOpen: null, // unknown until first tick, forces initial placement
    pill: card.querySelector('[data-role="pill"]'),
    pillText: card.querySelector('[data-role="pill-text"]'),
    countdown: card.querySelector('[data-role="countdown"]'),
    countdownLabel: card.querySelector('[data-role="countdown-label"]')
  };
  statusEls.push(entry);

  return entry;
}

// Charts are created only after `card` is attached to the document — creating
// a lightweight-charts instance inside a still-detached node measures 0 width,
// then visibly resizes once attached, which is a real (and avoidable) layout shift.
function buildIndexPanels(market, card) {
  const indexesEl = card.querySelector('[data-role="indexes"]');
  market.indexes.forEach((idx) => {
    const panelEl = document.createElement('div');
    panelEl.className = 'index-card';
    indexesEl.appendChild(panelEl);
    const panel = new IndexPanel(panelEl, idx.symbol, idx.name);
    panels.push(panel);
  });
}

function updateCounts() {
  openCountEl.textContent = openGrid.children.length;
  closedCountEl.textContent = closedGrid.children.length;
}

function tickStatuses() {
  const now = new Date();
  let groupsChanged = false;

  statusEls.forEach((entry) => {
    const status = computeMarketStatus(entry.market, now);
    entry.pill.className = 'status-pill ' + (status.isOpen ? 'open' : 'closed');
    entry.pillText.textContent = status.isOpen ? 'Open' : 'Closed';
    entry.countdown.textContent = formatCountdown(status.target.getTime() - now.getTime());
    entry.countdownLabel.textContent = status.label;

    if (status.isOpen !== entry.isOpen) {
      entry.isOpen = status.isOpen;
      entry.nextEvent = status.target.getTime();
      (status.isOpen ? openGrid : closedGrid).appendChild(entry.card);
      groupsChanged = true;
    } else {
      entry.nextEvent = status.target.getTime();
    }
  });

  if (groupsChanged) updateCounts();
}
setInterval(tickStatuses, 1000);

// ---------- FX cross-rate matrix ----------
// Classic Bloomberg FXC-style matrix: currencies on both axes, diagonal blank,
// cell[row][col] = how much of the column currency buys 1 unit of the row currency.
// Rather than fetching all N^2 cross pairs, we fetch each currency's rate vs USD
// once and triangulate every cross rate through USD client-side.

const CCY_FLAGS = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CNY: '🇨🇳', HKD: '🇭🇰',
  INR: '🇮🇳', SEK: '🇸🇪', CHF: '🇨🇭', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', SGD: '🇸🇬'
};

let fxCurrencies = [];
const fxCellEls = new Map(); // "ROW-COL" -> <td>
const fxLastValues = new Map(); // "ROW-COL" -> last rendered number

function formatFxRate(rate) {
  if (rate == null) return '—';
  const digits = rate >= 10 ? 3 : 4;
  return rate.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function buildFxMatrix(currencies) {
  const wrap = document.getElementById('fx-matrix-wrap');
  const table = document.createElement('table');
  table.className = 'fx-matrix';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML =
    '<th class="fx-corner"></th>' +
    currencies.map((c) => `<th>${CCY_FLAGS[c.code] || ''} ${c.code}</th>`).join('');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  currencies.forEach((rowCcy) => {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('td');
    rowHead.className = 'fx-row-head';
    rowHead.textContent = `${CCY_FLAGS[rowCcy.code] || ''} ${rowCcy.code}`;
    tr.appendChild(rowHead);

    currencies.forEach((colCcy) => {
      const td = document.createElement('td');
      if (rowCcy.code === colCcy.code) {
        td.className = 'fx-diagonal';
        td.textContent = '–';
      } else {
        td.className = 'fx-cell';
        td.textContent = '—';
        fxCellEls.set(`${rowCcy.code}-${colCcy.code}`, td);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrap.innerHTML = '';
  wrap.appendChild(table);
}

async function loadFxRates() {
  const usdPerX = { USD: 1 };
  const prevUsdPerX = { USD: 1 }; // triangulated from each leg's previous close, for day-direction trend
  const legs = fxCurrencies.filter((c) => c.symbol);
  let succeeded = 0;

  await Promise.all(
    legs.map(async (c) => {
      try {
        const res = await fetch(`/api/chart/${encodeURIComponent(c.symbol)}?range=1d&interval=15m`);
        const data = await res.json();
        if (data.error || data.price == null) throw new Error(data.error || 'no price');
        usdPerX[c.code] = c.invert ? 1 / data.price : data.price;
        prevUsdPerX[c.code] =
          data.previousClose != null ? (c.invert ? 1 / data.previousClose : data.previousClose) : null;
        succeeded++;
      } catch (err) {
        usdPerX[c.code] = null;
        prevUsdPerX[c.code] = null;
      }
    })
  );

  fxCurrencies.forEach((rowCcy) => {
    fxCurrencies.forEach((colCcy) => {
      if (rowCcy.code === colCcy.code) return;
      const key = `${rowCcy.code}-${colCcy.code}`;
      const td = fxCellEls.get(key);
      if (!td) return;

      const rU = usdPerX[rowCcy.code];
      const cU = usdPerX[colCcy.code];
      const value = rU != null && cU != null ? rU / cU : null;

      const rPrevU = prevUsdPerX[rowCcy.code];
      const cPrevU = prevUsdPerX[colCcy.code];
      const prevValue = rPrevU != null && cPrevU != null ? rPrevU / cPrevU : null;
      const trend = value != null && prevValue != null
        ? (value > prevValue ? 'up' : value < prevValue ? 'down' : 'flat')
        : 'flat';
      const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '';

      td.className = 'fx-cell' + (trend !== 'flat' ? ` ${trend}` : '');
      td.innerHTML = `${formatFxRate(value)}${arrow ? `<span class="fx-arrow">${arrow}</span>` : ''}`;

      const prevTick = fxLastValues.get(key);
      if (prevTick != null && value != null && value !== prevTick) {
        const flashCls = value > prevTick ? 'flash-up' : 'flash-down';
        td.classList.remove('flash-up', 'flash-down');
        void td.offsetWidth; // restart animation if reapplied quickly
        td.classList.add(flashCls);
        setTimeout(() => td.classList.remove(flashCls), 900);
      }
      if (value != null) fxLastValues.set(key, value);
    });
  });

  return { succeeded, total: legs.length };
}

function initFx() {
  const wrap = document.getElementById('fx-matrix-wrap');
  try {
    // Structure comes from the bootstrap data embedded server-side (no fetch
    // round trip), so the table renders at full size on the very first paint
    // instead of swapping in after a "Loading…" placeholder.
    fxCurrencies = window.__BOOTSTRAP__.fx;
    buildFxMatrix(fxCurrencies);
  } catch (err) {
    wrap.innerHTML = `<p class="loading">Failed to load FX rates: ${err.message}</p>`;
  }
}

async function refreshAll() {
  const [panelResults, fxResult] = await Promise.all([
    Promise.all(panels.map((p) => p.load())),
    loadFxRates()
  ]);
  const marketsSucceeded = panelResults.filter(Boolean).length;
  updateApiStatus('markets', marketsSucceeded, panels.length);
  updateApiStatus('fx', fxResult.succeeded, fxResult.total);
  pulseLogo();
}

// ---------- Market news ticker ----------

let newsHeadlines = [];

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function renderNewsTicker() {
  const track = document.getElementById('news-ticker-track');
  if (!track) return;

  if (!newsHeadlines.length) {
    track.innerHTML = '<span class="news-ticker-item">Headlines unavailable</span>';
    return;
  }

  const itemsHtml = newsHeadlines
    .map((n) => {
      const inner = `<span class="source">${escapeHtml(n.source)}</span>${escapeHtml(n.headline)}`;
      return n.link
        ? `<a class="news-ticker-item" href="${n.link}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : `<span class="news-ticker-item">${inner}</span>`;
    })
    .join('<span class="sep">•</span>');

  // Duplicated back-to-back so the translateX(-50%) loop is seamless.
  track.innerHTML = itemsHtml + itemsHtml;

  // Constant scroll speed regardless of how much text loaded.
  requestAnimationFrame(() => {
    const halfWidth = track.scrollWidth / 2;
    const pxPerSecond = 55;
    const duration = Math.max(20, halfWidth / pxPerSecond);
    track.style.setProperty('--ticker-duration', `${duration}s`);
  });
}

let lastNewsKey = '';

async function loadNews() {
  const dot = document.querySelector('[data-role="news-live-dot"]');
  try {
    const res = await fetch('/api/news');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty');
    newsHeadlines = data;
    if (dot) dot.className = 'live-dot ok';

    // Only rebuild the DOM (which restarts the scroll animation) when the
    // headline set actually changed — otherwise every poll would visibly
    // snap the ticker back to the start even with nothing new to show.
    const key = data.map((n) => n.headline).join('|');
    if (key !== lastNewsKey) {
      lastNewsKey = key;
      renderNewsTicker();
    }
  } catch (err) {
    if (dot) dot.className = 'live-dot down';
    if (!newsHeadlines.length) renderNewsTicker();
  }
}

async function init() {
  initFx();
  loadNews();
  setInterval(loadNews, 90 * 1000); // matches the backend's 90s cache on the news feeds
  const main = document.getElementById('markets-main');
  try {
    const markets = window.__BOOTSTRAP__.markets;

    main.innerHTML = `
      <section class="market-section">
        <h2 class="section-title open-title">
          <span class="dot"></span>Open now — <span class="count" data-role="open-count">0</span>
          <span class="live-badge">
            <span class="live-dot" data-role="markets-live-dot"></span>
            <span class="live-text" data-role="markets-live-text">SYNCING</span>
          </span>
        </h2>
        <div class="markets-grid" data-role="open-grid"></div>
      </section>
      <section class="market-section">
        <h2 class="section-title closed-title"><span class="dot"></span>Closed — <span class="count" data-role="closed-count">0</span></h2>
        <div class="markets-grid" data-role="closed-grid"></div>
      </section>
    `;
    openGrid = main.querySelector('[data-role="open-grid"]');
    closedGrid = main.querySelector('[data-role="closed-grid"]');
    openCountEl = main.querySelector('[data-role="open-count"]');
    closedCountEl = main.querySelector('[data-role="closed-count"]');

    // Sort by soonest upcoming event so the most time-sensitive markets lead each group.
    const now = new Date();
    const withStatus = markets.map((market) => ({ market, status: computeMarketStatus(market, now) }));
    withStatus.sort((a, b) => a.status.target - b.status.target);

    withStatus.forEach(({ market, status }) => {
      const entry = buildMarketCard(market);
      entry.isOpen = status.isOpen;
      (status.isOpen ? openGrid : closedGrid).appendChild(entry.card);
      buildIndexPanels(market, entry.card);
    });
    updateCounts();
    tickStatuses();

    // Refresh live prices/charts/FX as often as the free API comfortably allows
    // (backend caches responses for ~20s, so this stays close to real-time).
    // The logo flicker and API health log below it are driven by this same cycle.
    await refreshAll();
    setInterval(refreshAll, 20000);
  } catch (err) {
    main.innerHTML = `<p class="loading">Failed to load market data: ${err.message}</p>`;
  }
}

init();
