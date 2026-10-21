# Trade Planner

A browser-based trading capital planner for comparing multiple plans side by side. It combines a **theoretical winning-only projection** with a **hypothetical consecutive-loss stress test**.

No build step or server is required. Open `index.html` in a modern browser.

## Features

- Compare up to **four plans** side by side.
- Edit starting balance, target balance, risk percentage, and reward-to-risk ratio.
- View a winning-only projection:
  - Minimum consecutive winning trades required.
  - Projected balance after the final winning trade.
  - Projected gain and return percentage.
  - First-trade cash risk and first full-win reward.
- Run a **loss stress test** for 3, 5, and 10 consecutive losses:
  - Balance remaining.
  - Total dollar loss.
  - Percentage drawdown.
  - Cash risk on the next trade.
  - Percentage gain required to recover the original balance.
- Override the risk percentage for individual roadmap rows.
- Drag plan columns to reorder them. The loss stress test, roadmap selector, and saved order follow the new order.
- Keyboard reordering: focus a drag handle and use `←` / `→`.
- Roadmap pagination with a configurable number of rows per page.
- Dark and light themes with a green primary accent. The planner follows your system theme until you choose one manually; a manual choice is saved.
- Responsive, full-width layout.
- Save snapshots in browser `localStorage`, then restore or delete them.
- Export a PDF containing all plans, the loss stress test, and each plan's roadmap.
- Download a JSON backup of current plans and saved history.

## How To Use

1. Open `index.html`.
2. Edit the values in the plan comparison table.
3. Use **+ Add plan** to compare more scenarios.
4. Drag a plan's grip handle to reorder plans.
5. Check the **Loss stress test** section for 3, 5, and 10-loss scenarios.
6. Use **View →** on a plan to inspect its winning-only roadmap.
7. Use **Save snapshot** to keep a saved state in this browser.
8. Use **Export PDF** to print or save the full planner as a PDF.
9. Use **Backup JSON** to keep a restorable data backup.

## Calculations

### Winning-only projection

```
factor = 1 + risk% × reward-to-risk
winning trades = ceil(ln(target / starting balance) / ln(factor))
```

The projection assumes every trade wins and reaches the full selected R-multiple. Per-row risk overrides are applied when calculating the roadmap.

### Loss stress test

```
balance after N losses = starting balance × (1 − risk%)^N
total loss = starting balance − balance after N losses
drawdown = 1 − (balance after N losses / starting balance)
next-trade cash risk = balance after N losses × risk%
recovery required = (starting balance / balance after N losses) − 1
```

Losses compound against the **current balance**, not the original balance. The loss test uses the plan-level risk percentage.

## Risk Disclaimer

- The winning-only projection assumes every trade wins and reaches the full target. It is a theoretical scenario, not an expected result or a forecast.
- The loss stress test is hypothetical. It does not estimate the probability of a losing streak.
- Both scenarios exclude commissions, spread, swaps, slippage, missed setups, and execution errors.
- This planner is for planning only. It does not validate TTFM setups.
- Never force a trade or increase risk just to reach a target.
- Nothing here is financial advice.

## Data And Privacy

Plans, snapshots, manual theme choice, and page size are stored locally in the browser using `localStorage`. Nothing is uploaded to a server. Clearing browser/site data, using private browsing, or switching devices may erase the data. Use **Backup JSON** for a restorable backup.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and layout |
| `styles.css` | Theme, layout, responsive, print, and animation styles |
| `app.js` | Planner logic, calculations, storage, drag reordering, exports, and animations |
