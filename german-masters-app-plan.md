# German Masters Application Hub — Full Project Plan for Claude Code
## Refined for Maximum Automation & ROI

## Context

I'm a Moroccan CS student (Licence / Bac+3 / 180 ECTS) applying to ~80+ master's programs in Germany for Winter Semester 2026/27. I need a CLI tool built with Claude Code that automates the painful parts of applying to this many programs.

My profile:
- B.Sc. Computer Science from a Moroccan university
- GPA: "Bien" (14-16/20), converts to ~2.0-2.5 German scale
- 180 ECTS (3-year Licence) — this is a known weakness, many programs want 210-240
- IELTS 7.0+
- German: partial B1 (passed listening & reading of Goethe B1)
- Strong GitHub portfolio, no work experience
- Currently in S6 (final semester), graduating mid-June 2026
- Finances secured (€11,208+ blocked account)
- Some programs require Uni-Assist VPD (marked as yellow in my spreadsheet)

---

## What to Build

A **local Node.js CLI application** (not a web app) with the following modules. Each module is a separate command. Build in order — each module depends on the previous.

---

## Module 0: Setup Wizard (`setup`)

### Purpose
Interactive first-run experience. Guides the user through creating `data/profile.json` and `.env` with their real info. Run automatically if profile doesn't exist when any command requires it.

### `setup init`
Step-by-step interactive prompts using `inquirer` (or readline):
1. Ask for name, degree, university, graduation date, GPA
2. Ask for IELTS score, German level
3. Ask for GitHub URL
4. Ask to add projects (loop: add more? yes/no)
5. Ask for career goals, why Germany, personal story
6. Ask for Anthropic API key — write to `.env`
7. Confirm and save `data/profile.json`

### `setup check`
Validate the environment:
```
✅ data/programs.json found (82 programs)
✅ data/profile.json found and complete
✅ ANTHROPIC_API_KEY set
✅ output/letters/ directory exists
⚠️  pandoc not found — PDF export will be unavailable
✅ All npm dependencies installed
```

---

## Module 1: Program Data Importer (`import`)

### Purpose
Parse the Excel spreadsheet and create a local JSON database of all programs.

### Input
- File: `german-master-programms.xlsx`
- Sheet 1 contains all program data
- Columns: Status, Name, University, Website, Deadline Winter, Deadline Summer, Duration, Semesters, City, Degree, Language, Tuition, Ranking1, Ranking2, Type of Assessment, Access Link, Description
- **Yellow-highlighted rows** = Uni-Assist programs. Detect via `cell.fill.fgColor.argb` containing `'FFFF'` in the first 6 characters.

### Output
- `data/programs.json` — array of program objects:
```json
{
  "id": 1,
  "name": "Data Science",
  "university": "Freie Universität Berlin",
  "website": "https://...",
  "deadlineWinter": "31 May",
  "deadlineWinterParsed": "2026-05-31",
  "deadlineSummer": "",
  "duration": "2",
  "semesters": "4",
  "city": "Berlin",
  "degree": "M.Sc.",
  "language": "English",
  "tuition": "Free",
  "ranking1": "University of Excellence",
  "ranking2": "Top 150 worldwide",
  "assessment": "",
  "accessLink": "https://...",
  "description": "...",
  "uniAssist": true,
  "status": "Not Yet",
  "notes": "",
  "appliedDate": null,
  "documentsSubmitted": [],
  "motivationLetterGenerated": false,
  "motivationLetterPath": null,
  "motivationLetterWordCount": null,
  "priorityScore": null,
  "eligibilityFlags": [],
  "letterVersions": []
}
```

