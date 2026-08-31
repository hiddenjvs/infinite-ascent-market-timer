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
  { key: 'YTD', range: 'ytd', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' },
  { key: 'All', range: 'max', interval: '1mo' }
];

function formatPrice(price, currency) {
  if (price == null) return '—';
  const digits = price >= 1000 ? 0 : 2;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) + (currency ? ` ${currency}` : '');
}

// Shared by every mini chart (index/commodity/watchlist tiles) and the detail modal.
function createPriceChart(container) {
  const chart = LightweightCharts.createChart(container, {
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
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      // Without these, zooming/panning past the actual data just shrinks it
      // into a smaller slice of the canvas with empty space on either side —
      // clamp both edges to the real data range and cap how far bars can
      // shrink so "zoomed all the way out" still shows a full chart.
      fixLeftEdge: true,
      fixRightEdge: true,
      minBarSpacing: 4
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: true,
    handleScale: true
  });

  const series = chart.addAreaSeries({
    lineColor: '#5fb3ff',
    topColor: 'rgba(95,179,255,0.35)',
    bottomColor: 'rgba(95,179,255,0.02)',
    lineWidth: 2,
    priceLineVisible: false
  });

  chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  return { chart, series };
}

function applyTrendColors(series, change) {
  const trendUp = (change ?? 0) >= 0;
  const trendColor = trendUp ? '#3ecf8e' : '#f0616d';
  const trendFill = trendUp ? 'rgba(62,207,142,' : 'rgba(240,97,109,';
  series.applyOptions({
    lineColor: trendColor,
    topColor: trendFill + '0.35)',
    bottomColor: trendFill + '0.02)',
    priceLineColor: trendColor,
    lastValueVisible: true
  });
  return trendColor;
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

    container.title = 'Double-click for details';
    container.addEventListener('dblclick', () => openDetailModal(this.symbol, this.name));
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
    const { chart, series } = createPriceChart(this.chartEl);
    this.chart = chart;
    this.series = series;

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
    this.resizeObserver = ro;

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

      const trendColor = applyTrendColors(this.series, data.change);
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

  // Called when a watchlist entry is removed — releases the chart instance
  // and its ResizeObserver rather than leaking them.
  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }
}

// ---------- Market cards ----------

const panels = [];
const statusEls = [];
let openGrid, closedGrid, openCountEl, closedCountEl;

