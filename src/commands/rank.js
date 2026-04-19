import chalk from 'chalk';
import ora from 'ora';
import { loadPrograms, savePrograms, requirePrograms } from '../lib/database.js';
import { computeFlags, computeScore } from '../lib/eligibility.js';
import { printHeader, makeTable, priorityStars, TICK } from '../lib/formatter.js';

// ── Flag display ──────────────────────────────────────────────────────────

const FLAG_LABEL = {
  STRONG_FIT:      chalk.green('✦ STRONG FIT'),
  ECTS_GAP:        chalk.yellow('⚠ ECTS GAP'),
  GERMAN_REQUIRED: chalk.red('✖ GERMAN REQ'),
  DEADLINE_PASSED: chalk.red('✖ EXPIRED'),
  GPA_RISK:        chalk.yellow('⚠ GPA RISK'),
};

function renderFlags(flags) {
  if (!flags?.length) return chalk.dim('—');
  return flags.map((f) => FLAG_LABEL[f] ?? chalk.dim(f)).join('  ');
}

function scoreBar(score) {
  if (score === null || score === undefined) return chalk.dim('—');
  const filled = Math.round(score / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = score >= 70 ? chalk.green : score >= 40 ? chalk.yellow : chalk.red;
  return color(bar) + ' ' + chalk.bold(score);
}

// ── rank score ────────────────────────────────────────────────────────────

async function runScore() {
  const programs = requirePrograms();
  const spinner = ora('Scoring all programs…').start();

  let changed = 0;
  const updated = programs.map((p) => {
    const flags = computeFlags(p);
    const score = computeScore({ ...p, eligibilityFlags: flags });
    if (p.priorityScore !== score || JSON.stringify(p.eligibilityFlags) !== JSON.stringify(flags)) {
      changed++;
    }
    return { ...p, eligibilityFlags: flags, priorityScore: score };
  });

  savePrograms(updated);
  spinner.succeed(`Scored ${chalk.bold(updated.length)} programs  (${changed} updated)`);

  // Summary breakdown
  const high   = updated.filter((p) => p.priorityScore >= 70).length;
  const medium = updated.filter((p) => p.priorityScore >= 40 && p.priorityScore < 70).length;
  const low    = updated.filter((p) => p.priorityScore < 40).length;

  console.log();
  console.log(`  ${chalk.green('★★★ HIGH')}   (score ≥ 70):  ${chalk.bold(high)} programs`);
  console.log(`  ${chalk.yellow('★★☆ MEDIUM')} (score 40–69): ${chalk.bold(medium)} programs`);
  console.log(`  ${chalk.red('★☆☆ LOW')}    (score < 40):  ${chalk.bold(low)} programs`);
  console.log();
  console.log(chalk.dim('  Run: node src/index.js rank filter --min-score=70'));
  console.log(chalk.dim('  Run: node src/index.js rank flags'));
}

// ── rank filter ───────────────────────────────────────────────────────────

async function runFilter(opts) {
  const programs = requirePrograms();
  const minScore = Number(opts.minScore ?? 0);
  const maxScore = Number(opts.maxScore ?? 100);

  const filtered = programs
    .filter((p) => (p.priorityScore ?? 0) >= minScore && (p.priorityScore ?? 0) <= maxScore)
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  if (filtered.length === 0) {
    console.log(chalk.yellow(`  No programs found with score between ${minScore} and ${maxScore}.`));
    return;
  }

  console.log();
  printHeader(`Programs with score ≥ ${minScore}  (${filtered.length} results)`);
  console.log();

  const table = makeTable(
    ['#', 'Score', '★', 'Program', 'University', 'City', 'Flags'],
    [4, 14, 5, 30, 28, 14, 36],
  );

  filtered.forEach((p, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      scoreBar(p.priorityScore),
      priorityStars(p.priorityScore),
      p.name,
      p.university,
      p.city || chalk.dim('—'),
      renderFlags(p.eligibilityFlags),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`\n  Showing ${filtered.length} of ${programs.length} programs.\n`));
}

// ── rank flags ────────────────────────────────────────────────────────────

async function runFlags(opts) {
  const programs = requirePrograms();
  const filterFlag = opts.flag?.toUpperCase();

  const relevant = programs
    .filter((p) => {
      if (filterFlag) return p.eligibilityFlags?.includes(filterFlag);
      return p.eligibilityFlags?.length > 0;
    })
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  // Group by flag if no specific flag requested
  const FLAG_ORDER = ['DEADLINE_PASSED', 'GERMAN_REQUIRED', 'ECTS_GAP', 'GPA_RISK', 'STRONG_FIT'];

  if (!filterFlag) {
    for (const flag of FLAG_ORDER) {
      const group = programs.filter((p) => p.eligibilityFlags?.includes(flag));
      if (group.length === 0) continue;

      console.log();
      console.log('  ' + (FLAG_LABEL[flag] ?? chalk.bold(flag)) + chalk.dim(`  (${group.length})`));
      console.log(chalk.dim('  ' + '─'.repeat(60)));

      group
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
        .slice(0, opts.all ? Infinity : 10)
        .forEach((p) => {
          const score = p.priorityScore !== null ? chalk.dim(`[${p.priorityScore}]`) : '';
          console.log(`    ${score.padEnd(6)} ${p.name} — ${p.university}`);
        });

      if (!opts.all && group.length > 10) {
        console.log(chalk.dim(`    … and ${group.length - 10} more. Use --all to show all.`));
      }
    }

    console.log();
    return;
  }

  // Single flag view — full table
  console.log();
  printHeader(`Programs flagged: ${FLAG_LABEL[filterFlag] ?? filterFlag}  (${relevant.length})`);
  console.log();

  const table = makeTable(
    ['ID', 'Score', 'Program', 'University', 'Deadline', 'All Flags'],
    [5, 14, 30, 28, 14, 36],
  );

  relevant.forEach((p) => {
    table.push([
      chalk.dim(String(p.id)),
      scoreBar(p.priorityScore),
      p.name,
      p.university,
      p.deadlineWinterParsed ?? chalk.dim('—'),
      renderFlags(p.eligibilityFlags),
    ]);
  });

  console.log(table.toString());
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerRank(program) {
  const cmd = program
    .command('rank')
    .description('Score and rank programs by fit and eligibility');

  cmd
    .command('score')
    .description('Re-compute priority scores and eligibility flags for all programs')
    .action(() => runScore());

  cmd
    .command('filter')
    .description('List programs above a score threshold')
    .option('--min-score <n>', 'Minimum score (0–100)', '70')
    .option('--max-score <n>', 'Maximum score (0–100)', '100')
    .action((opts) => runFilter(opts));

  cmd
    .command('flags')
    .description('Show eligibility warnings grouped by flag type')
    .option('--flag <name>', 'Show only programs with this specific flag (e.g. ECTS_GAP)')
    .option('--all', 'Show all programs in each group (default: top 10)')
    .action((opts) => runFlags(opts));
}
