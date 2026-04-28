import chalk from 'chalk';
import { requirePrograms } from '../lib/database.js';
import { printHeader, WARN } from '../lib/formatter.js';

// ── Shared helpers ────────────────────────────────────────────────────────

const DAY_MS   = 24 * 60 * 60 * 1000;
const WEEK_MS  = 7 * DAY_MS;

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(isoDate) {
  return Math.ceil((new Date(isoDate) - today()) / DAY_MS);
}

function fmtDate(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtShort(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Programs that are still actionable (not done). */
function actionable(programs) {
  const done = new Set(['accepted', 'rejected', 'missed', 'impossible']);
  return programs.filter((p) => !done.has(p.status) && p.deadlineWinterParsed);
}

/** Group programs by ISO week string "YYYY-Www". */
function isoWeek(isoDate) {
  const d = new Date(isoDate);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = Math.ceil(((d - jan4) / DAY_MS + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the week containing `date`. */
function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sunday of the week containing `date`. */
function weekEnd(date) {
  const s = weekStart(date);
  const e = new Date(s.getTime() + 6 * DAY_MS);
  return e;
}

function urgencyColor(days) {
  if (days < 0)  return chalk.red.bold;
  if (days < 7)  return chalk.red.bold;
  if (days < 14) return chalk.red;
  if (days < 21) return chalk.yellow;
  return chalk.white;
}

function letterTag(p) {
  return p.motivationLetterGenerated
    ? chalk.green('✉ ready')
    : chalk.red('✖ letter missing');
}

function uaTag(p) {
  return p.uniAssist ? chalk.magenta(' [UA]') : '';
}

// ── plan today ────────────────────────────────────────────────────────────

async function runToday() {
  const programs = requirePrograms();
  const t = today();
  const todayLabel = fmtDate(t);

  // Overdue: deadline passed but not yet marked missed/rejected
  const overdue = programs
    .filter((p) => {
      if (['accepted', 'rejected', 'missed'].includes(p.status)) return false;
      if (!p.deadlineWinterParsed) return false;
      return new Date(p.deadlineWinterParsed) < t;
    })
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  // Urgent this week (within 7 days)
  const thisWeek = actionable(programs)
    .filter((p) => {
      const d = daysUntil(p.deadlineWinterParsed);
      return d >= 0 && d < 7;
    })
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  // Coming up next week (7–14 days)
  const nextWeek = actionable(programs)
    .filter((p) => {
      const d = daysUntil(p.deadlineWinterParsed);
      return d >= 7 && d < 14;
    })
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  // Uni-Assist: programs where VPD must be submitted within 7 days
  // (deadline - 42 days = latest VPD submit date)
  const uaUrgent = programs
    .filter((p) => {
      if (!p.uniAssist || !p.deadlineWinterParsed) return false;
      if (['accepted', 'rejected', 'missed'].includes(p.status)) return false;
      const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
      const daysToVpd = Math.ceil((vpd - t) / DAY_MS);
      return daysToVpd >= 0 && daysToVpd <= 14;
    })
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  // Letters missing for programs due within 30 days
  const lettersNeeded = actionable(programs)
    .filter((p) => !p.motivationLetterGenerated && daysUntil(p.deadlineWinterParsed) <= 30)
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  // ── Print ──────────────────────────────────────────────────────────────
  const width = 56;
  const border = chalk.cyan('╔' + '═'.repeat(width) + '╗');
  const borderMid = chalk.cyan('╠' + '═'.repeat(width) + '╣');
  const borderBot = chalk.cyan('╚' + '═'.repeat(width) + '╝');
  const row = (str = '') => {
    const visible = str.replace(/\x1B\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - visible.length - 2);
    return chalk.cyan('║') + ' ' + str + ' '.repeat(pad) + ' ' + chalk.cyan('║');
  };

  console.log();
  console.log(border);
  console.log(row(chalk.bold.cyan(`TODAY — ${todayLabel}`)));
  console.log(borderBot);
  console.log();

  // Overdue
  if (overdue.length > 0) {
    console.log(chalk.red.bold('  🔴 OVERDUE — act immediately:'));
    overdue.forEach((p) => {
      const days = Math.abs(daysUntil(p.deadlineWinterParsed));
      console.log(chalk.red(`     • [${p.id}] ${p.name}`));
      console.log(chalk.red.dim(`       ${p.university}  —  was due ${days}d ago${uaTag(p)}`));
      console.log(chalk.dim(`       Verify if still open: ${p.website || p.accessLink || '—'}`));
    });
    console.log();
  }

  // Urgent this week
  if (thisWeek.length > 0) {
    console.log(chalk.red.bold('  🟠 THIS WEEK (due within 7 days):'));
    thisWeek.forEach((p) => {
      const days = daysUntil(p.deadlineWinterParsed);
      console.log(chalk.red(`     • [${p.id}] ${p.name} — ${p.university}`));
      console.log(`       ${chalk.red.bold(`Due: ${fmtShort(p.deadlineWinterParsed)} (${days}d)`)}  ${letterTag(p)}${uaTag(p)}`);
      if (!p.motivationLetterGenerated) {
        console.log(chalk.dim(`       → node src/index.js letter generate ${p.id}`));
      }
    });
    console.log();
  }

  // Next week
  if (nextWeek.length > 0) {
    console.log(chalk.yellow.bold('  🟡 NEXT WEEK (7–14 days):'));
    nextWeek.forEach((p) => {
      const days = daysUntil(p.deadlineWinterParsed);
      console.log(chalk.yellow(`     • [${p.id}] ${p.name} — ${p.university}`));
      console.log(`       ${chalk.yellow(`Due: ${fmtShort(p.deadlineWinterParsed)} (${days}d)`)}  ${letterTag(p)}${uaTag(p)}`);
    });
    console.log();
  }

  // Uni-Assist urgent VPD
  if (uaUrgent.length > 0) {
    console.log(chalk.magenta.bold('  📋 UNI-ASSIST — VPD submit window closing:'));
    uaUrgent.forEach((p) => {
      const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
      const daysToVpd = Math.ceil((vpd - t) / DAY_MS);
      const urgLabel = daysToVpd <= 7
        ? chalk.red.bold(`Submit VPD by ${fmtShort(vpd.toISOString().slice(0, 10))} (${daysToVpd}d!)`)
        : chalk.yellow(`Submit VPD by ${fmtShort(vpd.toISOString().slice(0, 10))} (${daysToVpd}d)`);
      console.log(chalk.magenta(`     • [${p.id}] ${p.name}`));
      console.log(`       App deadline: ${fmtShort(p.deadlineWinterParsed)}  —  ${urgLabel}`);
    });
    console.log();
  }

  // Suggested actions
  console.log(chalk.cyan.bold('  📌 SUGGESTED ACTIONS:'));

  let actionNum = 1;

  if (lettersNeeded.length > 0) {
    const ids = lettersNeeded.slice(0, 5).map((p) => p.id).join(',');
    console.log(`     ${actionNum++}. Generate ${lettersNeeded.length} missing letter(s) due within 30 days:`);
    console.log(chalk.dim(`        node src/index.js letter batch --deadline-within=30 --limit=5`));
  }

  if (overdue.length > 0) {
    console.log(`     ${actionNum++}. Check if ${overdue.length} overdue program(s) still accept late applications`);
  }

  const uaTotal = programs.filter((p) => p.uniAssist && !['accepted', 'rejected', 'missed'].includes(p.status)).length;
  if (uaTotal > 0) {
    console.log(`     ${actionNum++}. Submit Uni-Assist VPD for ${uaTotal} programs (6-week processing time)`);
    console.log(chalk.dim(`        node src/index.js plan uniassist`));
  }

  const noLetter = actionable(programs).filter((p) => !p.motivationLetterGenerated).length;
  console.log(`     ${actionNum++}. ${noLetter} programs still need motivation letters`);
  console.log(chalk.dim(`        node src/index.js letter batch --priority=high --limit=10`));

  console.log();

  // Quick stats bar
  const done  = programs.filter((p) => ['accepted', 'rejected', 'missed'].includes(p.status)).length;
  const total = programs.length;
  const pct   = Math.round((done / total) * 100);
  const bar   = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(chalk.dim(`  Progress: [${bar}] ${pct}% decided  (${done}/${total} programs)`));
  console.log();
}

// ── plan generate ─────────────────────────────────────────────────────────

async function runGenerate(opts) {
  const programs = requirePrograms();
  const weeks = Number(opts.weeks ?? 12);
  const t = today();

  // Collect future deadlines only (overdue handled in plan today)
  const active = actionable(programs).filter((p) => new Date(p.deadlineWinterParsed) >= t);

  // Build week buckets: Map<weekStart ISO → program[]>
  const buckets = new Map();

  active.forEach((p) => {
    const dl = new Date(p.deadlineWinterParsed);
    if (dl > new Date(t.getTime() + weeks * WEEK_MS)) return; // beyond window
    const ws = weekStart(dl).toISOString().slice(0, 10);
    if (!buckets.has(ws)) buckets.set(ws, []);
    buckets.get(ws).push(p);
  });

  // Also include Uni-Assist VPD dates
  const uaBuckets = new Map();
  programs
    .filter((p) => p.uniAssist && p.deadlineWinterParsed && !['accepted', 'rejected', 'missed'].includes(p.status))
    .forEach((p) => {
      const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
      if (vpd < t || vpd > new Date(t.getTime() + weeks * WEEK_MS)) return;
      const ws = weekStart(vpd).toISOString().slice(0, 10);
      if (!uaBuckets.has(ws)) uaBuckets.set(ws, []);
      uaBuckets.get(ws).push(p);
    });

  // Merge all week keys and sort
  const allWeeks = [...new Set([...buckets.keys(), ...uaBuckets.keys()])].sort();

  if (allWeeks.length === 0) {
    console.log(chalk.green('\n  No active deadlines in the next ' + weeks + ' weeks. 🎉\n'));
    return;
  }

  console.log();
  console.log(chalk.bold.cyan(`  📅  ${weeks}-Week Action Plan  —  from ${fmtDate(t)}`));
  console.log();

  for (const ws of allWeeks) {
    const wStart = new Date(ws);
    const wEnd   = weekEnd(wStart);
    const dApps  = buckets.get(ws) ?? [];
    const dVpd   = uaBuckets.get(ws) ?? [];

    // Week header
    const label = `WEEK OF ${wStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }).toUpperCase()} – ${wEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}`;
    console.log(chalk.cyan.bold('  📅 ' + label));
    console.log(chalk.cyan('  ' + '━'.repeat(label.length + 5)));

    // VPD deadlines first (most urgent)
    dVpd.forEach((p) => {
      const vpd  = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
      const days = Math.ceil((vpd - t) / DAY_MS);
      const col  = days <= 7 ? chalk.red.bold : chalk.magenta;
      console.log(col(`  🔷  Submit Uni-Assist VPD — ${p.name} — ${p.university}`));
      console.log(chalk.dim(`       App deadline: ${fmtShort(p.deadlineWinterParsed)}  |  VPD must be in by: ${fmtShort(vpd.toISOString().slice(0, 10))}  (${days}d)`));
    });

    // Application deadlines
    dApps.sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
    dApps.forEach((p) => {
      const days = daysUntil(p.deadlineWinterParsed);
      const col  = urgencyColor(days);
      const icon = days < 7 ? '⚠️ ' : '📝 ';
      console.log(col(`  ${icon} [${p.id}] ${p.name} — ${p.university}`));
      console.log(`       Due: ${chalk.bold(fmtShort(p.deadlineWinterParsed))} (${days}d)  ${letterTag(p)}${uaTag(p)}`);
      if (!p.motivationLetterGenerated) {
        console.log(chalk.dim(`       → node src/index.js letter generate ${p.id}`));
      }
    });

    // Batch suggestion for this week's missing letters
    const missing = dApps.filter((p) => !p.motivationLetterGenerated);
    if (missing.length > 1) {
      const maxDays = Math.max(...dApps.map((p) => daysUntil(p.deadlineWinterParsed)));
      console.log(chalk.dim(`\n  💡  Batch: node src/index.js letter batch --deadline-within=${maxDays} --limit=${missing.length}`));
    }

    console.log();
  }

  // Summary footer
  const totalMissing = active.filter((p) => !p.motivationLetterGenerated).length;
  console.log(chalk.dim(`  Total letters still needed: ${totalMissing} / ${active.length} active programs`));
  console.log(chalk.dim(`  Run: node src/index.js status summary`));
  console.log();
}

// ── plan uniassist ────────────────────────────────────────────────────────

async function runUniassist() {
  const programs = requirePrograms();
  const t = today();

  const uaPrograms = programs
    .filter((p) => p.uniAssist && p.deadlineWinterParsed && !['accepted', 'rejected', 'missed'].includes(p.status))
    .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));

  if (uaPrograms.length === 0) {
    console.log(chalk.green('\n  No active Uni-Assist programs found.\n'));
    return;
  }

  console.log();
  printHeader(`Uni-Assist VPD Timeline  —  ${uaPrograms.length} programs`);
  console.log();
  console.log(chalk.dim('  Processing time: 4–6 weeks. Submit VPD at least 42 days before app deadline.'));
  console.log();

  // Column widths
  const colW = [5, 32, 28, 13, 16, 10];
  const header = [
    'ID', 'Program', 'University', 'App Deadline', 'VPD Submit By', 'Status'
  ];

  // Simple manual table (avoid cli-table3 width issues here)
  const pad = (s, w) => String(s).slice(0, w).padEnd(w);
  const divider = '  ' + colW.map((w) => '─'.repeat(w)).join('  ');

  console.log('  ' + colW.map((h, i) => chalk.bold.cyan(pad(header[i], colW[i]))).join('  '));
  console.log(chalk.dim(divider));

  uaPrograms.forEach((p) => {
    const vpdDate = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
    const vpdISO  = vpdDate.toISOString().slice(0, 10);
    const daysToVpd = Math.ceil((vpdDate - t) / DAY_MS);

    let vpdLabel, statusLabel;

    if (daysToVpd < 0) {
      vpdLabel    = chalk.red(pad(vpdISO, colW[4]));
      statusLabel = chalk.red('⚠ OVERDUE');
    } else if (daysToVpd <= 7) {
      vpdLabel    = chalk.red.bold(pad(vpdISO, colW[4]));
      statusLabel = chalk.red.bold(`${daysToVpd}d — URGENT`);
    } else if (daysToVpd <= 21) {
      vpdLabel    = chalk.yellow(pad(vpdISO, colW[4]));
      statusLabel = chalk.yellow(`${daysToVpd}d — soon`);
    } else {
      vpdLabel    = chalk.green(pad(vpdISO, colW[4]));
      statusLabel = chalk.green(`${daysToVpd}d`);
    }

    const letterMark = p.motivationLetterGenerated ? chalk.green('✉') : chalk.dim('○');

    console.log([
      '  ' + chalk.dim(pad(String(p.id), colW[0])),
      pad(p.name, colW[1]),
      pad(p.university, colW[2]),
      chalk.cyan(pad(p.deadlineWinterParsed, colW[3])),
      vpdLabel,
      statusLabel + ' ' + letterMark,
    ].join('  '));
  });

  console.log(chalk.dim(divider));

  // Grouping summary
  const overdue  = uaPrograms.filter((p) => {
    const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
    return vpd < t;
  });
  const urgent   = uaPrograms.filter((p) => {
    const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
    const d   = Math.ceil((vpd - t) / DAY_MS);
    return d >= 0 && d <= 7;
  });
  const upcoming = uaPrograms.filter((p) => {
    const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
    const d   = Math.ceil((vpd - t) / DAY_MS);
    return d > 7 && d <= 21;
  });

  console.log();
  if (overdue.length)  console.log(chalk.red.bold(`  ⚠  ${overdue.length} VPD submission(s) overdue — verify program status`));
  if (urgent.length)   console.log(chalk.red(`  ⚠  ${urgent.length} VPD submission(s) due within 7 days`));
  if (upcoming.length) console.log(chalk.yellow(`  ○  ${upcoming.length} VPD submission(s) due within 3 weeks`));

  console.log();
  console.log(chalk.dim('  Submit VPD at: https://www.uni-assist.de'));
  console.log(chalk.dim('  You will need: transcripts, degree certificate, passport copy'));
  console.log();
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerPlan(program) {
  const cmd = program
    .command('plan')
    .description('Generate action plans and timelines');

  cmd
    .command('today')
    .description("Show today's priorities and urgent actions")
    .action(() => runToday());

  cmd
    .command('generate')
    .description('Full week-by-week action plan')
    .option('--weeks <n>', 'Number of weeks to plan ahead (default: 12)', '12')
    .action((opts) => runGenerate(opts));

  cmd
    .command('uniassist')
    .description('VPD submission timeline for all Uni-Assist programs')
    .action(() => runUniassist());
}