function buildMarketCard(market) {
  const card = document.createElement('div');
  card.className = 'market-card sortable-item';
  card.dataset.sortId = market.id;
  card.innerHTML = `
    <div class="market-card-head" draggable="true">
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
      const targetGrid = status.isOpen ? openGrid : closedGrid;
      targetGrid.appendChild(entry.card);
      // Land it in its previously-saved manual position within the new
      // group, rather than always at the end.
      applySavedOrder(targetGrid, sortKeyFor(targetGrid));
      groupsChanged = true;
    } else {
      entry.nextEvent = status.target.getTime();
    }
  });

  if (groupsChanged) updateCounts();
}
setInterval(tickStatuses, 1000);

// ---------- Drag-to-reorder (dashboard panels + card grids) ----------
// A generic sortable-list implementation using native HTML5 drag-and-drop,
// reused for the top-level panel stack (Markets/Commodities/Watchlist/FX)
// and for every card grid (market cards, commodities, watchlist tickers).
// Order is persisted to localStorage so the layout survives a reload.

function sortKeyFor(el) {
  if (el === openGrid) return 'order:markets-open';
  if (el === closedGrid) return 'order:markets-closed';
  if (el.id === 'commodities-grid') return 'order:commodities';
  if (el.id === 'watchlist-grid') return 'order:watchlist';
  if (el.id === 'dashboard-panels') return 'order:dashboard-panels';
  return null;
}

function persistOrder(container, storageKey) {
  if (!storageKey) return;
  const order = [...container.children].map((c) => c.dataset.sortId).filter(Boolean);
  try {
    localStorage.setItem(storageKey, JSON.stringify(order));
  } catch (err) {
    /* localStorage unavailable (private mode, quota) — layout just won't persist */
  }
}

function applySavedOrder(container, storageKey) {
  if (!storageKey) return;
  let order;
  try {
    order = JSON.parse(localStorage.getItem(storageKey));
  } catch (err) {
    order = null;
  }
  if (!Array.isArray(order) || !order.length) return;
  const byId = new Map([...container.children].map((c) => [c.dataset.sortId, c]));
  order.forEach((id) => {
    const el = byId.get(id);
    if (el) container.appendChild(el);
  });
}

function makeSortable(container, storageKey, { handleSelector } = {}) {
  let dragEl = null;
  const draggingClass = container.id === 'dashboard-panels' ? 'panel-dragging' : 'item-dragging';

  function itemsExcept(el) {
    return [...container.children].filter((c) => c !== el);
  }

  function closestItem(x, y) {
    let closest = null;
    let closestDist = Infinity;
    itemsExcept(dragEl).forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = (x - cx) ** 2 + (y - cy) ** 2;
      if (dist < closestDist) {
        closestDist = dist;
        closest = el;
      }
    });
    return closest;
  }

  container.addEventListener('dragstart', (e) => {
    const handle = handleSelector ? e.target.closest(handleSelector) : e.target.closest('.sortable-item, [data-sort-id]');
    if (!handle) return;
    const item = handle.closest('[data-sort-id]');
    if (!item || item.parentElement !== container) return;
    dragEl = item;
    dragEl.classList.add(draggingClass);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', dragEl.dataset.sortId || '');
    } catch (err) {
      /* Safari sometimes throws on setData with certain MIME types — harmless to skip */
    }
  });

  container.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const target = closestItem(e.clientX, e.clientY);
    if (!target || target === dragEl) return;
    const r = target.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    container.insertBefore(dragEl, before ? target : target.nextSibling);
  });

  container.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove(draggingClass);
    dragEl = null;
    persistOrder(container, storageKey);
  });
}

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
    '<th class="fx-corner" scope="col"><span class="sr-only">Row currency</span></th>' +
    currencies.map((c) => `<th scope="col">${CCY_FLAGS[c.code] || ''} ${c.code}</th>`).join('');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  currencies.forEach((rowCcy) => {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('th');
    rowHead.className = 'fx-row-head';
    rowHead.scope = 'row';
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
  await advanceNews();
  pulseLogo();
}

// ---------- Commodities & Watchlist ----------
// Both reuse IndexPanel for their live chart/price tile — a commodity or a
// watchlist stock is just another Yahoo Finance symbol, same as an index.
// Their panels are pushed into the shared `panels` array so refreshAll()
// above picks them up automatically on the same 20s cycle.

function buildInstrumentCard({ symbol, name, flag, removable }) {
  const card = document.createElement('div');
  card.className = 'instrument-card sortable-item';
  card.dataset.sortId = symbol;
  card.innerHTML = `
    <div class="instrument-head" draggable="true">
      <div class="instrument-title">
        <span class="flag">${flag || '📈'}</span>
        <span class="name">${escapeHtml(name)}</span>
      </div>
      ${removable ? '<button class="instrument-remove" type="button" title="Remove" data-role="remove">✕</button>' : ''}
    </div>
    <div class="index-card" data-role="slot"></div>
  `;
  return { card, slot: card.querySelector('[data-role="slot"]') };
}

function initCommodities() {
  const grid = document.getElementById('commodities-grid');
  const commodities = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__.commodities) || [];
  commodities.forEach((c) => {
    const { card, slot } = buildInstrumentCard({ symbol: c.symbol, name: c.name, flag: c.flag, removable: false });
    grid.appendChild(card);
    const panel = new IndexPanel(slot, c.symbol, c.unit ? `${c.name} ${c.unit}` : c.name);
    panels.push(panel);
  });
  applySavedOrder(grid, sortKeyFor(grid));
  makeSortable(grid, sortKeyFor(grid));
}

const WATCHLIST_KEY = 'watchlist:tickers';
const watchlistPanelsBySymbol = new Map();

function getWatchlist() {
  try {
    const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch (err) {
    /* localStorage unavailable — watchlist just won't persist across reloads */
  }
}

function addToWatchlist(item) {
  const list = getWatchlist();
  if (list.some((x) => x.symbol === item.symbol)) return;
  list.push(item);
  saveWatchlist(list);
  renderWatchlistItem(item);
}

function removeFromWatchlist(symbol) {
  saveWatchlist(getWatchlist().filter((x) => x.symbol !== symbol));

  const panel = watchlistPanelsBySymbol.get(symbol);
  if (panel) {
    const idx = panels.indexOf(panel);
    if (idx !== -1) panels.splice(idx, 1);
    watchlistPanelsBySymbol.delete(symbol);
    panel.destroy();
  }

  const grid = document.getElementById('watchlist-grid');
  const card = [...grid.children].find((c) => c.dataset.sortId === symbol);
  if (card) card.remove();
}

function renderWatchlistItem(item) {
  const grid = document.getElementById('watchlist-grid');
  const { card, slot } = buildInstrumentCard({ symbol: item.symbol, name: item.name, flag: '📈', removable: true });
  grid.appendChild(card);

  const panel = new IndexPanel(slot, item.symbol, item.name);
  panels.push(panel);
  watchlistPanelsBySymbol.set(item.symbol, panel);
  panel.load();

  card.querySelector('[data-role="remove"]').addEventListener('click', (e) => {
    e.stopPropagation();
    removeFromWatchlist(item.symbol);
  });
}

function initWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  getWatchlist().forEach((item) => renderWatchlistItem(item));
  applySavedOrder(grid, sortKeyFor(grid));
  makeSortable(grid, sortKeyFor(grid));
}

function initWatchlistSearch() {
  const input = document.getElementById('watchlist-input');
  const results = document.getElementById('watchlist-results');
  let debounceTimer = null;

  function closeResults() {
    results.classList.remove('open');
    results.innerHTML = '';
  }

  function renderResults(items) {
    if (!items.length) {
      results.innerHTML = '<div class="watchlist-result-empty">No matches</div>';
      results.classList.add('open');
      return;
    }
    results.innerHTML = items
      .map(
        (r, i) => `
      <div class="watchlist-result" data-idx="${i}">
        <span class="symbol">${escapeHtml(r.symbol)}</span>
        <span class="name">${escapeHtml(r.name)}</span>
        <span class="exchange">${escapeHtml(r.exchange || '')}</span>
      </div>`
      )
      .join('');
    results.classList.add('open');
    [...results.querySelectorAll('.watchlist-result')].forEach((el, i) => {
      el.addEventListener('click', () => {
        addToWatchlist({ symbol: items[i].symbol, name: items[i].name });
        input.value = '';
        closeResults();
      });
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      closeResults();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const items = await res.json();
        renderResults(Array.isArray(items) ? items : []);
      } catch (err) {
        renderResults([]);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.watchlist-search')) closeResults();
  });
}

// ---------- Live TV ----------
// Official YouTube live streams, embedded via the `live_stream?channel=`
// pattern — this tracks whatever is CURRENTLY live on that channel rather
// than a hardcoded video id, so it doesn't go stale when a stream ends and
// a new one starts. Not scraping or bypassing anything — this is YouTube's
// own sanctioned embed API. Bloomberg/NBC/CNBC/Sky News all run legitimate
// free 24/7 live news streams this way; CNN doesn't (their live feed is
// paywalled), which is why it's not in this list.
const LIVETV_SOURCES = [
  { id: 'bloomberg', label: 'Bloomberg TV', channel: 'UCIALMKvObZNtJ6AmdCLP7Lg' },
  { id: 'nbc', label: 'NBC News NOW', channel: 'UCeY0bbntWzzVIaj2z3QigXg' },
  { id: 'cnbc', label: 'CNBC', channel: 'UCvJJ_dzjViJCoLf5uKUTwoA' },
  { id: 'sky', label: 'Sky News', channel: 'UCoMdktPbSTixAyNGwb-UYkQ' }
];
const LIVETV_KEY = 'livetv:source';

let liveTvCurrentId = null;
let liveTvCurrentVideoId = null;
let liveTvRefreshTimer = null;

function initLiveTv() {
  const tabsEl = document.getElementById('livetv-tabs');
  const frame = document.getElementById('livetv-frame');
  const noteEl = document.querySelector('.livetv-note');
  if (!tabsEl || !frame) return;

  let saved;
  try {
    saved = localStorage.getItem(LIVETV_KEY);
  } catch (err) {
    saved = null;
  }

  async function setSource(id) {
    const src = LIVETV_SOURCES.find((s) => s.id === id) || LIVETV_SOURCES[0];
    liveTvCurrentId = src.id;
    [...tabsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.id === src.id));
    try {
      localStorage.setItem(LIVETV_KEY, src.id);
    } catch (err) {
      /* localStorage unavailable — selection just won't persist */
    }
    liveTvCurrentVideoId = null; // force the embed to (re)load below
    await refreshLiveVideo();

    clearInterval(liveTvRefreshTimer);
    liveTvRefreshTimer = setInterval(refreshLiveVideo, 5 * 60 * 1000);
  }

  // Resolves the channel's current live video id server-side (the id itself
  // changes whenever a broadcast ends and the next one begins) and only
  // touches the iframe if it's actually different, so a periodic refresh
  // doesn't interrupt playback that's already running fine.
  async function refreshLiveVideo() {
    const src = LIVETV_SOURCES.find((s) => s.id === liveTvCurrentId);
    if (!src) return;
    try {
      const res = await fetch(`/api/livetv/${encodeURIComponent(src.channel)}`);
      const data = await res.json();
      if (!data.videoId) throw new Error(data.error || 'no live video');
      if (data.videoId !== liveTvCurrentVideoId) {
        liveTvCurrentVideoId = data.videoId;
        frame.src = `https://www.youtube-nocookie.com/embed/${data.videoId}?autoplay=1&mute=1`;
      }
      if (noteEl) noteEl.textContent = '';
    } catch (err) {
      if (noteEl && liveTvCurrentId === src.id) {
        noteEl.textContent = `${src.label} doesn't appear to be broadcasting live right now.`;
      }
    }
  }

  LIVETV_SOURCES.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'livetv-tab';
    btn.type = 'button';
    btn.textContent = s.label;
    btn.dataset.id = s.id;
    btn.addEventListener('click', () => setSource(s.id));
    tabsEl.appendChild(btn);
  });

  setSource(LIVETV_SOURCES.some((s) => s.id === saved) ? saved : LIVETV_SOURCES[0].id);
}