### Implementation
- Use `exceljs` npm package
- Read cell fills to detect yellow highlighting
- **Parse `deadlineWinterParsed` immediately during import** — store as ISO `YYYY-MM-DD` string using the deadline parser (see note #4 below). Treat ambiguous deadlines as the latest possible date in the range.
- Handle datetime values in deadline cells (some are stored as Excel dates)
- Clean up unicode artifacts in program names (Cyrillic lookalike characters)
- Status values: "Not Yet", "Filling", "Pending", "Missed", "Accepted", "Rejected"
- After import, **auto-run the eligibility screener** (Module 6) and store flags

---

## Module 2: Application Tracker (`status`)

### `status list [--filter=<status>] [--uniassist] [--search=<query>] [--sort=deadline|priority|name]`
Display all programs in a table with:
- Priority score (★★★ / ★★☆ / ★☆☆)
- Status (color-coded: green=accepted, yellow=filling, red=missed, cyan=pending)
- Program name
- University
- City
- Deadline (red if < 14 days, yellow if < 30 days)
- Uni-Assist badge
- Eligibility warnings (⚠️ ECTS gap, ⚠️ German required)
- Any notes

Default sort: by deadline ascending (most urgent first).

### `status update <program-id> <new-status> [--note="..."]`
Update the status of a program. Valid statuses: `not-yet`, `filling`, `pending`, `accepted`, `rejected`, `missed`.
Append an optional timestamped note to the program's notes field.

### `status summary`
Show a full dashboard:
```
╔══════════════════════════════════════════════════╗
║      German Masters Application Tracker          ║
╠══════════════════════════════════════════════════╣
║  Total programs:        82                       ║
║  Not yet started:       65                       ║
║  Currently filling:      5                       ║
║  Pending decision:       2                       ║
║  Accepted:               0                       ║
║  Missed:                 4                       ║
║  Rejected:               0                       ║
║  ──────────────────────────────────────────────  ║
║  Uni-Assist programs:   17  (need VPD)           ║
║  Letters generated:      3 / 82                  ║
║  Docs ready:             8 / 14                  ║
║  ──────────────────────────────────────────────  ║
║  HIGH priority:         12  programs             ║
║  MEDIUM priority:       35  programs             ║
║  LOW / likely ineligible: 35  programs           ║
╚══════════════════════════════════════════════════╝

⚠️  5 deadlines within 14 days — run: status deadlines
```

### `status deadlines [--weeks=<n>]`
Show upcoming deadlines within the next N weeks (default 4), sorted chronologically.
- Red for < 14 days
- Yellow for < 30 days
- Show letter status alongside each entry (generated / missing)
- Show Uni-Assist flag (these need extra lead time)

### `status export [--format=csv|md]`
Export the full tracker as a CSV or Markdown table. Useful for sharing or printing.

---

## Module 3: Motivation Letter Generator (`letter`)

### This is the most important module.

### `letter generate <program-id> [--style=<formal|personal|academic>] [--output=<path>] [--dry-run] [--force]`

**How It Works:**
1. Load program from `data/programs.json`
2. Load profile from `data/profile.json` (prompt setup if missing)
3. Check if a letter already exists for this program — if yes, ask to overwrite (skip prompt with `--force`)
4. Construct the detailed prompt and call the **Anthropic API** (claude-sonnet-4-20250514)
5. Post-process: count words, warn if outside 400–600 range
6. Save to `output/letters/{university-slug}_{program-slug}_motivation.md` with YAML frontmatter
7. Store a version entry in `letterVersions[]` in the program record (timestamp + path + word count)
8. Mark `motivationLetterGenerated: true`, update `motivationLetterPath` and `motivationLetterWordCount`
9. Optionally convert to PDF if `pandoc` is installed

**YAML frontmatter in saved letter:**
```yaml
---
program: Data Science
university: Freie Universität Berlin
city: Berlin
generatedAt: 2026-04-11T14:22:00Z
style: formal
wordCount: 512
model: claude-sonnet-4-20250514
version: 1
---
```

**`--dry-run` flag:** Print the full prompt to terminal without calling the API. Useful for reviewing and tweaking the prompt template.

### Profile File (`data/profile.json`)
```json
{
  "name": "Your Full Name",
  "degree": "B.Sc. Computer Science",
  "university": "University Name, Morocco",
  "graduationDate": "June 2026",
  "gpa": "14.5/20 (Bien)",
  "germanGPA": "2.2",
  "ects": "180",
  "english": "IELTS 7.5 (C1)",
  "german": "B1 partial (Goethe listening & reading)",
  "githubUrl": "https://github.com/username",
  "projects": [
    {
      "name": "Project Name",
      "description": "What it does and what tech you used",
      "relevance": "How it relates to your CS skills"
    }
  ],
  "skills": ["Python", "Machine Learning", "Web Development", "Data Analysis"],
  "whyGermany": "Your personal reasons for choosing Germany",
  "careerGoals": "What you want to do after the master's",
  "personalTouch": "Any unique aspect of your background/story"
}
```

### Prompt Engineering (Critical)

**System prompt:**
> You are a graduate admissions consultant helping a Moroccan CS student write motivation letters for German master's programs. Write authentic, specific letters that sound human — not AI-generated. Avoid clichés. Be direct. Each letter must be tailored to the specific program and university. Never reuse phrasing from one letter to another.

**User prompt structure:**
```
Write a motivation letter for the following master's program application.

## Applicant Profile
[insert full profile as JSON]

## Target Program
- Program: {name}
- University: {university}
- Degree: {degree}
- City: {city}
- Duration: {duration} years
- Program description: {description}
- Assessment type: {assessment}
- Special notes: {notes}
- University ranking: {ranking1}, {ranking2}
- Language: {language}
- Priority score: {priorityScore} (context for your tone)

## Requirements
- Length: 450–550 words (1 page)
- Structure:
  1. Opening paragraph: Why THIS specific program at THIS university (reference something unique — curriculum, research group, city, ranking). Do NOT start with "I am writing to apply..."
  2. Academic background: How your CS degree in Morocco prepared you. Mention specific relevant coursework.
  3. Technical projects: Reference 1–2 GitHub projects naturally — what you built, what you learned, how it connects to the program.
  4. Why Germany: Brief, genuine reason. Not generic.
  5. Career vision: Concrete post-graduation goals and how this program enables them.
- Tone: {style} — formal/personal/academic
- Address the 180 ECTS gap proactively if the program typically requires more (frame positively)
- BANNED phrases: "I am passionate about", "ever since I was young", "in today's rapidly evolving world", "I am confident that", "it would be an honor", "I have always been fascinated"
- Sign off with the applicant's name
```

### `letter batch [--status=not-yet] [--limit=5] [--deadline-within=30] [--priority=high]`
Generate letters for multiple programs at once.
- Default order: by deadline ascending (most urgent first)
- `--priority=high` filters to high-priority programs only
- `--deadline-within=30` limits to programs with deadlines in the next N days
- 2-second delay between API calls
- Show `ora` progress bar: `Generating [3/5] TU Berlin — Information Systems...`
- On failure: log error to `output/errors.log`, continue with next

### `letter list [--missing] [--generated]`
Table view: program name, university, deadline, letter status, word count, version count.
`--missing` shows only programs without a letter. `--generated` shows only those with one.

### `letter preview <program-id>`
Display the letter in the terminal with formatting. Show frontmatter metadata in a small header box.

### `letter refine <program-id> --feedback="<instructions>"`
Takes the existing letter + user feedback, calls Claude to produce an improved version.
- Automatically increments version number
- Saves new version to `letterVersions[]`
- Shows a word-level diff in the terminal (highlight what changed)

### `letter score <program-id>`
Call Claude with the letter + program requirements to evaluate the letter:
```
Letter Quality Report — TU Berlin, Information Systems
─────────────────────────────────────────────────────
Relevance to program:      ★★★★☆  (4/5)
Specificity:               ★★★☆☆  (3/5)
Authenticity (not AI-ish): ★★★★★  (5/5)
ECTS gap addressed:        ✅
Word count:                512  ✅
─────────────────────────────────────────────────────
Suggestions:
  • Paragraph 2 is generic — add a specific module from your transcript
  • The project description in paragraph 3 could tie more directly to NLP
```

### `letter compare <id1> <id2>`
Show two letters side by side (split terminal) to detect reused phrasing or structural repetition. Highlight identical sentences in red.

---

## Module 4: Document Checklist (`docs`)

### `docs list`
```
Academic Documents
  ✅ Bachelor's degree certificate (certified copy)        [d1]
  ⬜ S5 Relevé des notes                                  [d2]
  ⬜ S6 Relevé des notes (after graduation)               [d3]
  ✅ Full transcript of records                            [d4]

Language Certificates
  ✅ IELTS 7.0+ certificate                               [d5]
  ⬜ German B1 certificate (if needed)                    [d6]

Application Materials
  ✅ CV / Resume (Europass)                               [d7]
  ⬜ Motivation letters (3/82 generated)                  [d8]
  ⬜ Recommendation letters (2x)                          [d9]
  ✅ GitHub portfolio document                             [d10]

Uni-Assist
  ⬜ VPD application submitted                            [d11]
  ⬜ Uni-Assist fees paid                                 [d12]

Visa / Financial
  ✅ Blocked account proof (€11,208+)                     [d13]
  ✅ Valid passport copy                                   [d14]

─────────────────────────────────
Progress: 7 / 14 documents ready
```

### `docs check <doc-id>`
Mark a document as complete.

### `docs uncheck <doc-id>`
Mark a document as incomplete.

### `docs per-program <program-id>`
Show a per-program document checklist, factoring in Uni-Assist requirement, language requirements, and any program-specific notes:
```
Required for TU Berlin — Information Systems
  ✅ Transcript                     ready
  ✅ IELTS                          ready
  ⬜ Motivation letter              not generated
  ✅ CV                             ready
  ⬜ VPD (Uni-Assist required)      not submitted
  ────────────────────────────────────────
  Readiness: 3/5 documents ready
```

### `docs export`
Export checklist as a Markdown file for printing: `output/checklist_YYYY-MM-DD.md`

---

## Module 5: Timeline / Action Plan (`plan`)

### `plan today`
**The highest-ROI command.** Shows only what needs to happen today and this week, based on current date:
```
╔══════ TODAY — April 11, 2026 ══════╗

🔴 OVERDUE (act immediately):
   • Göttingen Applied DS — deadline was Apr 1→May 1. Verify if still open.
   • Nordhausen IoT — deadline Apr 30. Letter NOT generated.

🟡 THIS WEEK (Apr 11–17):
   • Kaiserslautern CS — deadline Apr 30. Letter missing. [generate: letter generate 14]
   • TH Köln Automation IT — deadline Apr 30. Letter missing. [generate: letter generate 22]

📋 SUGGESTED ACTIONS:
   1. Run: letter batch --deadline-within=20 --limit=5
   2. Run: docs check d5  (if you have IELTS cert ready)
   3. Submit VPD to Uni-Assist (17 programs need this — 4-6 week processing)

╚══════════════════════════════════════╝
```

### `plan generate [--weeks=<n>]`
Full week-by-week action plan from now to end of application season:
```
📅 WEEK OF APRIL 13-19, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  URGENT: Nordhausen Computer Eng IoT — deadline Apr 30
⚠️  URGENT: Kaiserslautern CS — deadline Apr 30
📝  Generate letters for Apr 30 programs first
📄  Start VPD application (Uni-Assist needs 4-6 weeks)

📅 WEEK OF APRIL 20-26, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝  Ilmenau Research in CSE — deadline May 15
📝  TU Berlin Info Systems — deadline May 15
⚠️  Uni-Assist VPD cutoff: submit by Apr 25 for May 31 deadlines

... etc
```

Deadline parsing handles all inconsistent formats:
- `"31 May"` → `2026-05-31`
- `"15 May/15 Jul"` → take first: `2026-05-15`
- `"1 Apr to 31 May"` → end date: `2026-05-31`
- `"25.05 to 18.09"` → `2026-05-25`
- `"15 Jul, 15 Aug - 31 Aug"` → `2026-07-15`
- Excel datetime objects → parse directly

### `plan uniassist`
Focused action plan specifically for the 17 Uni-Assist programs.
Shows which VPD applications need to be submitted by when (subtract 6-week processing lead time from each deadline).
```
Uni-Assist VPD Timeline
──────────────────────────────────────────────────────
Program                      App Deadline   VPD Submit By   Status
TU Dresden — Dist. Systems   May 31         Apr 19          ⚠️ 8 days left
Heidelberg — Data Analytics  Jun 15         May 4           ✅ 23 days
...
```

---

## Module 6: Smart Prioritization & Eligibility (`rank`)

### `rank score`
**Auto-score every program** (0–100) based on fit and likelihood. Store in `priorityScore` field. Re-run after updating profile.

Scoring factors:
| Factor | Weight | Logic |
|---|---|---|
| Language match (English program) | +20 | User's English is strong |
| ECTS match (≥180 acceptable) | +25 | Penalize if notes say 210+ required |
| GPA match (≤2.5 German scale) | +20 | Penalize if notes say 2.0 cutoff |
| Deadline not missed | +15 | Zero if past deadline |
| Tuition-free | +5 | Prefer public universities |
| Ranking bonus | +10 | Higher-ranked = more prestige |
| Uni-Assist complexity | -5 | Extra work penalty |
| German required | -20 | User only has partial B1 |

Output:
```
Program Rankings (sorted by priority score)
───────────────────────────────────────────────
#1  [92] TU Munich — Informatics              English, Free, ≥180 ECTS ok
#2  [88] KIT — Computer Science               English, Free
#3  [85] RWTH Aachen — Software Systems       English, needs 210 ECTS ⚠️
...
#67 [22] Freiburg — HCI (German required)     German C1 needed ❌
```

### `rank filter --min-score=<n>`
Show only programs scoring above the threshold. Use `--min-score=60` to focus on high-ROI targets.

### `rank flags`
Show eligibility warnings per program:
- `⚠️ ECTS_GAP` — program description mentions 210+ ECTS requirement
- `⚠️ GERMAN_REQUIRED` — program language is German and no English track
- `⚠️ DEADLINE_PASSED` — deadline is before today
- `⚠️ GPA_RISK` — notes mention competitive admission or GPA cutoff
- `✅ STRONG_FIT` — English, ≥180 ECTS ok, tuition-free, good deadline

Auto-set these flags during `import` and store in `eligibilityFlags[]`.

---

## Project Structure

```
german-masters-app/
├── package.json
├── .env                        # ANTHROPIC_API_KEY=sk-...
├── data/
│   ├── programs.json           # Generated by import command
│   ├── profile.json            # User fills via setup wizard
│   ├── checklist.json          # Document completion state
│   └── priorities.json         # Score cache (regenerated by rank score)
├── output/
│   ├── letters/                # Generated motivation letters (.md)
│   ├── exports/                # CSVs, markdown exports
│   └── errors.log              # API errors from batch jobs
├── src/
│   ├── index.js                # CLI entry point (commander.js)
│   ├── commands/
│   │   ├── setup.js
│   │   ├── import.js
│   │   ├── status.js
│   │   ├── letter.js
│   │   ├── docs.js
│   │   ├── plan.js
│   │   └── rank.js
│   ├── lib/
│   │   ├── anthropic.js        # API wrapper with retry logic
│   │   ├── database.js         # JSON read/write helpers
│   │   ├── excel.js            # XLSX parsing + yellow detection
│   │   ├── deadlineParser.js   # Robust deadline string → ISO date
│   │   ├── eligibility.js      # Scoring and flag logic
│   │   ├── formatter.js        # Terminal output (chalk, tables, boxes)
│   │   └── letterDiff.js       # Side-by-side comparison utility
│   └── templates/
│       └── letter-prompt.js    # Prompt template builder
├── german-master-programms.xlsx
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "commander": "^12.0.0",
    "exceljs": "^4.4.0",
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.0",
    "ora": "^8.0.0",
    "dotenv": "^16.0.0",
    "slugify": "^1.6.0",
    "inquirer": "^9.0.0",
    "diff": "^5.2.0"
  }
}
```

---

## CLI Interface

```bash
# First time setup
node src/index.js setup init
node src/index.js setup check

# Import programs and auto-score
node src/index.js import ./german-master-programms.xlsx

# Rank and filter (run once after import)
node src/index.js rank score
node src/index.js rank filter --min-score=70
node src/index.js rank flags

# What to do TODAY
node src/index.js plan today

# Track applications
node src/index.js status list
node src/index.js status list --filter=filling --sort=deadline
node src/index.js status list --uniassist
node src/index.js status update 5 filling --note="Uploaded CV"
node src/index.js status summary
node src/index.js status deadlines --weeks=6
node src/index.js status export --format=csv

# Generate motivation letters
node src/index.js letter generate 12
node src/index.js letter generate 12 --style=academic --dry-run
node src/index.js letter batch --deadline-within=30 --limit=10
node src/index.js letter batch --priority=high --limit=20
node src/index.js letter list --missing
node src/index.js letter preview 12
node src/index.js letter refine 12 --feedback="more specific about AI research"
node src/index.js letter score 12
node src/index.js letter compare 12 15

# Document checklist
node src/index.js docs list
node src/index.js docs check d1
node src/index.js docs per-program 12
node src/index.js docs export

# Action plan
node src/index.js plan today
node src/index.js plan generate --weeks=12
node src/index.js plan uniassist
```

---

## Key Implementation Notes

1. **All state is stored in JSON files** in `data/`. No database needed. Use `fs.readFileSync` / `fs.writeFileSync`. Always pretty-print JSON with 2-space indent.

2. **`import` is idempotent** — if `programs.json` exists, ask for confirmation before overwriting. Preserve manually-set fields (`status`, `notes`, `appliedDate`, `documentsSubmitted`, `motivationLetterGenerated`) during re-import by merging on ID.

3. **`plan today` runs on every startup** — call it automatically when the user runs any command and there are urgent deadlines (< 7 days). Print a brief warning box before the command output.

4. **Yellow cell detection**: In `exceljs`, check `cell.fill?.fgColor?.argb`. Yellow highlight is typically `'FFFFFF00'`. Check if `argb.startsWith('FFFF')` (after the alpha channel).

5. **Deadline parsing** (`src/lib/deadlineParser.js`) must handle all formats:
   - `"31 May"` → `2026-05-31`
   - `"15 May/15 Jul"` → `2026-05-15` (first)
   - `"1 Apr to 31 May"` → `2026-05-31` (end)
   - `"25.05 to 18.09"` → `2026-05-25` (start)
   - `"15 Jul, 15 Aug - 31 Aug"` → `2026-07-15` (earliest)
   - Excel date serial numbers → use exceljs date conversion
   - Return `null` for unparseable strings (don't crash)

6. **Anthropic API** (`src/lib/anthropic.js`):
   - Model: `claude-sonnet-4-20250514`, max_tokens: 1200
   - Read key from `ANTHROPIC_API_KEY` env var (via dotenv)
   - Retry on 529 (overloaded) and 529 with 5s backoff, max 3 retries
   - In `letter batch`: 2-second delay between calls
   - On failure: write to `output/errors.log` and continue

7. **Eligibility scoring** (`src/lib/eligibility.js`):
   - Parse the `description` and `notes` fields with simple keyword matching
   - Keywords like "210 ECTS", "240 ECTS", "Bachelor with 210" → flag `ECTS_GAP`
   - Keywords like "German C1", "Deutschkenntnisse", "nur auf Deutsch" → flag `GERMAN_REQUIRED`
   - Past deadlines → flag `DEADLINE_PASSED`

8. **Letter versioning**: Each time `letter generate` or `letter refine` runs, push to `letterVersions[]`:
   ```json
   { "version": 2, "path": "output/letters/..._v2.md", "generatedAt": "...", "wordCount": 508, "style": "formal" }
   ```

9. **Terminal UX**: Use chalk for colors, ora for spinners, cli-table3 for tables, and draw status summary with box-drawing characters. Every command should give meaningful output — never silent success.

10. **Profile guard**: Before any `letter generate` call, check that `data/profile.json` exists and has non-empty `name`, `projects`, and `careerGoals`. If missing, print: `"Profile incomplete. Run: node src/index.js setup init"`

---

## Build Order

Build and test each module before starting the next:

1. `setup` — file I/O, inquirer prompts, env writing
2. `import` — Excel parsing, yellow detection, deadline parsing, eligibility flags
3. `rank` — scoring algorithm, filter, flags display
4. `status` — list/update/summary/deadlines/export
5. `plan` — today command, full plan, uni-assist timeline
6. `docs` — checklist read/write, per-program view, export
7. `letter` — generate, batch, list, preview, refine, score, compare

---

## Stretch Goals (If Time Permits)

- **PDF export**: `pandoc letter.md -o letter.pdf --pdf-engine=xelatex -V geometry:margin=1in`
- **`letter translate <program-id> --lang=de`**: Generate a German-language version for programs that request it
- **`status web`**: Spin up a local Express server with a simple HTML dashboard (read-only view of `programs.json`) — useful for sharing progress visually
- **`rank auto-skip`**: Auto-set status to `missed` for all programs where `deadlineWinterParsed` < today and status is still `not-yet`
- **Startup reminder hook**: On every `node src/index.js` invocation, check for urgent deadlines and print a 2-line warning if any exist within 7 days

---

## Recommended First Session Flow

```bash
node src/index.js setup init          # fill your profile
node src/index.js import ./german-master-programms.xlsx
node src/index.js rank score          # auto-score all programs
node src/index.js plan today          # see what's urgent RIGHT NOW
node src/index.js letter batch --priority=high --deadline-within=30 --limit=10
node src/index.js status summary      # check your progress
```

Good luck with your applications!
