"use strict";

const THEME_KEY = "ttfmCapitalPlanner.theme";

(function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved === "light" || saved === "dark"
      ? saved
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

function initPlanner() {
  "use strict";

  const STORE_KEY = "ttfmCapitalPlanner.v1";
  const HISTORY_KEY = "ttfmCapitalPlanner.history.v1";
  const MAX_PLANS = 4;
  const MAX_STEPS = 2000;
  const DEFAULT_PAGE_SIZE = 10;
  const PAGE_SIZE_KEY = "ttfmCapitalPlanner.pageSize";
  const RISK_DEFAULTS = [1, 2, 3, 4, 5];
  const RR_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5];
  const LOSS_SCENARIOS = [3, 5, 10];
  const PLAN_PRESETS = [
    { start: 100, target: 200, risk: 0.05, rr: 2 },
    { start: 200, target: 400, risk: 0.03, rr: 2 },
    { start: 500, target: 1000, risk: 0.02, rr: 3 },
    { start: 1000, target: 2500, risk: 0.02, rr: 2 }
  ];

  const money = (n) => Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    : "—";
  const pct = (n) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const riskPercent = (risk) => {
    const value = Number(risk) * 100;
    return Number.isFinite(value) ? Number(value.toFixed(4)) : NaN;
  };
  const formatPercent = (value) => Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : "—";
  const riskLabel = (risk) => `${formatPercent(riskPercent(risk))} risk`;
  const formatRR = (rr) => `${Number(rr)}R reward`;

  const plansEl = document.getElementById("planTable");
  const roadSelect = document.getElementById("roadmapSelect");
  const themeBtn = document.getElementById("themeBtn");
  const roadmapEl = document.getElementById("roadmap");
  const addBtn = document.getElementById("addBtn");

  let state = { plans: [], selectedId: null };
  let history = [];
  let toastTimer;
  let roadmapPage = 1;
  let roadmapPlanId = null;
  let pageSize = DEFAULT_PAGE_SIZE;
  let dragState = null;

  function clampNum(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  function createPlan(name, preset) {
    const id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      name,
      start: preset.start,
      target: preset.target,
      risk: preset.risk,
      rr: preset.rr,
      riskOverrides: {}
    };
  }

  function defaultPlans() {
    return PLAN_PRESETS.slice(0, 2).map((preset, i) =>
      createPlan(`Plan ${String.fromCharCode(65 + i)}`, preset)
    );
  }

  function getPlan(id) {
    return state.plans.find((p) => p.id === id);
  }

  function safeRead(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      showToast("Browser storage is unavailable; export a backup.");
    }
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2300);
  }

  function normalizeOverrides(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean;

    Object.keys(raw).forEach((key) => {
      const row = Number(key);
      const risk = Number(raw[key]);
      if (Number.isInteger(row) && row > 0 && row <= MAX_STEPS && Number.isFinite(risk) && risk > 0 && risk <= 1) {
        clean[row] = risk;
      }
    });

    return clean;
  }

  function planOverrides(p) {
    return normalizeOverrides(p && p.riskOverrides);
  }

  function normalize() {
    if (!state || !Array.isArray(state.plans)) state = { plans: [], selectedId: null };

    state.plans = state.plans.map((p, i) => {
      const fallbackName = `Plan ${String.fromCharCode(65 + i)}`;
      return {
        id: String(p.id || `plan-${i}`),
        name: String(p.name || fallbackName).trim().slice(0, 30) || fallbackName,
        start: clampNum(p.start, 100, 0.01, 1e12),
        target: clampNum(p.target, 200, 0.01, 1e12),
        risk: clampNum(p.risk, 0.05, 0.001, 1),
        rr: RR_OPTIONS.includes(Number(p.rr)) ? Number(p.rr) : 2,
        riskOverrides: normalizeOverrides(p.riskOverrides)
      };
    });

    if (!state.plans.length) state.plans = defaultPlans();
    if (!state.plans.some((p) => p.id === state.selectedId)) state.selectedId = state.plans[0].id;
    if (!Array.isArray(history)) history = [];
  }

  function simulateRows(p, limit) {
    const overrides = planOverrides(p);
    const defaultRisk = Number(p.risk);
    const rr = Number(p.rr);
    const target = Number(p.target);
    let balance = Number(p.start);
    const rows = [];
    let reached = false;

    for (let n = 1; n <= limit; n++) {
      const risk = overrides[n] || defaultRisk;
      const cashRisk = balance * risk;
      const profit = cashRisk * rr;
      const end = balance + profit;
      const hit = end >= target;

      rows.push({
        n,
        balance,
        risk,
        cashRisk,
        profit,
        end,
        reached: hit,
        custom: Boolean(overrides[n])
      });

      balance = end;
      if (hit) {
        reached = true;
        break;
      }
    }

    return { rows, balance, reached };
  }

  function calculate(p) {
    const start = Number(p.start);
    const target = Number(p.target);
    const risk = Number(p.risk);
    const rr = Number(p.rr);

    if (!Number.isFinite(start) || start <= 0) {
      return { valid: false, reason: "Enter a starting balance." };
    }
    if (!Number.isFinite(target) || target <= start) {
      return { valid: false, reason: "Target must be above the starting balance." };
    }
    if (!(risk > 0) || !(rr > 0)) {
      return { valid: false, reason: "Check the risk settings." };
    }

    const factor = 1 + risk * rr;
    const overrides = planOverrides(p);
    const lastOverride = Object.keys(overrides).reduce((max, key) => Math.max(max, Number(key)), 0);
    let trades;
    let projected;

    if (lastOverride > 0) {
      const sim = simulateRows(p, lastOverride);

      if (sim.reached) {
        trades = sim.rows.length;
        projected = sim.balance;
      } else {
        const remaining = Math.max(
          1,
          Math.ceil(Math.log(target / sim.balance) / Math.log(factor) - 1e-12)
        );
        trades = sim.rows.length + remaining;
        projected = sim.balance * Math.pow(factor, remaining);
      }
    } else {
      trades = Math.ceil(Math.log(target / start) / Math.log(factor) - 1e-12);
      projected = start * Math.pow(factor, trades);
    }

    return {
      valid: true,
      trades,
      projected,
      gain: projected - start,
      returnPct: projected / start - 1,
      factor
    };
  }

  function lossStress(p, losses) {
    const start = Number(p.start);
    const risk = Number(p.risk);

    if (!Number.isFinite(start) || start <= 0) {
      return { valid: false, reason: "Enter a starting balance." };
    }
    if (!Number.isFinite(risk) || risk <= 0 || risk > 1) {
      return { valid: false, reason: "Risk must be between 0% and 100%." };
    }

    const remaining = start * Math.pow(1 - risk, losses);
    const totalLoss = start - remaining;
    const drawdown = (start - remaining) / start;
    const nextRisk = remaining * risk;
    const wipedOut = remaining <= 0;
    const recovery = wipedOut ? NaN : start / remaining - 1;

    if (![remaining, totalLoss, drawdown, nextRisk].every(Number.isFinite)) {
      return { valid: false, reason: "Check inputs." };
    }

    return {
      valid: true,
      losses,
      remaining,
      totalLoss,
      drawdown,
      nextRisk,
      recovery,
      wipedOut
    };
  }

  function selectedClass(p, base) {
    const classes = [];
    if (base) classes.push(base);
    if (p.id === state.selectedId) classes.push("is-selected");
    return classes.length ? ` class="${classes.join(" ")}"` : "";
  }

  function compareMarkup() {
    const headCells = state.plans.map((p, i) => `
      <th class="plan-col${p.id === state.selectedId ? " is-selected" : ""}" data-head-id="${esc(p.id)}" scope="col">
        <div class="plan-head">
          <span class="drag-handle" data-drag-handle="${esc(p.id)}" role="button" tabindex="0"
            title="Drag to reorder plan. Use left/right arrow keys when focused." aria-label="Reorder ${esc(p.name)}">
            <svg viewBox="0 0 10 16" aria-hidden="true">
              <circle cx="2.5" cy="3" r="1.15"></circle><circle cx="7.5" cy="3" r="1.15"></circle>
              <circle cx="2.5" cy="8" r="1.15"></circle><circle cx="7.5" cy="8" r="1.15"></circle>
              <circle cx="2.5" cy="13" r="1.15"></circle><circle cx="7.5" cy="13" r="1.15"></circle>
            </svg>
          </span>
          <input class="name-input" type="text" data-field="name" data-id="${esc(p.id)}" data-prev="${esc(p.name)}"
            value="${esc(p.name)}" maxlength="30" aria-label="Plan ${i + 1} name">
          <button class="icon-btn remove-btn" type="button" data-action="remove" data-id="${esc(p.id)}"
            title="Remove plan" aria-label="Remove ${esc(p.name)}"${state.plans.length <= 1 ? " disabled" : ""}>×</button>
        </div>
        <div class="plan-meta">
          <span class="tag" data-role="riskTag" data-id="${esc(p.id)}">${riskLabel(p.risk)}</span>
          <span class="badge" data-role="bestBadge" data-id="${esc(p.id)}">Fastest</span>
        </div>
      </th>`).join("");

    const inputRow = (label, field, attrs) => `
      <tr>
        <th class="row-label" scope="row">${label}</th>
        ${state.plans.map((p) => `
          <td${selectedClass(p)} data-id="${esc(p.id)}">
            <input type="number" inputmode="decimal" data-field="${field}" data-id="${esc(p.id)}"
              data-prev="${p[field]}" value="${p[field]}" ${attrs} aria-label="${esc(p.name)} ${label.toLowerCase()}">
          </td>`).join("")}
      </tr>`;

    const selectRow = (label, field, options, format) => `
      <tr>
        <th class="row-label" scope="row">${label}</th>
        ${state.plans.map((p) => `
          <td${selectedClass(p)} data-id="${esc(p.id)}">
            <select data-field="${field}" data-id="${esc(p.id)}" aria-label="${esc(p.name)} ${label.toLowerCase()}">
              ${options.map((value) => `<option value="${value}"${Number(p[field]) === value ? " selected" : ""}>${format(value)}</option>`).join("")}
            </select>
          </td>`).join("")}
      </tr>`;

    const riskRow = `
      <tr>
        <th class="row-label" scope="row">Risk per trade</th>
        ${state.plans.map((p) => {
          const value = riskPercent(p.risk);
          return `
            <td${selectedClass(p)} data-id="${esc(p.id)}">
              <div class="field-pct">
                <input type="number" inputmode="decimal" data-field="risk" data-id="${esc(p.id)}"
                  data-prev="${Number.isFinite(value) ? value : ""}" value="${Number.isFinite(value) ? value : ""}"
                  list="riskDefaults" min="0.1" max="100" step="0.1"
                  aria-label="${esc(p.name)} risk percent per trade">
                <span aria-hidden="true">%</span>
              </div>
            </td>`;
        }).join("")}
      </tr>`;

    const metricRow = (label, kind, rowClass = "") => `
      <tr class="${rowClass}">
        <th class="row-label" scope="row">${label}</th>
        ${state.plans.map((p) => metricMarkup(p, kind)).join("")}
      </tr>`;

    const actionRow = `
      <tr class="action-row">
        <th class="row-label" scope="row">Roadmap</th>
        ${state.plans.map((p) => `
          <td${selectedClass(p)} data-id="${esc(p.id)}">
            <button class="ghost view-btn" type="button" data-action="view" data-id="${esc(p.id)}">View →</button>
          </td>`).join("")}
      </tr>`;

    return `
      <div class="table-scroll">
        <datalist id="riskDefaults">${RISK_DEFAULTS.map((value) => `<option value="${value}"></option>`).join("")}</datalist>
        <table class="compare-table">
          <thead>
            <tr>
              <th class="corner" scope="col">Plan</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>
            ${inputRow("Starting balance", "start", 'min="0.01" step="any"')}
            ${inputRow("Target balance", "target", 'min="0.01" step="any"')}
            ${riskRow}
            ${selectRow("Reward : risk", "rr", RR_OPTIONS, (v) => `${v}:1`) }
            ${metricRow("Winning trades", "trades", "results-start")}
            ${metricRow("Final balance", "final")}
            ${metricRow("Gain", "gain")}
            ${metricRow("First-trade risk", "risk")}
            ${actionRow}
          </tbody>
        </table>
      </div>`;
  }

  function metricMarkup(p, kind) {
    const c = calculate(p);
    let main = "—";
    let sub = "check inputs";
    let good = false;

    if (kind === "trades") {
      if (c.valid) {
        main = c.trades;
        sub = "consecutive wins";
      } else {
        sub = c.reason;
      }
    } else if (kind === "final") {
      if (c.valid) {
        main = money(c.projected);
        sub = "may exceed target";
      } else {
        sub = c.reason;
      }
    } else if (kind === "gain") {
      if (c.valid) {
        main = money(c.gain);
        sub = pct(c.returnPct);
        good = true;
      } else {
        sub = c.reason;
      }
    } else if (kind === "risk") {
      const start = Number(p.start);
      const risk = Number(p.risk);
      const rr = Number(p.rr);
      if (Number.isFinite(start) && start > 0 && Number.isFinite(risk) && Number.isFinite(rr)) {
        main = money(start * risk);
        sub = `reward ${money(start * risk * rr)}`;
      } else {
        sub = "check inputs";
      }
    }

    return `
      <td${selectedClass(p, "metric-cell")} data-metric="${kind}" data-id="${esc(p.id)}">
        <span class="metric-main${good ? " good" : ""}">${main}</span>
        <span class="metric-sub">${sub}</span>
      </td>`;
  }

  function lossCellMarkup(p, losses) {
    const result = lossStress(p, losses);

    if (!result.valid) {
      return `
        <td${selectedClass(p, "loss-cell")} data-loss-id="${esc(p.id)}" data-losses="${losses}">
          <span class="metric-main">—</span>
          <span class="metric-sub">${esc(result.reason)}</span>
        </td>`;
    }

    return `
      <td${selectedClass(p, "loss-cell")} data-loss-id="${esc(p.id)}" data-losses="${losses}">
        <div class="loss-balance">
          <span class="loss-balance-label">Balance remaining</span>
          <strong${result.wipedOut ? ' class="danger-text"' : ""} data-loss-balance>${money(result.remaining)}</strong>
        </div>
        <div class="loss-metrics">
          <div><span>Total loss</span><strong data-loss-total>${money(result.totalLoss)}</strong></div>
          <div><span>Drawdown</span><strong class="danger-text" data-loss-drawdown>${pct(result.drawdown)}</strong></div>
          <div><span>Next trade risk</span><strong data-loss-next>${money(result.nextRisk)}</strong></div>
          <div><span>Recovery needed</span><strong class="warn-text" data-loss-recovery>${result.wipedOut ? "Not recoverable" : pct(result.recovery)}</strong></div>
        </div>
      </td>`;
  }

  function lossTableMarkup() {
    const headCells = state.plans.map((p) => `
      <th class="loss-plan${p.id === state.selectedId ? " is-selected" : ""}" scope="col">
        <span class="loss-plan-name">${esc(p.name)}</span>
        <span class="loss-plan-meta">Loss stress</span>
      </th>`).join("");

    const startRow = `
      <tr>
        <th class="row-label" scope="row">Starting balance</th>
        ${state.plans.map((p) => `
          <td${selectedClass(p, "loss-cell loss-simple")} data-loss-start="${esc(p.id)}">${money(Number(p.start))}</td>`).join("")}
      </tr>`;

    const riskRow = `
      <tr>
        <th class="row-label" scope="row">Risk per trade</th>
        ${state.plans.map((p) => `
          <td${selectedClass(p, "loss-cell loss-simple")} data-loss-risk="${esc(p.id)}">${formatPercent(riskPercent(p.risk))}</td>`).join("")}
      </tr>`;

    const scenarioRows = LOSS_SCENARIOS.map((losses) => `
      <tr>
        <th class="row-label" scope="row">${losses} consecutive losses</th>
        ${state.plans.map((p) => lossCellMarkup(p, losses)).join("")}
      </tr>`).join("");

    return `
      <div class="table-scroll">
        <table class="compare-table loss-table">
          <thead>
            <tr>
              <th class="corner" scope="col">Loss scenario</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>
            ${startRow}
            ${riskRow}
            ${scenarioRows}
          </tbody>
        </table>
      </div>`;
  }

  function renderLossTable() {
    const el = document.getElementById("lossTable");
    if (!el) return;
    el.innerHTML = lossTableMarkup();
    el.classList.remove("loss-refresh");
    void el.offsetWidth;
    el.classList.add("loss-refresh");
    window.setTimeout(() => el.classList.remove("loss-refresh"), 320);
  }

  function pulse(el) {
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ opacity: .4 }, { opacity: 1 }],
      { duration: 260, easing: "ease-out" }
    );
  }

  function updateComparison() {
    const results = state.plans.map((p) => ({ p, c: calculate(p) }));
    const valid = results.filter((r) => r.c.valid);
    let minTrades = null;

    if (state.plans.length > 1 && valid.length) {
      minTrades = Math.min(...valid.map((r) => r.c.trades));
    }

    const bestIds = new Set(
      minTrades === null ? [] : valid.filter((r) => r.c.trades === minTrades).map((r) => r.p.id)
    );

    plansEl.querySelectorAll("[data-head-id]").forEach((head) => {
      head.classList.toggle("is-best", bestIds.has(head.dataset.headId));
      head.classList.toggle("is-selected", head.dataset.headId === state.selectedId);
    });

    plansEl.querySelectorAll("[data-role='riskTag']").forEach((tag) => {
      const p = getPlan(tag.dataset.id);
      if (p) tag.textContent = riskLabel(p.risk);
    });

    plansEl.querySelectorAll("[data-metric]").forEach((cell) => {
      const p = getPlan(cell.dataset.id);
      if (!p) return;

      const c = calculate(p);
      const kind = cell.dataset.metric;
      const mainEl = cell.querySelector(".metric-main");
      const subEl = cell.querySelector(".metric-sub");
      let main = "—";
      let sub = "check inputs";
      let good = false;

      if (kind === "trades") {
        if (c.valid) {
          main = c.trades;
          sub = "consecutive wins";
        } else {
          sub = c.reason;
        }
      } else if (kind === "final") {
        if (c.valid) {
          main = money(c.projected);
          sub = "may exceed target";
        } else {
          sub = c.reason;
        }
      } else if (kind === "gain") {
        if (c.valid) {
          main = money(c.gain);
          sub = pct(c.returnPct);
          good = true;
        } else {
          sub = c.reason;
        }
      } else if (kind === "risk") {
        const start = Number(p.start);
        const risk = Number(p.risk);
        const rr = Number(p.rr);
        if (Number.isFinite(start) && start > 0 && Number.isFinite(risk) && Number.isFinite(rr)) {
          main = money(start * risk);
          sub = `reward ${money(start * risk * rr)}`;
        }
      }

      const nextMain = String(main);
      if (mainEl.textContent !== nextMain) {
        mainEl.textContent = nextMain;
        pulse(mainEl);
      }
      subEl.textContent = sub;
      mainEl.classList.toggle("good", good);
      cell.classList.toggle("is-selected", p.id === state.selectedId);
      cell.classList.toggle("is-best", kind === "trades" && bestIds.has(p.id));
    });

    plansEl.querySelectorAll("td[data-id]").forEach((td) => {
      td.classList.toggle("is-selected", td.dataset.id === state.selectedId);
    });

    renderLossTable();
  }

  function updateRoadmapCaption() {
    const p = getPlan(state.selectedId);
    if (!p) return;
    const customRows = Object.keys(planOverrides(p)).length;
    const customNote = customRows
      ? ` · ${customRows} custom row${customRows === 1 ? "" : "s"}`
      : "";
    document.getElementById("roadmapCaption").textContent =
      `Winning-only: ${p.name.trim() || "Untitled plan"}: ${money(Number(p.start))} → ${money(Number(p.target))} · ${riskLabel(p.risk)} · ${formatRR(p.rr)}${customNote}`;
  }

  function readPageSize() {
    try {
      const raw = localStorage.getItem(PAGE_SIZE_KEY);
      if (raw === null || raw === "") return DEFAULT_PAGE_SIZE;

      const value = Number(raw);
      if (Number.isFinite(value)) return Math.min(500, Math.max(1, Math.round(value)));
    } catch (e) {
      /* ignore unavailable storage */
    }
    return DEFAULT_PAGE_SIZE;
  }

  function pageWindow(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 3) {
      pages.add(2);
      pages.add(3);
      pages.add(4);
    }
    if (current >= total - 2) {
      pages.add(total - 1);
      pages.add(total - 2);
      pages.add(total - 3);
    }

    const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const result = [];
    let previous = 0;

    sorted.forEach((page) => {
      if (page - previous > 1) result.push("…");
      result.push(page);
      previous = page;
    });

    return result;
  }

  function renderPager(totalRows) {
    const pager = document.getElementById("roadmapPager");
    const totalPages = Math.ceil(totalRows / pageSize);

    if (totalRows <= pageSize) {
      pager.hidden = true;
      pager.innerHTML = "";
      return;
    }

    pager.hidden = false;
    const start = (roadmapPage - 1) * pageSize + 1;
    const end = Math.min(totalRows, roadmapPage * pageSize);
    const buttons = pageWindow(roadmapPage, totalPages).map((item) => {
      if (item === "…") return `<span class="pager-ellipsis" aria-hidden="true">…</span>`;
      return `<button type="button" class="pager-page${item === roadmapPage ? " is-active" : ""}" data-page="${item}"${item === roadmapPage ? ' aria-current="page"' : ""}>${item}</button>`;
    }).join("");

    pager.innerHTML = `
      <div class="pager-info">Rows ${start}–${end} of ${totalRows.toLocaleString()}</div>
      <div class="pager-controls">
        <button type="button" class="pager-step" data-page="${roadmapPage - 1}"${roadmapPage === 1 ? " disabled" : ""} aria-label="Previous page">← Prev</button>
        ${buttons}
        <button type="button" class="pager-step" data-page="${roadmapPage + 1}"${roadmapPage === totalPages ? " disabled" : ""} aria-label="Next page">Next →</button>
      </div>`;
  }

  function renderRoadmap() {
    let p = getPlan(state.selectedId);
    if (!p) {
      p = state.plans[0];
      if (!p) return;
      state.selectedId = p.id;
    }

    if (roadmapPlanId !== p.id) {
      roadmapPlanId = p.id;
      roadmapPage = 1;
    }

    roadSelect.value = p.id;
    updateRoadmapCaption();

    const c = calculate(p);
    const body = document.getElementById("roadmapBody");
    const note = document.getElementById("roadmapNote");
    const pager = document.getElementById("roadmapPager");

    if (!c.valid) {
      body.innerHTML = `<tr><td colspan="8" class="empty-row">${esc(c.reason)}</td></tr>`;
      pager.hidden = true;
      pager.innerHTML = "";
      note.hidden = true;
      note.textContent = "";
      return;
    }

    const sim = simulateRows(p, MAX_STEPS);
    const rows = sim.rows;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    roadmapPage = Math.min(Math.max(1, roadmapPage), totalPages);

    const pageStart = (roadmapPage - 1) * pageSize;
    const pageRows = rows.slice(pageStart, pageStart + pageSize);
    const defaultPercent = formatPercent(riskPercent(p.risk));

    body.innerHTML = pageRows.map((row) => {
      const title = row.custom
        ? `Custom risk. Clear to use the plan default (${defaultPercent}).`
        : `Using plan default (${defaultPercent}). Type to override.`;

      return `
        <tr class="${row.reached ? "target" : ""}${row.custom ? " custom-risk" : ""}">
          <td>${row.n}</td>
          <td>${money(row.balance)}</td>
          <td class="risk-cell">
            <div class="field-pct road-risk${row.custom ? " is-custom" : ""}">
              <input type="number" inputmode="decimal" data-road-risk="${row.n}" value="${riskPercent(row.risk)}"
                min="0.1" max="100" step="0.1" title="${esc(title)}"
                aria-label="Risk percent for win ${row.n}">
              <span aria-hidden="true">%</span>
            </div>
          </td>
          <td>${money(row.cashRisk)}</td>
          <td>${p.rr}R</td>
          <td>${money(row.profit)}</td>
          <td><strong>${money(row.end)}</strong></td>
          <td>${row.reached ? "TARGET REACHED" : "Continue"}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="8" class="empty-row">No steps to show.</td></tr>`;

    renderPager(rows.length);

    if (!sim.reached && rows.length >= MAX_STEPS) {
      note.hidden = false;
      note.textContent = `This plan needs ${c.trades.toLocaleString()} wins. Showing the first ${MAX_STEPS.toLocaleString()} across pages.`;
    } else {
      note.hidden = true;
      note.textContent = "";
    }
  }

  function renderHistory() {
    const el = document.getElementById("historyList");

    if (!history.length) {
      el.innerHTML = `<div class="empty">No saved snapshots yet. Click “Save snapshot” to preserve the current plans.</div>`;
      return;
    }

    el.innerHTML = history.map((snapshot, i) => {
      const date = new Date(snapshot.savedAt);
      const label = Number.isNaN(date.getTime()) ? "Saved snapshot" : date.toLocaleString();
      const desc = (snapshot.plans || []).map((p) =>
        `${p.name}: ${money(Number(p.start))} → ${money(Number(p.target))}`
      ).join(" · ");

      return `
        <div class="history-item">
          <div>
            <strong>${esc(label)}</strong>
            <small>${esc(desc || "No plans in this snapshot.")}</small>
          </div>
          <div class="actions">
            <button type="button" data-history-load="${i}">Restore</button>
            <button type="button" class="danger" data-history-delete="${i}" aria-label="Delete snapshot">Delete</button>
          </div>
        </div>`;
    }).join("");
  }

  function lossSummaryMarkup() {
    const headCells = state.plans.map((p) => `<th>${esc(p.name)}</th>`).join("");
    const rows = LOSS_SCENARIOS.map((losses) => `
      <tr>
        <th>${losses} consecutive losses</th>
        ${state.plans.map((p) => {
          const result = lossStress(p, losses);
          if (!result.valid) return `<td>—</td>`;
          return `<td>
            <strong>${money(result.remaining)}</strong><br>
            Loss ${money(result.totalLoss)} · DD ${pct(result.drawdown)}<br>
            Next risk ${money(result.nextRisk)} · Recovery ${result.wipedOut ? "Not recoverable" : pct(result.recovery)}
          </td>`;
        }).join("")}
      </tr>`).join("");

    return `
      <h2>Loss stress test</h2>
      <p class="note">Hypothetical compounding losses. This does not estimate the probability of a losing streak.</p>
      <table class="summary">
        <thead><tr><th>Scenario</th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function buildExportMarkup() {
    const computed = state.plans.map((p) => ({ p, c: calculate(p) }));
    const generated = new Date().toLocaleString();
    const summaryRows = [
      ["Starting balance", (p) => money(Number(p.start))],
      ["Target balance", (p) => money(Number(p.target))],
      ["Default risk", (p) => formatPercent(riskPercent(p.risk))],
      ["Reward : risk", (p) => `${p.rr}:1`],
      ["Custom rows", (p) => String(Object.keys(planOverrides(p)).length)],
      ["Winning trades", (p, c) => c.valid ? String(c.trades) : "—"],
      ["Final balance", (p, c) => c.valid ? money(c.projected) : "—"],
      ["Gain", (p, c) => c.valid ? `${money(c.gain)} (${pct(c.returnPct)})` : "—"],
      ["First-trade risk", (p) => money(Number(p.start) * Number(p.risk))]
    ];

    const summaryHead = computed.map(({ p }) => `<th>${esc(p.name)}</th>`).join("");
    const summaryBody = summaryRows.map(([label, value]) => `
      <tr>
        <th>${label}</th>
        ${computed.map(({ p, c }) => `<td>${value(p, c)}</td>`).join("")}
      </tr>`).join("");

    const planSections = computed.map(({ p, c }) => {
      const overrides = planOverrides(p);
      const customCount = Object.keys(overrides).length;
      const customText = customCount
        ? ` · ${customCount} custom row${customCount === 1 ? "" : "s"}`
        : "";
      let body;

      if (!c.valid) {
        body = `<p class="note">${esc(c.reason)}</p>`;
      } else {
        const sim = simulateRows(p, MAX_STEPS);
        const rows = sim.rows.map((row) => `
          <tr class="${row.reached ? "hit" : ""}">
            <td>${row.n}</td>
            <td>${money(row.balance)}</td>
            <td>${formatPercent(riskPercent(row.risk))}${row.custom ? " *" : ""}</td>
            <td>${money(row.cashRisk)}</td>
            <td>${p.rr}R</td>
            <td>${money(row.profit)}</td>
            <td>${money(row.end)}</td>
            <td>${row.reached ? "TARGET REACHED" : "Continue"}</td>
          </tr>`).join("");

        const notes = [];
        if (customCount) notes.push("* Marked rows use a custom risk; all other rows use the plan default.");
        if (!sim.reached && sim.rows.length >= MAX_STEPS) {
          notes.push(`Roadmap limited to ${MAX_STEPS.toLocaleString()} rows; this plan requires ${c.trades.toLocaleString()} wins.`);
        }

        body = `
          <table class="roadmap">
            <thead>
              <tr>
                <th>Win #</th>
                <th>Opening balance</th>
                <th>Risk %</th>
                <th>Cash risk</th>
                <th>Reward (R)</th>
                <th>Profit</th>
                <th>Ending balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${notes.length ? `<p class="note">${notes.map(esc).join("<br>")}</p>` : ""}`;
      }

      return `
        <section class="print-plan">
          <h2>${esc(p.name)}</h2>
          <p class="plan-meta">${money(Number(p.start))} → ${money(Number(p.target))} · ${riskLabel(p.risk)} · ${formatRR(p.rr)}${esc(customText)}</p>
          <div class="metric-grid">
            <div><span>Winning trades</span><strong>${c.valid ? c.trades : "—"}</strong></div>
            <div><span>Final balance</span><strong>${c.valid ? money(c.projected) : "—"}</strong></div>
            <div><span>Gain</span><strong>${c.valid ? `${money(c.gain)} (${pct(c.returnPct)})` : "—"}</strong></div>
            <div><span>First-trade risk</span><strong>${money(Number(p.start) * Number(p.risk))}</strong></div>
          </div>
          ${body}
        </section>`;
    }).join("");

    return `
      <h1>Trading Capital Planner</h1>
      <p class="print-meta">Exported ${esc(generated)} · ${state.plans.length} plan${state.plans.length === 1 ? "" : "s"} · all amounts in USD</p>
      <h2>Plan comparison</h2>
      <table class="summary">
        <thead><tr><th>Metric</th>${summaryHead}</tr></thead>
        <tbody>${summaryBody}</tbody>
      </table>
      ${lossSummaryMarkup()}
      ${planSections}
      <p class="note print-footer"><strong>Risk warning:</strong> Winning-only projections assume every trade reaches the full target. The loss stress test is hypothetical and does not estimate the probability of a losing streak. Both exclude commissions, spread, swaps, slippage, missed setups, and execution errors. This planner does not validate TTFM setups; never force a trade or increase risk to reach a target.</p>`;
  }

  function renderPlans() {
    plansEl.innerHTML = compareMarkup();

    roadSelect.innerHTML = state.plans.map((p) =>
      `<option value="${esc(p.id)}">${esc(p.name || "Untitled plan")}</option>`
    ).join("");

    addBtn.disabled = state.plans.length >= MAX_PLANS;
    addBtn.textContent = addBtn.disabled ? `${MAX_PLANS} plans max` : "+ Add plan";

    const limitNote = document.getElementById("planLimitNote");
    if (limitNote) {
      const overLimit = state.plans.length > MAX_PLANS;
      limitNote.hidden = !overLimit;
      limitNote.textContent = overLimit
        ? `This version supports up to ${MAX_PLANS} active plans. Your extra saved plans are preserved — remove plans before adding new ones.`
        : "";
    }

    updateComparison();
    renderRoadmap();
    renderHistory();
  }

  function syncPlanOption(p) {
    const index = state.plans.indexOf(p);
    if (index >= 0 && roadSelect.options[index]) {
      roadSelect.options[index].textContent = p.name.trim() || "Untitled plan";
    }
    if (p.id === state.selectedId) updateRoadmapCaption();
  }

  function handleInput(event) {
    const field = event.target.dataset.field;
    if (!field) return;

    const p = getPlan(event.target.dataset.id);
    if (!p) return;

    if (field === "name") {
      p.name = event.target.value.slice(0, 30);
      syncPlanOption(p);
      return;
    }

    const value = event.target.value;

    if (field === "risk") {
      p.risk = value === "" ? NaN : Number(value) / 100;
    } else {
      p[field] = value === "" ? NaN : Number(value);
    }

    updateComparison();
    if (p.id === state.selectedId) renderRoadmap();
  }

  function handleChange(event) {
    const field = event.target.dataset.field;
    if (!field) return;

    const p = getPlan(event.target.dataset.id);
    if (!p) return;

    if (field === "name") {
      const previous = event.target.dataset.prev || "Plan";
      p.name = (event.target.value.trim() || previous).slice(0, 30);
      event.target.value = p.name;
      event.target.dataset.prev = p.name;
    } else if (field === "start" || field === "target") {
      const previous = Number(event.target.dataset.prev);
      const fallback = Number.isFinite(previous) && previous > 0
        ? previous
        : (field === "start" ? 100 : 200);
      p[field] = clampNum(event.target.value, fallback, 0.01, 1e12);
      event.target.value = p[field];
      event.target.dataset.prev = p[field];
    } else if (field === "risk") {
      const previous = Number(event.target.dataset.prev);
      const fallback = Number.isFinite(previous) && previous > 0 ? previous : 5;
      const percent = clampNum(event.target.value, fallback, 0.1, 100);
      p.risk = percent / 100;
      event.target.value = percent;
      event.target.dataset.prev = percent;
    } else if (field === "rr") {
      p[field] = Number(event.target.value);
    }

    syncPlanOption(p);
    persist();
    updateComparison();
    renderRoadmap();
  }

  function nextPlanName() {
    const used = new Set(state.plans.map((p) => p.name.trim().toLowerCase()));
    for (let i = 0; i < 26; i++) {
      const name = `Plan ${String.fromCharCode(65 + i)}`;
      if (!used.has(name.toLowerCase())) return name;
    }
    return `Plan ${state.plans.length + 1}`;
  }

  function flashPlan(id) {
    if (!window.requestAnimationFrame || !window.CSS || !CSS.escape) return;

    requestAnimationFrame(() => {
      const safeId = CSS.escape(id);
      plansEl.querySelectorAll(`[data-head-id="${safeId}"], td[data-id="${safeId}"]`).forEach((el) => {
        el.classList.remove("just-added");
        void el.offsetWidth;
        el.classList.add("just-added");
        window.setTimeout(() => el.classList.remove("just-added"), 950);
      });
    });
  }

  function findPlanIndex(id) {
    return state.plans.findIndex((p) => p.id === id);
  }

  function movePlanToIndex(from, to) {
    if (from < 0 || to < 0 || from === to || from >= state.plans.length || to >= state.plans.length) return null;

    const [plan] = state.plans.splice(from, 1);
    state.plans.splice(to, 0, plan);

    persist();
    renderPlans();
    flashPlan(plan.id);

    const handle = plansEl.querySelector(`[data-drag-handle="${CSS.escape(plan.id)}"]`);
    if (handle) handle.focus({ preventScroll: true });

    showToast("Plan order updated.");
    return plan;
  }

  function findDropPlanId(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;

    const cell = el.closest("td[data-id], th[data-head-id]");
    if (!cell) return null;

    return cell.dataset.id || cell.dataset.headId || null;
  }

  function setDragOver(targetId) {
    plansEl.querySelectorAll(".is-drag-over").forEach((el) => el.classList.remove("is-drag-over"));
    if (!targetId) return;

    const head = plansEl.querySelector(`[data-head-id="${CSS.escape(targetId)}"]`);
    if (head) head.classList.add("is-drag-over");
  }

  function endPlanDrag(event) {
    if (!dragState) return;
    if (event && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) return;

    const { id, targetId } = dragState;
    dragState = null;
    document.documentElement.classList.remove("is-reordering");
    plansEl.querySelectorAll(".is-dragging, .is-drag-over").forEach((el) => {
      el.classList.remove("is-dragging", "is-drag-over");
    });

    if (targetId && targetId !== id) {
      const from = findPlanIndex(id);
      const to = findPlanIndex(targetId);
      if (from >= 0 && to >= 0) movePlanToIndex(from, to);
    }
  }

  function addPlan() {
    if (state.plans.length >= MAX_PLANS) return;

    const preset = PLAN_PRESETS[state.plans.length % PLAN_PRESETS.length];
    const plan = createPlan(nextPlanName(), preset);
    state.plans.push(plan);
    state.selectedId = plan.id;

    persist();
    renderPlans();
    flashPlan(plan.id);
    showToast("New plan added.");
  }

  function saveSnapshot() {
    const snapshot = {
      savedAt: new Date().toISOString(),
      plans: state.plans.map((p) => ({ ...p })),
      selectedId: state.selectedId
    };

    history.unshift(snapshot);
    history = history.slice(0, 100);
    persist();
    renderHistory();
    showToast("Snapshot saved in this browser.");
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* ignore unavailable storage */
    }

    const next = theme === "dark" ? "light" : "dark";
    const label = `Switch to ${next} theme`;
    themeBtn.setAttribute("aria-label", label);
    themeBtn.title = label;
  }

  plansEl.addEventListener("input", handleInput);
  plansEl.addEventListener("change", handleChange);

  plansEl.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-drag-handle]");
    if (!handle || state.plans.length < 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const id = handle.dataset.dragHandle;
    if (!getPlan(id)) return;

    event.preventDefault();
    dragState = { id, pointerId: event.pointerId, targetId: null };

    try {
      handle.setPointerCapture(event.pointerId);
    } catch (e) {
      /* ignore pointer capture failures */
    }

    const head = plansEl.querySelector(`[data-head-id="${CSS.escape(id)}"]`);
    if (head) head.classList.add("is-dragging");
    document.documentElement.classList.add("is-reordering");
  });

  document.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();
    const targetId = findDropPlanId(event.clientX, event.clientY);
    dragState.targetId = targetId && targetId !== dragState.id ? targetId : null;
    setDragOver(dragState.targetId);
  }, { passive: false });

  document.addEventListener("pointerup", endPlanDrag);
  document.addEventListener("pointercancel", endPlanDrag);

  plansEl.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-drag-handle]");
    if (!handle || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;

    event.preventDefault();
    const from = findPlanIndex(handle.dataset.dragHandle);
    const to = from + (event.key === "ArrowLeft" ? -1 : 1);
    if (from >= 0 && to >= 0 && to < state.plans.length) movePlanToIndex(from, to);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dragState) endPlanDrag();
  });

  plansEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;

    const p = getPlan(btn.dataset.id);
    if (!p) return;

    if (btn.dataset.action === "view") {
      state.selectedId = p.id;
      persist();
      updateComparison();
      renderRoadmap();
      roadmapEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (btn.dataset.action === "remove") {
      if (state.plans.length <= 1) return;

      state.plans = state.plans.filter((plan) => plan.id !== p.id);
      if (state.selectedId === p.id) state.selectedId = state.plans[0].id;

      persist();
      renderPlans();
      showToast("Plan removed.");
    }
  });

  addBtn.addEventListener("click", addPlan);

  roadSelect.addEventListener("change", () => {
    if (!getPlan(roadSelect.value)) return;
    state.selectedId = roadSelect.value;
    persist();
    updateComparison();
    renderRoadmap();
  });

  document.getElementById("roadmapBody").addEventListener("change", (event) => {
    const input = event.target.closest("[data-road-risk]");
    if (!input) return;

    const p = getPlan(state.selectedId);
    if (!p) return;

    const row = Number(input.dataset.roadRisk);
    const defaultRisk = Number(p.risk);
    const overrides = planOverrides(p);
    const raw = input.value.trim();

    if (raw === "") {
      delete overrides[row];
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        delete overrides[row];
      } else {
        const percent = Math.min(100, Math.max(0.1, value));
        const risk = percent / 100;
        if (Math.abs(risk - defaultRisk) < 1e-9) delete overrides[row];
        else overrides[row] = risk;
      }
    }

    p.riskOverrides = overrides;
    persist();
    updateComparison();
    renderRoadmap();
  });

  document.getElementById("roadmapBody").addEventListener("keydown", (event) => {
    if (event.target.matches("[data-road-risk]") && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
  });

  const pageSizeInput = document.getElementById("pageSizeInput");

  pageSizeInput.addEventListener("change", () => {
    const value = Number(pageSizeInput.value);

    if (!Number.isFinite(value)) {
      pageSizeInput.value = pageSize;
      return;
    }

    pageSize = Math.min(500, Math.max(1, Math.round(value)));
    pageSizeInput.value = pageSize;
    roadmapPage = 1;

    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch (e) {
      /* ignore unavailable storage */
    }

    renderRoadmap();
  });

  pageSizeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pageSizeInput.blur();
    }
  });

  document.getElementById("roadmapPager").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;

    const page = Number(button.dataset.page);
    if (!Number.isFinite(page) || page < 1) return;

    roadmapPage = page;
    renderRoadmap();
  });

  document.getElementById("saveBtn").addEventListener("click", saveSnapshot);

  document.getElementById("exportPdfBtn").addEventListener("click", () => {
    const root = document.getElementById("printRoot");
    root.innerHTML = buildExportMarkup();

    const clear = () => {
      root.innerHTML = "";
      window.removeEventListener("afterprint", clear);
    };

    window.addEventListener("afterprint", clear);

    window.setTimeout(() => {
      window.focus();
      window.print();
    }, 100);
  });

  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      currentState: state,
      history
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "trading-capital-planner-history.json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("JSON backup downloaded.");
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset all plans and saved history to the default setup? This cannot be undone unless you saved a Backup JSON.")) return;

    state = { plans: defaultPlans(), selectedId: null };
    history = [];
    normalize();
    persist();
    renderPlans();
    showToast("Planner rebuilt with default plans.");
  });

  document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    if (!history.length) return;
    if (!confirm("Delete all saved snapshots? Current plans will remain.")) return;

    history = [];
    persist();
    renderHistory();
    showToast("History cleared.");
  });

  document.getElementById("historyList").addEventListener("click", (event) => {
    const load = event.target.closest("[data-history-load]");
    const del = event.target.closest("[data-history-delete]");

    if (load) {
      const snapshot = history[Number(load.dataset.historyLoad)];
      if (!snapshot) return;

      state = {
        plans: (snapshot.plans || []).map((p) => ({ ...p })),
        selectedId: snapshot.selectedId
      };
      normalize();
      persist();
      renderPlans();
      showToast("Snapshot restored.");
    }

    if (del) {
      const index = Number(del.dataset.historyDelete);
      history.splice(index, 1);
      persist();
      renderHistory();
      showToast("Snapshot deleted.");
    }
  });

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

    document.documentElement.classList.add("theme-transition");
    themeBtn.classList.remove("spin");
    void themeBtn.offsetWidth;
    themeBtn.classList.add("spin");

    applyTheme(current === "dark" ? "light" : "dark");

    window.setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
      themeBtn.classList.remove("spin");
    }, 420);
  });

  const savedState = safeRead(STORE_KEY, null);
  state = savedState && Array.isArray(savedState.plans) && savedState.plans.length
    ? savedState
    : { plans: defaultPlans(), selectedId: null };
  history = safeRead(HISTORY_KEY, []);

  normalize();
  pageSize = readPageSize();
  document.getElementById("pageSizeInput").value = pageSize;
  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  persist();
  renderPlans();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPlanner, { once: true });
} else {
  initPlanner();
}