// ---------- Detail modal (double-click any instrument tile) ----------

let modalChart = null;
let modalSeries = null;
let modalSymbol = null;
let modalRangeIdx = 0;

function buildModalRangeButtons() {
  const wrap = document.getElementById('modal-range-controls');
  wrap.innerHTML = '';
  RANGES.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'range-btn' + (i === modalRangeIdx ? ' active' : '');
    btn.textContent = r.key;
    btn.addEventListener('click', () => {
      modalRangeIdx = i;
      [...wrap.children].forEach((c, ci) => c.classList.toggle('active', ci === i));
      loadModalData();
    });
    wrap.appendChild(btn);
  });
}

function renderModalStats(data) {
  const wrap = document.getElementById('modal-stats');
  const stats = [
    ['Day High', formatPrice(data.dayHigh, data.currency)],
    ['Day Low', formatPrice(data.dayLow, data.currency)],
    ['52W High', formatPrice(data.fiftyTwoWeekHigh, data.currency)],
    ['52W Low', formatPrice(data.fiftyTwoWeekLow, data.currency)],
    ['Prev Close', formatPrice(data.previousClose, data.currency)],
    ['Exchange', data.fullExchangeName || data.exchangeName || '—']
  ];
  if (data.volume != null) stats.push(['Volume', data.volume.toLocaleString()]);

  wrap.innerHTML = stats
    .map(
      ([label, value]) => `
    <div class="modal-stat">
      <div class="modal-stat-label">${label}</div>
      <div class="modal-stat-value">${escapeHtml(String(value))}</div>
    </div>`
    )
    .join('');
}

