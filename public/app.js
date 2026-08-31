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

function buildMarketCard(market, removable) {
  const card = document.createElement('div');
  card.className = 'market-card sortable-item';
  card.dataset.sortId = market.id;
  card.innerHTML = `
    ${removable ? '<button class="instrument-remove market-card-remove" type="button" title="Remove this market" data-role="remove-market">✕</button>' : ''}
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

  if (removable) {
    card.querySelector('[data-role="remove-market"]').addEventListener('click', (e) => {
      e.stopPropagation();
      removeMarket(market.id);
    });
  }

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

// A no-chart, price-only row — used for the core Markets panel so it reads
// as a timer/countdown board rather than a wall of charts. Standalone market
// tiles (added via + Add Window) keep the full IndexPanel with its chart.
class MiniTicker {
  constructor(container, symbol, name) {
    this.symbol = symbol;
    this.container = container;
    container.innerHTML = `
      <span class="index-ticker-name">${name}</span>
      <span class="index-ticker-price" data-role="price">—</span>
      <span class="index-ticker-change flat" data-role="change">—</span>
    `;
    this.priceEl = container.querySelector('[data-role="price"]');
    this.changeEl = container.querySelector('[data-role="change"]');
    container.title = 'Double-click for details';
    container.addEventListener('dblclick', () => openDetailModal(symbol, name));
  }

  async load() {
    try {
      const res = await fetch(`/api/chart/${encodeURIComponent(this.symbol)}?range=1d&interval=5m`);
      const data = await res.json();
      if (data.error || data.price == null) throw new Error(data.error || 'no price');

      this.priceEl.textContent = formatPrice(data.price, data.currency);
      const changeCls = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
      const sign = data.change > 0 ? '+' : '';
      this.changeEl.className = `index-ticker-change ${changeCls}`;
      this.changeEl.textContent =
        data.change != null ? `${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)` : '—';
      return true;
    } catch (err) {
      this.priceEl.textContent = 'N/A';
      this.changeEl.textContent = '—';
      this.changeEl.className = 'index-ticker-change flat';
      return false;
    }
  }

  destroy() {}
}

function buildIndexTickers(market, card) {
  const indexesEl = card.querySelector('[data-role="indexes"]');
  indexesEl.classList.add('indexes-compact');
  market.indexes.forEach((idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'index-ticker';
    indexesEl.appendChild(rowEl);
    const ticker = new MiniTicker(rowEl, idx.symbol, idx.name);
    panels.push(ticker);
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
      // Standalone market tiles (added via the generic + menu) live in their
      // own window, not the Open/Closed grids — only relocate cards that
      // actually belong to one of those two grids.
      if (entry.autoGroup !== false) {
        const targetGrid = status.isOpen ? openGrid : closedGrid;
        targetGrid.appendChild(entry.card);
        // Land it in its previously-saved manual position within the new
        // group, rather than always at the end.
        applySavedOrder(targetGrid, sortKeyFor(targetGrid));
        groupsChanged = true;
      }
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
  if (el.id === 'bonds-grid') return 'order:bonds';
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

function makeSortable(container, storageKey, { handleSelector, afterReorder } = {}) {
  let dragEl = null;
  const draggingClass = container.id === 'dashboard-panels' ? 'panel-dragging' : 'item-dragging';

  function itemsExcept(el) {
    return [...container.children].filter((c) => c !== el && c.dataset.sortId);
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
    // 2D-aware insert direction — for a genuine matrix (multiple items per
    // row) the old "always compare Y" approach breaks down when reordering
    // left/right within the same row. Use whichever axis the pointer is
    // more offset along, relative to the target's center.
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const insertAfter = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy > 0;
    container.insertBefore(dragEl, insertAfter ? target.nextSibling : target);
  });

  container.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove(draggingClass);
    dragEl = null;
    if (afterReorder) afterReorder();
    persistOrder(container, storageKey);
  });
}

// ---------- Panel resize (generic — works the same on every panel type) ----------
// #dashboard-panels is a fixed 12-column grid so width has a well-defined
// pixel pitch to drag against (grid-column span, 2-12). Height is a literal
// pixel value set directly on the panel — deliberately NOT routed through
// CSS Grid row-spans/grid-auto-rows, which has surprising automatic-minimum-
// size interactions with panels that aren't spanning rows themselves. Height
// stays natural/auto until the user drags vertically; once engaged, the
// panel gets a fixed pixel height and its body becomes internally
// scrollable rather than growing forever. Persists per panel id as
// { col, height } (height null = still auto).
const PANEL_SPAN_KEY = 'panelspan:state';
const PANEL_SPAN_MIN = 2;
const PANEL_SPAN_MAX = 12;
const PANEL_HEIGHT_MIN = 120;

function getPanelSpanState() {
  try {
    const s = JSON.parse(localStorage.getItem(PANEL_SPAN_KEY));
    return s && typeof s === 'object' ? s : {};
  } catch (err) {
    return {};
  }
}

function setPanelSpanState(id, span) {
  const state = getPanelSpanState();
  state[id] = span;
  try {
    localStorage.setItem(PANEL_SPAN_KEY, JSON.stringify(state));
  } catch (err) {
    /* localStorage unavailable — size choice just won't persist */
  }
}

function applyPanelCol(panelEl, col) {
  const clamped = Math.min(PANEL_SPAN_MAX, Math.max(PANEL_SPAN_MIN, col));
  panelEl.style.gridColumn = `span ${clamped}`;
  return clamped;
}

function applyPanelHeight(panelEl, heightPx) {
  if (heightPx == null) {
    panelEl.classList.remove('resizable-height');
    panelEl.style.height = '';
    return null;
  }
  const clamped = Math.max(PANEL_HEIGHT_MIN, Math.round(heightPx));
  panelEl.classList.add('resizable-height');
  panelEl.style.height = `${clamped}px`;
  return clamped;
}

function initResizeHandle(panelEl, defaultCol) {
  const id = panelEl.dataset.sortId;
  const state = getPanelSpanState();
  const saved = state[id];
  applyPanelCol(panelEl, saved ? saved.col : defaultCol);
  if (saved && saved.height) applyPanelHeight(panelEl, saved.height);

  const handle = document.createElement('div');
  handle.className = 'panel-resize-handle';
  handle.title = 'Drag to resize (double-click to reset height)';
  panelEl.appendChild(handle);

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyPanelHeight(panelEl, null);
    setPanelSpanState(id, {
      col: parseInt(panelEl.style.gridColumn.replace('span ', ''), 10) || defaultCol,
      height: null
    });
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = panelEl.parentElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const startCol = parseInt((panelEl.style.gridColumn || '').replace('span ', ''), 10) || defaultCol;
    const startHeight = panelEl.getBoundingClientRect().height;
    // Approximate column pitch (track size + gap) from live geometry —
    // doesn't need to be pixel-perfect since the result snaps to whole
    // columns anyway.
    const colPitch = container.getBoundingClientRect().width / PANEL_SPAN_MAX;
    let heightEngaged = panelEl.classList.contains('resizable-height');

    panelEl.classList.add('resizing');
    handle.setPointerCapture(e.pointerId);

    function onMove(ev) {
      // Width is driven by a layout template (if one is active) — dragging
      // it manually wouldn't have any visible effect, so don't bother.
      if (getLayoutTemplate() === 'free') {
        applyPanelCol(panelEl, startCol + Math.round((ev.clientX - startX) / colPitch));
      }

      const dy = ev.clientY - startY;
      if (heightEngaged || Math.abs(dy) > 8) {
        heightEngaged = true;
        applyPanelHeight(panelEl, startHeight + dy);
      }
    }
    function onUp() {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      panelEl.classList.remove('resizing');
      const finalCol = parseInt((panelEl.style.gridColumn || '').replace('span ', ''), 10);
      const finalHeight = heightEngaged ? panelEl.getBoundingClientRect().height : null;
      setPanelSpanState(id, { col: finalCol, height: finalHeight });
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

// ---------- Layout templates (CCTV/multi-camera-viewer style presets) ----------
// "Free" is the default: every panel keeps its own individually dragged
// width. Picking 2/3/4 forces every panel to that many equal columns —
// dragging a panel's own width is disabled while a template is active
// (there'd be nothing for it to do, the CSS override always wins), height
// still drags freely either way. Whatever panel count you add, they just
// keep flowing into more rows at that same column count.
const LAYOUT_TEMPLATE_KEY = 'dashboard:template';
const LAYOUT_TEMPLATES = ['free', '2', '3', '4'];

function getLayoutTemplate() {
  try {
    const t = localStorage.getItem(LAYOUT_TEMPLATE_KEY);
    return LAYOUT_TEMPLATES.includes(t) ? t : 'free';
  } catch (err) {
    return 'free';
  }
}

function applyLayoutTemplate(template) {
  const dashboardPanels = document.getElementById('dashboard-panels');
  if (!dashboardPanels) return;
  dashboardPanels.dataset.template = template === 'free' ? '' : template;
  try {
    localStorage.setItem(LAYOUT_TEMPLATE_KEY, template);
  } catch (err) {
    /* localStorage unavailable — choice just won't persist */
  }
  document.querySelectorAll('.layout-template-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.template === template);
  });
}

function initLayoutTemplatePicker() {
  document.querySelectorAll('.layout-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyLayoutTemplate(btn.dataset.template));
  });
}

// ---------- Closing/restoring the core panels ----------
// Markets/Commodities/Bonds/Watchlist/FX get the same ✕ every other window
// has — closing one just removes it from the matrix; since these hold
// curated data rather than a single instrument, "undo" is a "Restore …"
// entry in the same + Add Window menu rather than a re-add-by-search flow.
const CLOSED_PANELS_KEY = 'closed-panels';
const CORE_PANELS = [
  { id: 'markets', label: 'Markets Panel', icon: '🗂️' },
  { id: 'commodities', label: 'Commodities Panel', icon: '🛢️' },
  { id: 'bonds', label: 'Bonds Panel', icon: '🏦' },
  { id: 'watchlist', label: 'Watchlist Panel', icon: '⭐' },
  { id: 'fx', label: 'FX Matrix', icon: '💱' }
];

function getClosedPanels() {
  try {
    const list = JSON.parse(localStorage.getItem(CLOSED_PANELS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveClosedPanels(list) {
  try {
    localStorage.setItem(CLOSED_PANELS_KEY, JSON.stringify(list));
  } catch (err) {
    /* localStorage unavailable — closed state just won't persist */
  }
}

function closeCorePanel(id) {
  const list = getClosedPanels();
  if (!list.includes(id)) list.push(id);
  saveClosedPanels(list);
  const section = document.querySelector(`.dashboard-panel[data-sort-id="${id}"]`);
  if (section) section.remove();
}

// Restoring rebuilds via a reload (same approach as switching layouts) —
// simpler and far more robust than re-deriving each panel type's build
// logic into a separately-callable path.
function restoreCorePanel(id) {
  saveClosedPanels(getClosedPanels().filter((x) => x !== id));
  location.reload();
}

function initClosePanelButtons() {
  document.querySelectorAll('[data-role="close-panel"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCorePanel(btn.dataset.panelId);
    });
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

// ---------- Commodities & Watchlist (generic ticker buckets) ----------
// Both reuse IndexPanel for their live chart/price tile — a commodity or a
// watchlist stock is just another Yahoo Finance symbol, same as an index.
// Their panels are pushed into the shared `panels` array so refreshAll()
// above picks them up automatically on the same 20s cycle. Since the two
// are functionally identical (a list of user-added tickers, each removable),
// they're both instances of the same generic factory rather than separate
// copies of the same logic.

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

function createTickerBucket(storageKey, gridId) {
  const panelsBySymbol = new Map();

  function getList() {
    try {
      const list = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveList(list) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
    } catch (err) {
      /* localStorage unavailable — just won't persist across reloads */
    }
  }

  function removeItem(symbol) {
    saveList(getList().filter((x) => x.symbol !== symbol));
    const panel = panelsBySymbol.get(symbol);
    if (panel) {
      const idx = panels.indexOf(panel);
      if (idx !== -1) panels.splice(idx, 1);
      panelsBySymbol.delete(symbol);
      panel.destroy();
    }
    const grid = document.getElementById(gridId);
    const card = [...grid.children].find((c) => c.dataset.sortId === symbol);
    if (card) card.remove();
  }

  function renderItem(item) {
    const grid = document.getElementById(gridId);
    const { card, slot } = buildInstrumentCard({ symbol: item.symbol, name: item.name, flag: '📈', removable: true });
    grid.appendChild(card);
    const panel = new IndexPanel(slot, item.symbol, item.name);
    panels.push(panel);
    panelsBySymbol.set(item.symbol, panel);
    panel.load();
    card.querySelector('[data-role="remove"]').addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item.symbol);
    });
  }

  function addItem(item) {
    const list = getList();
    if (list.some((x) => x.symbol === item.symbol)) return;
    list.push(item);
    saveList(list);
    renderItem(item);
  }

  function renderSaved() {
    getList().forEach((item) => renderItem(item));
  }

  return { addItem, removeItem, renderSaved };
}

const watchlistBucket = createTickerBucket('watchlist:tickers', 'watchlist-grid');
const commoditiesAddedBucket = createTickerBucket('commodities:added', 'commodities-grid');
const bondsAddedBucket = createTickerBucket('bonds:added', 'bonds-grid');

// Shared by Commodities and Bonds — both are "a curated fixed list, plus
// whatever the user has added" panels, same shape, just different data.
function initCuratedBucket(gridId, bootstrapKey, addedBucket) {
  const grid = document.getElementById(gridId);
  const curated = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__[bootstrapKey]) || [];
  curated.forEach((c) => {
    const { card, slot } = buildInstrumentCard({ symbol: c.symbol, name: c.name, flag: c.flag, removable: false });
    grid.appendChild(card);
    const panel = new IndexPanel(slot, c.symbol, c.unit ? `${c.name} ${c.unit}` : c.name);
    panels.push(panel);
  });
  addedBucket.renderSaved();
  applySavedOrder(grid, sortKeyFor(grid));
  makeSortable(grid, sortKeyFor(grid));
}

function initWatchlist() {
  watchlistBucket.renderSaved();
  const grid = document.getElementById('watchlist-grid');
  applySavedOrder(grid, sortKeyFor(grid));
  makeSortable(grid, sortKeyFor(grid));
}

// ---------- Generic search-add box ----------
// One reusable widget wired up three times: Watchlist and Commodities both
// search live via /api/search (any ticker is fair game for either bucket);
// Markets searches a small curated local pool instead, since a new exchange
// needs real timezone/hours metadata that a ticker symbol alone can't give us.
function initSearchAdd(inputId, resultsId, { search, onSelect, emptyText = 'No matches' }) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;
  let debounceTimer = null;

  function closeResults() {
    results.classList.remove('open');
    results.innerHTML = '';
  }

  function renderResults(items) {
    if (!items.length) {
      results.innerHTML = `<div class="watchlist-result-empty">${escapeHtml(emptyText)}</div>`;
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
        onSelect(items[i]);
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
        renderResults(await search(q));
      } catch (err) {
        renderResults([]);
      }
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) closeResults();
  });
}

async function tickerSearch(q, kind) {
  const url = kind ? `/api/search?q=${encodeURIComponent(q)}&kind=${kind}` : `/api/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

// ---------- Markets: add more exchanges from a curated pool ----------
const MARKETS_EXTRA_KEY = 'markets:extra-added';
// The 11 default exchanges (window.__BOOTSTRAP__.markets) aren't a separate
// opt-in pool like the curated "extra" exchanges — they just start visible.
// Removing one records it here instead of anywhere in MARKETS_EXTRA_KEY, and
// the search box draws from both pools so a removed default is searchable
// again exactly like anything else.
const CORE_MARKETS_REMOVED_KEY = 'markets:core-removed';

function getExtraMarketIds() {
  try {
    const list = JSON.parse(localStorage.getItem(MARKETS_EXTRA_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveExtraMarketIds(ids) {
  try {
    localStorage.setItem(MARKETS_EXTRA_KEY, JSON.stringify(ids));
  } catch (err) {
    /* localStorage unavailable — just won't persist across reloads */
  }
}

function getRemovedCoreMarketIds() {
  try {
    const list = JSON.parse(localStorage.getItem(CORE_MARKETS_REMOVED_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveRemovedCoreMarketIds(ids) {
  try {
    localStorage.setItem(CORE_MARKETS_REMOVED_KEY, JSON.stringify(ids));
  } catch (err) {
    /* localStorage unavailable — just won't persist across reloads */
  }
}

function isCoreMarket(marketId) {
  const corePool = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__.markets) || [];
  return corePool.some((m) => m.id === marketId);
}

function addMarketToDom(market) {
  const status = computeMarketStatus(market, new Date());
  const entry = buildMarketCard(market, true);
  entry.isOpen = status.isOpen;
  (status.isOpen ? openGrid : closedGrid).appendChild(entry.card);
  applySavedOrder(entry.card.parentElement, sortKeyFor(entry.card.parentElement));
  buildIndexTickers(market, entry.card);
  updateCounts();
}

// Handles both pools: a default exchange the user removed earlier just gets
// un-removed; anything else joins the curated "extra" list, same as before.
function addMarket(market) {
  if (isCoreMarket(market.id)) {
    saveRemovedCoreMarketIds(getRemovedCoreMarketIds().filter((id) => id !== market.id));
  } else {
    const ids = getExtraMarketIds();
    if (ids.includes(market.id)) return;
    ids.push(market.id);
    saveExtraMarketIds(ids);
  }
  addMarketToDom(market);
}

function removeMarket(marketId) {
  if (isCoreMarket(marketId)) {
    const removed = getRemovedCoreMarketIds();
    if (!removed.includes(marketId)) removed.push(marketId);
    saveRemovedCoreMarketIds(removed);
  } else {
    saveExtraMarketIds(getExtraMarketIds().filter((id) => id !== marketId));
  }

  const entry = statusEls.find((e) => e.market.id === marketId);
  if (!entry) return;
  for (let i = panels.length - 1; i >= 0; i--) {
    if (entry.card.contains(panels[i].container)) {
      panels[i].destroy();
      panels.splice(i, 1);
    }
  }
  entry.card.remove();
  const idx = statusEls.indexOf(entry);
  if (idx !== -1) statusEls.splice(idx, 1);
  updateCounts();
}

function initMarketsSearch() {
  initSearchAdd('markets-input', 'markets-results', {
    emptyText: 'No matching exchange (or already added)',
    search: (q) => {
      const corePool = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__.markets) || [];
      const extraPool = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__.marketsExtra) || [];
      const removedCore = new Set(getRemovedCoreMarketIds());
      const addedExtra = new Set(getExtraMarketIds());
      // "Already shown" (excluded from results) = default exchanges still
      // visible, plus extras the user has already added — everything else
      // (removed defaults included) is fair game to search back up.
      const shown = new Set([
        ...corePool.filter((m) => !removedCore.has(m.id)).map((m) => m.id),
        ...extraPool.filter((m) => addedExtra.has(m.id)).map((m) => m.id)
      ]);
      const ql = q.toLowerCase();
      return [...corePool, ...extraPool]
        .filter((m) => !shown.has(m.id))
        .filter(
          (m) =>
            m.name.toLowerCase().includes(ql) ||
            m.country.toLowerCase().includes(ql) ||
            m.shortName.toLowerCase().includes(ql)
        )
        .slice(0, 8)
        .map((m) => ({ symbol: m.shortName, name: m.name, exchange: m.country, _market: m }));
    },
    onSelect: (item) => addMarket(item._market)
  });
}

// ---------- Live TV (multi-tile) ----------
// Official YouTube live streams. Each tile resolves its channel's CURRENTLY
// live video id server-side (via /api/livetv/:channel) and embeds that
// specific video through the standard /embed/VIDEO_ID pattern — the
// live_stream?channel= parameter form was tried first but turned out to
// work for some channels (Bloomberg, CNBC) and not others (NBC, Sky) for
// undocumented reasons. Not scraping or bypassing anything — this is
// YouTube's own sanctioned embed API. CNN isn't in the list because their
// live feed is paywalled; no free public stream exists.
//
// Any number of tiles can exist side by side (a real matrix, not a single
// switcher) — click the "+" ghost tile to add one, the × on a tile's handle
// to remove it. The set of tiles + each one's selected source persists to
// localStorage; panel POSITION persists separately via the normal
// dashboard-panels sortable (sortKeyFor/applySavedOrder), same as every
// other panel.
const LIVETV_SOURCES = [
  { id: 'bloomberg', label: 'Bloomberg TV', channel: 'UCIALMKvObZNtJ6AmdCLP7Lg' },
  { id: 'nbc', label: 'NBC News NOW', channel: 'UCeY0bbntWzzVIaj2z3QigXg' },
  { id: 'cnbc', label: 'CNBC', channel: 'UCvJJ_dzjViJCoLf5uKUTwoA' },
  { id: 'sky', label: 'Sky News', channel: 'UCoMdktPbSTixAyNGwb-UYkQ' }
];
const LIVETV_TILES_KEY = 'livetv:tiles';

function getLiveTvTiles() {
  try {
    const list = JSON.parse(localStorage.getItem(LIVETV_TILES_KEY));
    if (Array.isArray(list) && list.length) return list;
  } catch (err) {
    /* fall through to default */
  }
  return [{ id: 'livetv-1', sourceId: LIVETV_SOURCES[0].id }];
}

function saveLiveTvTiles() {
  const tiles = [...document.querySelectorAll('.dashboard-panel[data-livetv-tile]')].map((p) => ({
    id: p.dataset.sortId,
    sourceId: p.dataset.currentSource || LIVETV_SOURCES[0].id
  }));
  try {
    localStorage.setItem(LIVETV_TILES_KEY, JSON.stringify(tiles));
  } catch (err) {
    /* localStorage unavailable — tile set just won't persist */
  }
}

function buildLiveTvPanel(tileId, initialSourceId) {
  const section = document.createElement('section');
  section.className = 'dashboard-panel';
  section.dataset.sortId = tileId;
  section.dataset.livetvTile = 'true';
  section.dataset.currentSource = initialSourceId;
  section.innerHTML = `
    <div class="panel-drag-handle" draggable="true">
      <span><span class="grip">⠿</span> LIVE TV</span>
      <span class="panel-handle-actions">
        <button class="instrument-remove" type="button" data-role="remove" title="Remove this tile">✕</button>
      </span>
    </div>
    <div class="livetv-main">
      <div class="livetv-tabs" data-role="tabs"></div>
      <div class="livetv-frame-wrap">
        <iframe
          class="livetv-frame"
          data-role="frame"
          src=""
          title="Live news stream"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen
          frameborder="0"
        ></iframe>
      </div>
      <p class="livetv-note" data-role="note"></p>
    </div>
  `;

  const tabsEl = section.querySelector('[data-role="tabs"]');
  const frame = section.querySelector('[data-role="frame"]');
  const noteEl = section.querySelector('[data-role="note"]');
  let currentVideoId = null;
  let refreshTimer = null;

  async function refreshLiveVideo() {
    const src = LIVETV_SOURCES.find((s) => s.id === section.dataset.currentSource);
    if (!src) return;
    try {
      const res = await fetch(`/api/livetv/${encodeURIComponent(src.channel)}`);
      const data = await res.json();
      if (!data.videoId) throw new Error(data.error || 'no live video');
      if (data.videoId !== currentVideoId) {
        currentVideoId = data.videoId;
        frame.src = `https://www.youtube-nocookie.com/embed/${data.videoId}?autoplay=1&mute=1`;
      }
      noteEl.textContent = '';
    } catch (err) {
      if (section.dataset.currentSource === src.id) {
        noteEl.textContent = `${src.label} doesn't appear to be broadcasting live right now.`;
      }
    }
  }

  function setSource(id) {
    const src = LIVETV_SOURCES.find((s) => s.id === id) || LIVETV_SOURCES[0];
    section.dataset.currentSource = src.id;
    [...tabsEl.children].forEach((b) => b.classList.toggle('active', b.dataset.id === src.id));
    currentVideoId = null; // force the embed to (re)load
    refreshLiveVideo();
    saveLiveTvTiles();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshLiveVideo, 5 * 60 * 1000);
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

  section.querySelector('[data-role="remove"]').addEventListener('click', (e) => {
    e.stopPropagation();
    clearInterval(refreshTimer);
    section.remove();
    saveLiveTvTiles();
  });

  setSource(initialSourceId);
  initResizeHandle(section, 4); // TV tiles default to a third of the width
  return section;
}

function initLiveTv() {
  const dashboardPanels = document.getElementById('dashboard-panels');
  if (!dashboardPanels) return;
  getLiveTvTiles().forEach((tile) => {
    dashboardPanels.appendChild(buildLiveTvPanel(tile.id, tile.sourceId));
  });
}

// ---------- Generic "+ Add Window" system ----------
// One "+" tile, at the end of the matrix, offering every addable window
// type through the same menu — not just Live TV. Live TV creates a tile
// immediately; the others (Stock/Commodity/Bond/Market) open a small
// inline search first. All resulting tiles are plain, generic
// .dashboard-panel containers (draggable/resizable/removable the same way
// as everything else) — the only thing that differs between them is what
// gets built into the body.

const STANDALONE_TILES_KEY = 'standalone:tiles';

function getStandaloneTiles() {
  try {
    const list = JSON.parse(localStorage.getItem(STANDALONE_TILES_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveStandaloneTilesList(list) {
  try {
    localStorage.setItem(STANDALONE_TILES_KEY, JSON.stringify(list));
  } catch (err) {
    /* localStorage unavailable — just won't persist across reloads */
  }
}

function addStandaloneTileRecord(record) {
  const list = getStandaloneTiles();
  list.push(record);
  saveStandaloneTilesList(list);
}

function removeStandaloneTileRecord(id) {
  saveStandaloneTilesList(getStandaloneTiles().filter((t) => t.id !== id));
}

function newTileId() {
  return `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createStandaloneInstrumentTile(item, dashboardPanels, addTileEl, existingId) {
  const id = existingId || newTileId();
  const section = document.createElement('section');
  section.className = 'dashboard-panel';
  section.dataset.sortId = id;
  section.dataset.standaloneTile = 'true';
  section.innerHTML = `
    <div class="panel-drag-handle" draggable="true">
      <span><span class="grip">⠿</span> ${escapeHtml(item.name || item.symbol)}</span>
      <span class="panel-handle-actions">
        <button class="instrument-remove" type="button" data-role="remove" title="Remove">✕</button>
      </span>
    </div>
    <div class="index-card panel-body" data-role="slot"></div>
  `;
  dashboardPanels.insertBefore(section, addTileEl);

  const slot = section.querySelector('[data-role="slot"]');
  const panel = new IndexPanel(slot, item.symbol, item.name);
  panels.push(panel);
  panel.load();
  initResizeHandle(section, 4);

  section.querySelector('[data-role="remove"]').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = panels.indexOf(panel);
    if (idx !== -1) panels.splice(idx, 1);
    panel.destroy();
    section.remove();
    removeStandaloneTileRecord(id);
  });

  if (!existingId) addStandaloneTileRecord({ id, kind: 'ticker', symbol: item.symbol, name: item.name });
}

function createStandaloneMarketTile(market, dashboardPanels, addTileEl, existingId) {
  const id = existingId || newTileId();
  const section = document.createElement('section');
  section.className = 'dashboard-panel';
  section.dataset.sortId = id;
  section.dataset.standaloneTile = 'true';
  section.innerHTML = `
    <div class="panel-drag-handle" draggable="true">
      <span><span class="grip">⠿</span> ${escapeHtml(market.shortName || market.name)}</span>
      <span class="panel-handle-actions">
        <button class="instrument-remove" type="button" data-role="remove" title="Remove">✕</button>
      </span>
    </div>
    <div class="panel-body" data-role="body"></div>
  `;
  dashboardPanels.insertBefore(section, addTileEl);

  const entry = buildMarketCard(market, false);
  entry.autoGroup = false; // lives in its own window — tickStatuses() shouldn't relocate it into Open/Closed
  section.querySelector('[data-role="body"]').appendChild(entry.card);
  buildIndexPanels(market, entry.card);
  initResizeHandle(section, 5);

  section.querySelector('[data-role="remove"]').addEventListener('click', (e) => {
    e.stopPropagation();
    for (let i = panels.length - 1; i >= 0; i--) {
      if (entry.card.contains(panels[i].container)) {
        panels[i].destroy();
        panels.splice(i, 1);
      }
    }
    const si = statusEls.indexOf(entry);
    if (si !== -1) statusEls.splice(si, 1);
    section.remove();
    removeStandaloneTileRecord(id);
  });

  if (!existingId) addStandaloneTileRecord({ id, kind: 'market', marketId: market.id });
}

function openInlineSearchPopover(anchorEl, { placeholder, search, onSelect }) {
  const wrap = document.createElement('div');
  wrap.className = 'add-window-search';
  wrap.innerHTML = `
    <input type="text" class="watchlist-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    <div class="watchlist-results"></div>
  `;
  anchorEl.appendChild(wrap);
  const input = wrap.querySelector('input');
  const results = wrap.querySelector('.watchlist-results');
  input.focus();
  let debounceTimer = null;

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
        onSelect(items[i]);
        wrap.remove();
      });
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      results.classList.remove('open');
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        renderResults(await search(q));
      } catch (err) {
        renderResults([]);
      }
    }, 250);
  });

  document.addEventListener(
    'click',
    function onDocClick(e) {
      if (!wrap.contains(e.target)) {
        wrap.remove();
        document.removeEventListener('click', onDocClick, true);
      }
    },
    true
  );
}

function searchMarketsPool(q) {
  const pool = [
    ...((window.__BOOTSTRAP__ && window.__BOOTSTRAP__.markets) || []),
    ...((window.__BOOTSTRAP__ && window.__BOOTSTRAP__.marketsExtra) || [])
  ];
  const ql = q.toLowerCase();
  return pool
    .filter((m) => m.name.toLowerCase().includes(ql) || m.country.toLowerCase().includes(ql) || m.shortName.toLowerCase().includes(ql))
    .slice(0, 8)
    .map((m) => ({ symbol: m.shortName, name: m.name, exchange: m.country, _market: m }));
}

function initAddWindowMenu() {
  const dashboardPanels = document.getElementById('dashboard-panels');
  if (!dashboardPanels) return;

  const tile = document.createElement('div');
  tile.className = 'dashboard-panel add-panel-tile';
  tile.innerHTML = `
    <span class="add-panel-plus">+</span><span>Add Window</span>
    <div class="add-window-menu hidden" data-role="menu">
      <button type="button" data-type="livetv">📺 Live TV</button>
      <button type="button" data-type="ticker">📈 Stock / Ticker</button>
      <button type="button" data-type="commodity">🛢️ Commodity</button>
      <button type="button" data-type="bond">🏦 Bond</button>
      <button type="button" data-type="market">🌍 Market</button>
      <div data-role="restore-slot"></div>
    </div>
  `;
  const menu = tile.querySelector('[data-role="menu"]');
  const restoreSlot = menu.querySelector('[data-role="restore-slot"]');

  // Rebuilt on every open (not just once at page load) — a panel closed
  // earlier in the same session needs to show up here without a reload.
  function renderRestoreButtons() {
    const closedIds = getClosedPanels();
    restoreSlot.innerHTML = CORE_PANELS.filter((p) => closedIds.includes(p.id))
      .map((p) => `<button type="button" data-restore="${p.id}">${p.icon} ${escapeHtml(p.label)}</button>`)
      .join('');
    restoreSlot.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreCorePanel(btn.dataset.restore);
      });
    });
  }
  renderRestoreButtons();

  tile.addEventListener('click', (e) => {
    if (e.target.closest('[data-role="menu"]')) return;
    if (menu.classList.contains('hidden')) renderRestoreButtons();
    menu.classList.toggle('hidden');
  });

  const searchLabels = {
    ticker: 'a stock, ETF, or index…',
    commodity: 'a commodity or future…',
    bond: 'a bond or yield ETF…'
  };

  menu.querySelectorAll('button[data-type]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.add('hidden');
      const type = btn.dataset.type;

      if (type === 'livetv') {
        const newTile = buildLiveTvPanel(newTileId(), LIVETV_SOURCES[0].id);
        dashboardPanels.insertBefore(newTile, tile);
        saveLiveTvTiles();
        return;
      }

      if (type === 'market') {
        openInlineSearchPopover(tile, {
          placeholder: 'Search any exchange…',
          search: searchMarketsPool,
          onSelect: (item) => createStandaloneMarketTile(item._market, dashboardPanels, tile)
        });
        return;
      }

      openInlineSearchPopover(tile, {
        placeholder: `Search ${searchLabels[type]}`,
        search: (q) => tickerSearch(q, type === 'ticker' ? undefined : type),
        onSelect: (item) => createStandaloneInstrumentTile(item, dashboardPanels, tile)
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!tile.contains(e.target)) menu.classList.add('hidden');
  });

  // The "+" tile must be attached before rebuilding saved standalone tiles —
  // insertBefore(node, tile) requires `tile` to already be a child.
  dashboardPanels.appendChild(tile);

  const marketsPool = [
    ...((window.__BOOTSTRAP__ && window.__BOOTSTRAP__.markets) || []),
    ...((window.__BOOTSTRAP__ && window.__BOOTSTRAP__.marketsExtra) || [])
  ];
  getStandaloneTiles().forEach((rec) => {
    if (rec.kind === 'market') {
      const market = marketsPool.find((m) => m.id === rec.marketId);
      if (market) createStandaloneMarketTile(market, dashboardPanels, tile, rec.id);
    } else {
      createStandaloneInstrumentTile({ symbol: rec.symbol, name: rec.name }, dashboardPanels, tile, rec.id);
    }
  });

  return tile;
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

// ---------- Saved dashboard layouts ----------
// A "layout" is just a named snapshot of every localStorage key that
// describes the current arrangement (panel order/width, market-card order,
// commodities/watchlist order, the watchlist itself, the set of Live TV
// tiles). Switching layouts writes that snapshot back and reloads the page
// — simpler and far more robust than trying to tear down and rebuild every
// dynamic section (charts, timers, intervals) in place.
const LAYOUTS_LIST_KEY = 'layouts:list';
const LAYOUTS_ACTIVE_KEY = 'layouts:active';
const LAYOUT_STATE_KEYS = [
  'order:dashboard-panels',
  'order:markets-open',
  'order:markets-closed',
  'order:commodities',
  'order:bonds',
  'order:watchlist',
  'watchlist:tickers',
  'commodities:added',
  'bonds:added',
  MARKETS_EXTRA_KEY,
  CORE_MARKETS_REMOVED_KEY,
  'livetv:tiles',
  STANDALONE_TILES_KEY,
  PANEL_SPAN_KEY,
  LAYOUT_TEMPLATE_KEY,
  CLOSED_PANELS_KEY
];

function getLayoutList() {
  try {
    const list = JSON.parse(localStorage.getItem(LAYOUTS_LIST_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveLayoutList(list) {
  try {
    localStorage.setItem(LAYOUTS_LIST_KEY, JSON.stringify(list));
  } catch (err) {
    /* localStorage unavailable — layouts just won't persist */
  }
}

function getActiveLayoutId() {
  try {
    return localStorage.getItem(LAYOUTS_ACTIVE_KEY);
  } catch (err) {
    return null;
  }
}

function saveCurrentAsLayout(name) {
  const id = `layout-${Date.now()}`;
  const list = getLayoutList();
  list.push({ id, name });
  saveLayoutList(list);

  const snap = {};
  LAYOUT_STATE_KEYS.forEach((k) => {
    snap[k] = localStorage.getItem(k);
  });
  try {
    localStorage.setItem(`layouts:data:${id}`, JSON.stringify(snap));
    localStorage.setItem(LAYOUTS_ACTIVE_KEY, id);
  } catch (err) {
    /* localStorage unavailable — layout just won't persist */
  }
  renderLayoutTabs();
}

function switchToLayout(id) {
  let snap;
  try {
    snap = JSON.parse(localStorage.getItem(`layouts:data:${id}`));
  } catch (err) {
    snap = null;
  }
  if (!snap) return;

  LAYOUT_STATE_KEYS.forEach((k) => {
    const v = snap[k];
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (err) {
      /* localStorage unavailable */
    }
  });
  try {
    localStorage.setItem(LAYOUTS_ACTIVE_KEY, id);
  } catch (err) {
    /* localStorage unavailable */
  }
  location.reload();
}

function deleteLayout(id) {
  saveLayoutList(getLayoutList().filter((l) => l.id !== id));
  try {
    localStorage.removeItem(`layouts:data:${id}`);
    if (getActiveLayoutId() === id) localStorage.removeItem(LAYOUTS_ACTIVE_KEY);
  } catch (err) {
    /* localStorage unavailable */
  }
  renderLayoutTabs();
}

function renderLayoutTabs() {
  const tabsEl = document.getElementById('layouts-tabs');
  if (!tabsEl) return;
  const list = getLayoutList();
  const active = getActiveLayoutId();

  tabsEl.innerHTML = '';
  list.forEach((l) => {
    const tab = document.createElement('span');
    tab.className = 'layout-tab' + (l.id === active ? ' active' : '');
    tab.innerHTML = `
      <button class="layout-tab-name" type="button">${escapeHtml(l.name)}</button>
      <button class="layout-tab-remove" type="button" title="Delete layout">✕</button>
    `;
    tab.querySelector('.layout-tab-name').addEventListener('click', () => switchToLayout(l.id));
    tab.querySelector('.layout-tab-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete the "${l.name}" layout? This can't be undone.`)) deleteLayout(l.id);
    });
    tabsEl.appendChild(tab);
  });
}

renderLayoutTabs();
initLayoutTemplatePicker();
const layoutsSaveBtn = document.getElementById('layouts-save-btn');
if (layoutsSaveBtn) {
  layoutsSaveBtn.addEventListener('click', () => {
    const name = prompt('Name this layout:', `Layout ${getLayoutList().length + 1}`);
    if (name && name.trim()) saveCurrentAsLayout(name.trim());
  });
}

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
  // Closed core panels were removed from the DOM by the user's ✕ click on a
  // previous visit; re-derive that here (rather than trusting the server-
  // rendered HTML, which always includes all five) before anything below
  // tries to build content into a panel that isn't there.
  const closedIds = new Set(getClosedPanels());
  closedIds.forEach((id) => {
    const section = document.querySelector(`.dashboard-panel[data-sort-id="${id}"]`);
    if (section) section.remove();
  });
  initClosePanelButtons();

  if (!closedIds.has('fx')) initFx();
  const main = closedIds.has('markets') ? null : document.getElementById('markets-main');
  try {
    const markets = window.__BOOTSTRAP__.markets;

    if (main) {
    main.innerHTML = `
      <div class="watchlist-search">
        <input
          type="text"
          id="markets-input"
          class="watchlist-input"
          placeholder="Add another exchange (e.g. Toronto, Korea)…"
          autocomplete="off"
        />
        <div class="watchlist-results" id="markets-results"></div>
      </div>
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
    // Extra markets the user has previously added (from the curated pool)
    // join the core 11 here; every card is removable — the "core 11" is just
    // a starting point, not a fixed set (removed ones are tracked separately
    // and stay searchable again via initMarketsSearch).
    const now = new Date();
    const removedCoreIds = new Set(getRemovedCoreMarketIds());
    const extraPool = (window.__BOOTSTRAP__ && window.__BOOTSTRAP__.marketsExtra) || [];
    const extraIds = new Set(getExtraMarketIds());
    const extraMarkets = extraPool.filter((m) => extraIds.has(m.id));
    const withStatus = [
      ...markets.filter((m) => !removedCoreIds.has(m.id)).map((market) => ({ market, status: computeMarketStatus(market, now) })),
      ...extraMarkets.map((market) => ({ market, status: computeMarketStatus(market, now) }))
    ];
    withStatus.sort((a, b) => a.status.target - b.status.target);

    withStatus.forEach(({ market, status }) => {
      const entry = buildMarketCard(market, true);
      entry.isOpen = status.isOpen;
      (status.isOpen ? openGrid : closedGrid).appendChild(entry.card);
      buildIndexTickers(market, entry.card);
    });
    applySavedOrder(openGrid, sortKeyFor(openGrid));
    applySavedOrder(closedGrid, sortKeyFor(closedGrid));
    makeSortable(openGrid, sortKeyFor(openGrid));
    makeSortable(closedGrid, sortKeyFor(closedGrid));
    updateCounts();
    tickStatuses();
    initMarketsSearch();
    }

    if (!closedIds.has('commodities')) {
      initCuratedBucket('commodities-grid', 'commodities', commoditiesAddedBucket);
      initSearchAdd('commodities-input', 'commodities-results', {
        search: (q) => tickerSearch(q, 'commodity'),
        emptyText: 'No matching commodity/future',
        onSelect: (item) => commoditiesAddedBucket.addItem({ symbol: item.symbol, name: item.name })
      });
    }
    if (!closedIds.has('bonds')) {
      initCuratedBucket('bonds-grid', 'bonds', bondsAddedBucket);
      initSearchAdd('bonds-input', 'bonds-results', {
        search: (q) => tickerSearch(q, 'bond'),
        emptyText: 'No matching bond/yield',
        onSelect: (item) => bondsAddedBucket.addItem({ symbol: item.symbol, name: item.name })
      });
    }
    if (!closedIds.has('watchlist')) {
      initWatchlist();
      initSearchAdd('watchlist-input', 'watchlist-results', {
        search: tickerSearch,
        onSelect: (item) => watchlistBucket.addItem({ symbol: item.symbol, name: item.name })
      });
    }
    initLiveTv();
    const addWindowBtn = initAddWindowMenu();

    // Dashboard-level reordering (drag a panel by its grip handle). The
    // "+" add-window ghost must always stay last — applySavedOrder moves
    // saved-order panels to the end in sequence, which would otherwise
    // shuffle it out of trailing position, so re-pin it after.
    const dashboardPanels = document.getElementById('dashboard-panels');
    [...dashboardPanels.querySelectorAll('.dashboard-panel[data-sort-id]')].forEach((p) => {
      // Core panels default to full width; standalone tiles already got
      // initResizeHandle called (with their own default) when they were built.
      if (!p.dataset.livetvTile && !p.dataset.standaloneTile) initResizeHandle(p, 12);
    });
    applySavedOrder(dashboardPanels, sortKeyFor(dashboardPanels));
    if (addWindowBtn) dashboardPanels.appendChild(addWindowBtn);
    applyLayoutTemplate(getLayoutTemplate());
    makeSortable(dashboardPanels, sortKeyFor(dashboardPanels), {
      handleSelector: '.panel-drag-handle',
      afterReorder: () => addWindowBtn && dashboardPanels.appendChild(addWindowBtn)
    });

    // Refresh live prices/charts/FX as often as the free API comfortably allows
    // (backend caches responses for ~20s, so this stays close to real-time).
    // The logo flicker and API health log below it are driven by this same cycle.
    await refreshAll();
    setInterval(refreshAll, 20000);
  } catch (err) {
    if (main) main.innerHTML = `<p class="loading">Failed to load market data: ${err.message}</p>`;
  }
}

init();
