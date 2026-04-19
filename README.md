# 🎓 German Masters Tracker

A local Node.js CLI + web dashboard to automate tracking and applying to German master's programs for Winter Semester 2026/27.

Built for a single user managing 80+ applications — generates tailored motivation letters, scrapes admission requirements, tracks deadlines, and surfaces daily action plans.

---

## Features

| Module | Command | Description |
|--------|---------|-------------|
| Setup  | `gma setup init` | Configure your student profile & API key |
| Import | `gma import <file.xlsx>` | Import programs from your Excel tracker |
| Rank   | `gma rank score` | Score & prioritize all programs (0–100) |
| Status | `gma status summary` | Overview table with deadlines & flags |
| Plan   | `gma plan today` | Daily action plan — overdue, this week, next week |
| Docs   | `gma docs check` | Document checklist & completion tracker |
| Letter | `gma letter generate <id>` | Generate tailored motivation letter via AI |
| Scrape | `gma scrape <id>` | Scrape admission requirements from program page |
| Dashboard | `gma dashboard` | Open web UI at `http://localhost:3000` |

---

## Web Dashboard

A React single-page app served locally. Four tabs:

- **Overview** — stat cards, urgent deadline banner, upcoming deadline timeline
- **Programs** — filterable/sortable table + Kanban view by status
- **Checklist** — document readiness tracker
- **Today** — prioritized daily action plan

Click any program to open a detail panel with:
- Status & notes editor
- **Admission requirements** — scraped automatically from the program page (HTML or PDF)
- Motivation letter viewer

---

## Tech Stack

- **Runtime**: Node.js 18+ (ESM)
- **CLI**: Commander.js
- **Web**: Express 5 + React 18 (UMD, no build step)
- **AI**: OpenRouter API (Claude via `anthropic/claude-sonnet-4`)
- **Data**: JSON files under `data/` — no database
- **Terminal UI**: chalk · cli-table3 · ora
- **Excel parsing**: ExcelJS

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/YOUR_USERNAME/german-masters-tracker.git
cd german-masters-tracker
npm install
```

### 2. Configure

Copy the example env file and add your [OpenRouter API key](https://openrouter.ai/keys):

```bash
cp .env.example .env
# edit .env and set OPENROUTER_API_KEY=sk-or-...
```

Run the setup wizard to build your profile:

```bash
node src/index.js setup init
```

### 3. Import your programs

Expects an Excel file with columns: name, university, website, deadlineWinter, city, degree, language, tuition, etc.

```bash
node src/index.js import ./your-programs.xlsx
```

### 4. Score & explore

```bash
node src/index.js rank score          # compute priority scores
node src/index.js plan today          # today's action plan
node src/index.js dashboard           # open web UI → http://localhost:3000
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
OPENROUTER_API_KEY=sk-or-...          # required — get from openrouter.ai/keys
OPENROUTER_MODEL=anthropic/claude-sonnet-4   # optional — override model
PORT=3000                             # optional — dashboard port (default 3000)
```

---

## Data Files

All state lives in `data/` (not committed — personal data):

| File | Created by | Contents |
|------|-----------|----------|
| `data/programs.json` | `import` | All program records |
| `data/profile.json` | `setup init` | Your academic profile |
| `data/checklist.json` | bootstrapped | Document checklist state |

A template checklist is committed at `data/checklist.json` — it will be created automatically on first run if missing.

---

## Priority Scoring (0–100)

| Factor | Points |
|--------|--------|
| English-language program | +20 |
| ≥ 180 ECTS acceptable | +25 |
| GPA match | +20 |
| Deadline not missed | +15 |
| Tuition-free | +5 |
| Ranking bonus | +10 |
| Uni-Assist required | −5 |
| German required | −20 |

---

## Admission Requirements Scraper

`gma scrape <id>` (or the dashboard button) fetches the program's page, extracts requirements via AI, and stores them structured by category:

- Language requirements (English / German)
- Academic requirements (ECTS, GPA, degree, field)
- Documents (CV, transcripts, letters)
- Other (fees, portfolio, interview)

Supports HTML pages and PDFs. Follows up to one redirect to a linked requirements page. Updates the deadline if a new one is found and logs the change to the program's notes.

---

## Motivation Letter Generation

```bash
node src/index.js letter generate <id>
node src/index.js letter batch --priority=high --deadline-within=30 --limit=10
```

Each letter is tailored to the specific program and university. Saved to `output/letters/{university}_{program}_v{n}.md` with YAML frontmatter.

---

## License

MIT