async function loadModalData() {
  const r = RANGES[modalRangeIdx];
  const priceEl = document.getElementById('modal-price');
  const changeEl = document.getElementById('modal-change');
  try {
    const res = await fetch(`/api/chart/${encodeURIComponent(modalSymbol)}?range=${r.range}&interval=${r.interval}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    priceEl.textContent = formatPrice(data.price, data.currency);
    const changeCls = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
    const sign = data.change > 0 ? '+' : '';
    changeEl.className = `modal-change ${changeCls}`;
    changeEl.textContent =
      data.change != null ? `${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)` : '—';

    if (modalSeries && modalChart) {
      const seriesData = data.points.map((p) => ({ time: p.time, value: p.price }));
      modalSeries.setData(seriesData);
      modalChart.timeScale().fitContent();
      applyTrendColors(modalSeries, data.change);
    }

    renderModalStats(data);
  } catch (err) {
    priceEl.textContent = 'N/A';
    changeEl.textContent = 'data unavailable';
    changeEl.className = 'modal-change flat';
  }
}

function openDetailModal(symbol, name) {
  modalSymbol = symbol;
  modalRangeIdx = 0;

  document.getElementById('modal-title').textContent = name;
  document.getElementById('modal-subtitle').textContent = symbol;
  document.getElementById('detail-modal').classList.remove('hidden');

  const canvas = document.getElementById('modal-chart-canvas');
  canvas.innerHTML = '';
  if (modalChart) {
    modalChart.remove();
    modalChart = null;
    modalSeries = null;
  }
  const built = createPriceChart(canvas);
  modalChart = built.chart;
  modalSeries = built.series;

  buildModalRangeButtons();
  loadModalData();
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  if (modalChart) {
    modalChart.remove();
    modalChart = null;
    modalSeries = null;
  }
}

document.getElementById('modal-close').addEventListener('click', closeDetailModal);
document.getElementById('detail-modal').addEventListener('click', (e) => {
  if (e.target.id === 'detail-modal') closeDetailModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetailModal();
});

// ---------- Market news ticker ----------
// One headline shown at a time, rolling to the next on the SAME 20s cycle as
// refreshAll() (not a separate timer) so it's synced with the market/FX pulse.

let newsHeadlines = [];
let newsIndex = -1;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function renderHeadline(item) {
  const wrap = document.getElementById('news-headline');
  if (!wrap) return;

  wrap.innerHTML = item
    ? `<span class="source">${escapeHtml(item.source)}</span>${
        item.link
          ? `<a class="headline-text" href="${item.link}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.headline)}">${escapeHtml(item.headline)}</a>`
          : `<span class="headline-text">${escapeHtml(item.headline)}</span>`
      }`
    : '<span class="headline-text">Headlines unavailable</span>';

  wrap.classList.remove('rolling');
  void wrap.offsetWidth; // force reflow so the roll-in restarts every time
  wrap.classList.add('rolling');
}

async function advanceNews() {
  const dot = document.querySelector('[data-role="news-live-dot"]');
  try {
    const res = await fetch('/api/news');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty');
    newsHeadlines = data;
    if (dot) dot.className = 'live-dot ok';
  } catch (err) {
    if (dot) dot.className = 'live-dot down';
  }

  if (!newsHeadlines.length) {
    renderHeadline(null);
    return;
  }
  newsIndex = (newsIndex + 1) % newsHeadlines.length;
  renderHeadline(newsHeadlines[newsIndex]);
}

async function init() {
  initFx();
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
    applySavedOrder(openGrid, sortKeyFor(openGrid));
    applySavedOrder(closedGrid, sortKeyFor(closedGrid));
    makeSortable(openGrid, sortKeyFor(openGrid));
    makeSortable(closedGrid, sortKeyFor(closedGrid));
    updateCounts();
    tickStatuses();

    initCommodities();
    initWatchlist();
    initWatchlistSearch();
    initLiveTv();

    // Dashboard-level reordering (drag a panel by its grip handle).
    const dashboardPanels = document.getElementById('dashboard-panels');
    applySavedOrder(dashboardPanels, sortKeyFor(dashboardPanels));
    makeSortable(dashboardPanels, sortKeyFor(dashboardPanels), { handleSelector: '.panel-drag-handle' });

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
