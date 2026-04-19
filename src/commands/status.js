import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import {
  loadPrograms, savePrograms, requirePrograms,
  updateProgram, PATHS,
} from '../lib/database.js';
import {
  printBox, printHeader, makeTable,
  colorStatus, colorDeadline, priorityStars,
  TICK, CROSS, WARN,
} from '../lib/formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');

const VALID_STATUSES = ['not-yet', 'filling', 'pending', 'accepted', 'rejected', 'missed'];

// ── status list ───────────────────────────────────────────────────────────

async function runList(opts) {
  const programs = requirePrograms();

  let list = [...programs];

  // Filters
  if (opts.filter) {
    const f = opts.filter.toLowerCase();
    list = list.filter((p) => p.status === f);
  }
  if (opts.uniassist) {
    list = list.filter((p) => p.uniAssist);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.university.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q),
    );
  }
  if (opts.flag) {
    const f = opts.flag.toUpperCase();
    list = list.filter((p) => p.eligibilityFlags?.includes(f));
  }

  // Sort
  const sort = opts.sort ?? 'deadline';
  if (sort === 'deadline') {
    list.sort((a, b) => {
      if (!a.deadlineWinterParsed) return 1;
      if (!b.deadlineWinterParsed) return -1;
      return a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed);
    });
  } else if (sort === 'priority') {
    list.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  } else if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (list.length === 0) {
    console.log(chalk.yellow('  No programs match the current filters.'));
    return;
  }

  console.log();
  const table = makeTable(
    ['ID', '★', 'Status', 'Program', 'University', 'City', 'Deadline', 'Flags'],
    [5, 5, 10, 28, 26, 12, 20, 24],
  );

  list.forEach((p) => {
    const ua = p.uniAssist ? chalk.magenta('[UA] ') : '';
    const letter = p.motivationLetterGenerated ? chalk.green('✉') : chalk.dim('○');
    const flags = (p.eligibilityFlags ?? [])
      .filter((f) => f !== 'STRONG_FIT')
      .map((f) => {
        if (f === 'ECTS_GAP')        return chalk.yellow('ECTS');
        if (f === 'GERMAN_REQUIRED') return chalk.red('DE');
        if (f === 'DEADLINE_PASSED') return chalk.red('EXP');
        if (f === 'GPA_RISK')        return chalk.yellow('GPA');
        return chalk.dim(f);
      })
      .join(' ');

    table.push([
      chalk.dim(String(p.id)),
      priorityStars(p.priorityScore),
      colorStatus(p.status),
      ua + p.name.slice(0, 26),
      p.university.slice(0, 24),
      (p.city || '—').slice(0, 10),
      colorDeadline(p.deadlineWinterParsed),
      letter + ' ' + flags,
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`\n  ${list.length} programs shown`));
  if (opts.uniassist) console.log(chalk.dim('  [UA] = Uni-Assist required'));
  console.log();
}

// ── status update ─────────────────────────────────────────────────────────

async function runUpdate(id, status, opts) {
  if (!VALID_STATUSES.includes(status)) {
    console.error(chalk.red(`Invalid status: "${status}"`));
    console.error(chalk.dim(`Valid values: ${VALID_STATUSES.join(', ')}`));
    process.exit(1);
  }

  const patch = { status };
  if (opts.note) {
    const programs = loadPrograms();
    const p = programs.find((x) => x.id === Number(id));
    const existing = p?.notes ?? '';
    const timestamp = new Date().toISOString().slice(0, 10);
    patch.notes = existing
      ? `${existing}\n[${timestamp}] ${opts.note}`
      : `[${timestamp}] ${opts.note}`;
  }
  if (status === 'accepted' || status === 'filling') {
    patch.appliedDate = new Date().toISOString().slice(0, 10);
  }

  const updated = updateProgram(id, patch);
  if (!updated) {
    console.error(chalk.red(`Program ID ${id} not found.`));
    process.exit(1);
  }

  console.log();
  console.log(`  ${TICK}  [${id}] ${updated.name} — ${updated.university}`);
  console.log(`       Status → ${colorStatus(updated.status)}`);
  if (opts.note) console.log(`       Note:   ${chalk.dim(opts.note)}`);
  console.log();
}

// ── status summary ────────────────────────────────────────────────────────

async function runSummary() {
  const programs = requirePrograms();

  const count = (pred) => programs.filter(pred).length;
  const total      = programs.length;
  const notYet     = count((p) => p.status === 'not-yet');
  const filling    = count((p) => p.status === 'filling');
  const pending    = count((p) => p.status === 'pending');
  const accepted   = count((p) => p.status === 'accepted');
  const missed     = count((p) => p.status === 'missed');
  const rejected   = count((p) => p.status === 'rejected');
  const uniAssist  = count((p) => p.uniAssist);
  const letters    = count((p) => p.motivationLetterGenerated);
  const high       = count((p) => p.priorityScore >= 70);
  const medium     = count((p) => p.priorityScore >= 40 && p.priorityScore < 70);
  const low        = count((p) => p.priorityScore < 40);

  // Upcoming deadlines within 14 days
  const today = new Date();
  const in14  = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const urgent = programs.filter((p) => {
    if (['missed', 'accepted', 'rejected'].includes(p.status)) return false;
    if (!p.deadlineWinterParsed) return false;
    const d = new Date(p.deadlineWinterParsed);
    return d >= today && d <= in14;
  });

  printBox('German Masters Application Tracker', [
    `Total programs:              ${chalk.bold(total)}`,
    `Not yet started:             ${chalk.white(notYet)}`,
    `Currently filling:           ${chalk.yellow(filling)}`,
    `Pending decision:            ${chalk.cyan(pending)}`,
    `Accepted:                    ${chalk.green(accepted)}`,
    `Missed:                      ${chalk.red.dim(missed)}`,
    `Rejected:                    ${chalk.red(rejected)}`,
    chalk.dim('─'.repeat(44)),
    `Uni-Assist programs:         ${chalk.magenta(uniAssist)}  ${chalk.dim('(need VPD)')}`,
    `Letters generated:           ${letters === 0 ? chalk.red(letters) : chalk.green(letters)} / ${total}`,
    chalk.dim('─'.repeat(44)),
    `HIGH priority   (score ≥70): ${chalk.green(high)}  programs`,
    `MEDIUM priority (score 40+): ${chalk.yellow(medium)}  programs`,
    `LOW / ineligible (<40):      ${chalk.red(low)}  programs`,
  ], { color: 'cyan' });

  if (urgent.length > 0) {
    console.log();
    console.log(chalk.red.bold(`  ⚠  ${urgent.length} deadline(s) within 14 days — run: node src/index.js status deadlines`));
  }
  console.log();
}

// ── status deadlines ──────────────────────────────────────────────────────

async function runDeadlines(opts) {
  const programs = requirePrograms();
  const weeks = Number(opts.weeks ?? 4);
  const today = new Date();
  const cutoff = new Date(today.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const skip = new Set(['missed', 'accepted', 'rejected']);
  const list = programs
    .filter((p) => {
      if (skip.has(p.status)) return false;
      if (!p.deadlineWinterParsed) return false;
      const d = new Date(p.deadlineWinterParsed);
      return d >= today && d <= cutoff;
    })
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  if (list.length === 0) {
    console.log(chalk.green(`\n  No active deadlines in the next ${weeks} week(s). You're on top of it.\n`));
    return;
  }

  console.log();
  printHeader(`Upcoming Deadlines — next ${weeks} week(s)  (${list.length} programs)`);
  console.log();

  const table = makeTable(
    ['ID', 'Deadline', 'Days', 'Program', 'University', 'Letter', 'UA'],
    [5, 13, 6, 30, 28, 8, 5],
  );

  list.forEach((p) => {
    const days = Math.ceil((new Date(p.deadlineWinterParsed) - today) / (1000 * 60 * 60 * 24));
    const daysStr = days < 14 ? chalk.red.bold(String(days)) : chalk.yellow(String(days));
    const letter  = p.motivationLetterGenerated ? chalk.green('✉ done') : chalk.red('✖ miss');
    const ua      = p.uniAssist ? chalk.magenta('UA') : chalk.dim('—');

    table.push([
      chalk.dim(String(p.id)),
      colorDeadline(p.deadlineWinterParsed).split(' ')[0],  // just the date part
      daysStr,
      p.name.slice(0, 28),
      p.university.slice(0, 26),
      letter,
      ua,
    ]);
  });

  console.log(table.toString());

  const missing = list.filter((p) => !p.motivationLetterGenerated).length;
  if (missing > 0) {
    console.log(chalk.yellow(`\n  ${missing} program(s) still need a motivation letter.`));
    console.log(chalk.dim('  Run: node src/index.js letter batch --deadline-within=' + (weeks * 7)));
  }
  console.log();
}

// ── status export ─────────────────────────────────────────────────────────

async function runExport(opts) {
  const programs = requirePrograms();
  const format = opts.format ?? 'csv';
  const date = new Date().toISOString().slice(0, 10);
  const outPath = join(ROOT, `output/exports/tracker_${date}.${format}`);

  if (format === 'csv') {
    const headers = [
      'id', 'name', 'university', 'city', 'degree', 'language',
      'deadlineWinterParsed', 'status', 'priorityScore',
      'uniAssist', 'motivationLetterGenerated', 'notes',
    ];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = programs.map((p) => headers.map((h) => escape(p[h])).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    writeFileSync(outPath, csv, 'utf-8');
  } else if (format === 'md') {
    const sorted = [...programs].sort((a, b) =>
      (a.deadlineWinterParsed ?? '9999').localeCompare(b.deadlineWinterParsed ?? '9999'),
    );
    const header = `# German Masters Application Tracker\n_Exported: ${date}_\n\n`;
    const cols = '| ID | Program | University | Deadline | Status | Score | Letter | Uni-Assist |\n' +
                 '|---|---|---|---|---|---|---|---|\n';
    const rows = sorted.map((p) =>
      `| ${p.id} | ${p.name} | ${p.university} | ${p.deadlineWinterParsed ?? '—'} | ${p.status} | ${p.priorityScore ?? '—'} | ${p.motivationLetterGenerated ? '✅' : '❌'} | ${p.uniAssist ? '⚠️' : '—'} |`,
    ).join('\n');
    writeFileSync(outPath, header + cols + rows + '\n', 'utf-8');
  } else {
    console.error(chalk.red(`Unknown format: ${format}. Use --format=csv or --format=md`));
    process.exit(1);
  }

  console.log(`\n  ${TICK}  Exported ${programs.length} programs → ${chalk.cyan(outPath)}\n`);
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerStatus(program) {
  const cmd = program
    .command('status')
    .description('Track and manage application statuses');

  cmd
    .command('list')
    .description('List all programs in a table')
    .option('--filter <status>', `Filter by status (${VALID_STATUSES.join('|')})`)
    .option('--uniassist', 'Show only Uni-Assist programs')
    .option('--search <query>', 'Search by name, university, or city')
    .option('--sort <key>', 'Sort by: deadline (default) | priority | name')
    .option('--flag <name>', 'Filter by eligibility flag (e.g. STRONG_FIT)')
    .action((opts) => runList(opts));

  cmd
    .command('update <id> <status>')
    .description(`Update program status (${VALID_STATUSES.join('|')})`)
    .option('--note <text>', 'Append a timestamped note to the program')
    .action((id, status, opts) => runUpdate(id, status, opts));

  cmd
    .command('summary')
    .description('Full dashboard with counts and progress')
    .action(() => runSummary());

  cmd
    .command('deadlines')
    .description('Show upcoming deadlines sorted by urgency')
    .option('--weeks <n>', 'Look-ahead window in weeks (default: 4)', '4')
    .action((opts) => runDeadlines(opts));

  cmd
    .command('export')
    .description('Export tracker as CSV or Markdown')
    .option('--format <fmt>', 'Output format: csv (default) | md', 'csv')
    .action((opts) => runExport(opts));
}
