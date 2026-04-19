# GMA Dashboard — Build Report
**Date:** 2026-04-17  
**Status:** ✅ Complete — 13/13 tests passing

---

## What Was Built

A fully functional browser-based dashboard for the German Masters Application Hub, accessible via:

```bash
node src/index.js dashboard
# Opens automatically at http://localhost:3000
# Stop with Ctrl+C

node src/index.js dashboard --port 3001   # custom port
node src/index.js dashboard --no-open     # don't auto-open browser
```

---

## New Files Created

| File | Purpose |
|---|---|
| `src/server.js` | Express app — all REST API endpoints |
| `src/commands/dashboard.js` | commander registration for the `dashboard` command |
| `src/dashboard/index.html` | Full React SPA frontend (no build step, CDN) |

### Modified
| File | Change |
|---|---|
| `src/index.js` | Added `dashboard` to `registerCommands()` |
| `package.json` | Added `express` and `open` dependencies |

---

## REST API — 9 Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/summary` | Stat counts for overview cards |
| GET | `/api/programs` | All programs (filterable, sortable) |
| GET | `/api/programs/deadlines` | Upcoming deadlines strip (next N weeks) |
| GET | `/api/programs/:id` | Single program detail |
| PATCH | `/api/programs/:id` | Update status / notes (re-scores automatically) |
| GET | `/api/programs/:id/letter` | Read generated motivation letter |
| GET | `/api/checklist` | Document checklist with progress count |
| PATCH | `/api/checklist/:itemId` | Toggle a checklist item |
| GET | `/api/plan/today` | Today's urgency-grouped action plan |

---

## Dashboard Features (4 Tabs)

### 📊 Overview
- 10 stat cards: Total, Not Started, In Progress, Pending, Accepted, Due in 14 Days, Letters Done, High Priority, Uni-Assist, Strong Fit
- **Application Pipeline bar** — color-coded proportional bar showing the breakdown across all 6 statuses at a glance
- Progress bars: Application progress, Letters generated, Accepted
- Deadline strip — 44 upcoming deadline pills color-coded by urgency (red < 14d, yellow < 30d, green otherwise), with purple outline for Uni-Assist programs
- Alert banner when deadlines are within 14 days, with a direct link to Today's Plan

### 📋 Programs Table
- All 98 programs in a sortable, filterable table
- Filters: free-text search (name/university/city), status, language, city, eligibility flag, sort order
- Client-side instant filtering — no server round-trip on every keystroke
- Columns: ID, Score bar, Status badge, Program name (with UA tag), University, City, Deadline (colored + days left), Flags, Letter icon
- Click any row to open the Detail Panel

### Detail Panel (right drawer)
- Info grid: Degree, Language, Deadline, Score, Tuition, Status
- Eligibility flags displayed as colored pills
- External links: Website only (accessLink shown only when it's a full URL — all 93 are relative paths, so website is the default)
- Status dropdown — update directly from the panel
- Notes textarea — append or edit notes
- Save Changes button — PATCH to API, re-scores eligibility automatically
- Letter Viewer — fetches and displays the motivation letter inline if one has been generated
- Closes on `Escape` key or clicking the overlay

### ✅ Checklist
- All 14 document items with progress bar and percentage
- Optimistic toggle — updates instantly in the UI, persists to `data/checklist.json`
- Visual strikethrough on completed items
- Celebration message when all 14 are done

### 📌 Today's Plan
- Overdue (17 programs with passed deadlines) — with **"Mark all as Missed"** bulk action button
- Due this week (0 currently)
- Due next week (4 programs)
- Uni-Assist VPD window closing (programs needing VPD submission within 14 days)
- Suggested actions list (auto-generated from data)
- Click any program row to jump to its detail panel

---

## Test Results

```
✅ GET /api/summary               total=98, high=96, urgent14=7
✅ GET /api/programs              98 programs loaded
✅ GET /api/programs/deadlines    44 deadlines in 8 weeks
✅ GET /api/programs/1            Program: Artificial Intelligence...
✅ GET /api/programs/99999        404 correctly returned
✅ GET /api/checklist             4/14 docs done
✅ GET /api/plan/today            overdue=17, thisWeek=0, nextWeek=4
✅ GET /api/profile
✅ PATCH /api/programs/1 (notes)
✅ PATCH /api/programs/1 (status change + auto-revert)
✅ PATCH /api/programs/1 (invalid status → 400 rejected)
✅ PATCH /api/checklist/d1 (toggle + auto-revert)
✅ GET / (index.html served correctly)

─── 13 passed, 0 failed ───
```

---

## Bugs Found & Fixed

| # | Bug | Fix |
|---|---|---|
| 1 | All 93 `accessLink` values are relative paths (e.g. `/master/...`), not full URLs — would have broken as `<a href>` | Frontend now only renders the Apply link when `accessLink.startsWith('http')`, falling back to Website only |
| 2 | Express 5 no longer accepts `'*'` as a catch-all route — threw `PathError: Missing parameter name` | Changed catch-all to `'/{*path}'` (Express 5 syntax) |
| 3 | `server.js` file was truncated at write — missing final two closing brackets `});` and `}` | Detected via `wc -l` + hex dump, appended missing bytes with `printf` |
| 4 | `src/index.js` was truncated mid-line during Edit — command would not start | Detected via `node --check`, repaired with `printf` |
| 5 | 17 overdue programs piling up in Today's Plan with no quick resolution path | Added "Mark all as Missed" bulk action button in the Overdue section |

---

## Improvements Applied (Beyond Minimum)

1. **Pipeline bar** on Overview — proportional color-coded bar showing the split across all 6 statuses, much more informative than numbers alone
2. **Mark all as Missed** — one-click resolution for the 17 overdue programs
3. **Auto-refresh every 30 seconds** — dashboard stays in sync if you run CLI commands in another terminal
4. **Escape key** closes the detail panel
5. **Port-in-use error** handled gracefully with an actionable message instead of a crash
6. **Graceful Ctrl+C shutdown** — `SIGINT`/`SIGTERM` handlers close the server cleanly
7. **Status re-scoring** — when status is updated via the dashboard, eligibility flags and priority score are recomputed and saved automatically

---

## Your Current Data Snapshot

| Metric | Value |
|---|---|
| Total programs | 98 |
| High priority (score ≥ 70) | 96 |
| Strong Fit programs | 79 |
| Deadlines in next 8 weeks | 44 |
| Due within 14 days | 7 |
| Overdue (deadline passed) | 17 |
| Uni-Assist programs | 16 |
| Letters generated | 0 |
| Documents ready | 4 / 14 |

⚠ **Action needed:** 17 programs have passed deadlines and are still marked `not-yet`. Open the Today tab and use "Mark all as Missed" to clean them up, then verify the 7 programs due within 14 days.

---

## How to Run

```bash
# From your project folder:
node src/index.js dashboard

# Custom port:
node src/index.js dashboard --port 3001

# Server-only (no browser auto-open):
node src/index.js dashboard --no-open
```
