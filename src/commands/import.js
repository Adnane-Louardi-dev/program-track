import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { parseExcel, mergePrograms } from '../lib/excel.js';
import { loadPrograms, savePrograms, PATHS } from '../lib/database.js';
import { printBox, printHeader, TICK, WARN, colorDeadline } from '../lib/formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');
const DEFAULT_INPUT = join(ROOT, 'input/german-master-programms.xlsx');

// ── Helpers ───────────────────────────────────────────────────────────────

function flagBadge(flag) {
  const map = {
    STRONG_FIT:       chalk.green('✦ STRONG FIT'),
    ECTS_GAP:         chalk.yellow('⚠ ECTS GAP'),
    GERMAN_REQUIRED:  chalk.red('✖ GERMAN REQ'),
    DEADLINE_PASSED:  chalk.red('✖ EXPIRED'),
    GPA_RISK:         chalk.yellow('⚠ GPA RISK'),
  };
  return map[flag] ?? chalk.dim(flag);
}

function summarizeImport(programs) {
  const total       = programs.length;
  const uniAssist   = programs.filter((p) => p.uniAssist).length;
  const english     = programs.filter((p) => /english/i.test(p.language)).length;
  const german      = programs.filter((p) => /deutsch|^german$/i.test(p.language)).length;
  const noParsed    = programs.filter((p) => !p.deadlineWinterParsed).length;
  const strongFit   = programs.filter((p) => p.eligibilityFlags.includes('STRONG_FIT')).length;
  const ectsGap     = programs.filter((p) => p.eligibilityFlags.includes('ECTS_GAP')).length;
  const germanReq   = programs.filter((p) => p.eligibilityFlags.includes('GERMAN_REQUIRED')).length;
  const expired     = programs.filter((p) => p.eligibilityFlags.includes('DEADLINE_PASSED')).length;
  const high        = programs.filter((p) => p.priorityScore >= 70).length;
  const medium      = programs.filter((p) => p.priorityScore >= 40 && p.priorityScore < 70).length;
  const low         = programs.filter((p) => p.priorityScore < 40).length;

  printBox('Import Complete', [
    `${TICK}  ${chalk.bold(total)} programs imported`,
    chalk.dim('─'.repeat(40)),
    `  Uni-Assist (VPD needed):   ${chalk.yellow(uniAssist)}`,
    `  English programs:          ${chalk.green(english)}`,
    `  German-only programs:      ${chalk.red(german)}`,
    `  Unparseable deadlines:     ${noParsed > 0 ? chalk.yellow(noParsed) : chalk.green(noParsed)}`,
    chalk.dim('─'.repeat(40)),
    `  ${chalk.green('✦ Strong fit:')}             ${strongFit}`,
    `  ${chalk.yellow('⚠ ECTS gap risk:')}          ${ectsGap}`,
    `  ${chalk.red('✖ German required:')}        ${germanReq}`,
    `  ${chalk.red('✖ Deadline passed:')}        ${expired}`,
    chalk.dim('─'.repeat(40)),
    `  ${chalk.green('HIGH')} priority (≥70):        ${high}`,
    `  ${chalk.yellow('MEDIUM')} priority (40–69):    ${medium}`,
    `  ${chalk.red('LOW')} priority (<40):         ${low}`,
  ], { color: 'green' });
}

// ── Command ───────────────────────────────────────────────────────────────

async function runImport(filePath, opts) {
  // Resolve file path
  const resolved = filePath
    ? (existsSync(filePath) ? filePath : join(process.cwd(), filePath))
    : DEFAULT_INPUT;

  if (!existsSync(resolved)) {
    console.error(chalk.red(`File not found: ${resolved}`));
    console.error(chalk.dim(`Place your Excel file at: ${DEFAULT_INPUT}`));
    console.error(chalk.dim(`Or pass the path explicitly: node src/index.js import <path>`));
    process.exit(1);
  }

  // Warn before overwriting existing data
  const existing = loadPrograms();
  if (existing.length > 0 && !opts.force) {
    console.log(chalk.yellow(`\n  ⚠  programs.json already contains ${existing.length} programs.`));
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: 'Re-import? Manually set fields (status, notes, letters) will be preserved.',
      default: true,
    }]);
    if (!overwrite) {
      console.log(chalk.dim('  Aborted. No changes made.'));
      return;
    }
  }

  // Parse
  const spinner = ora(`Parsing ${chalk.cyan(resolved)} …`).start();
  let fresh;
  try {
    fresh = await parseExcel(resolved);
    spinner.succeed(`Parsed ${chalk.bold(fresh.length)} programs from Excel`);
  } catch (err) {
    spinner.fail(`Failed to parse Excel: ${err.message}`);
    process.exit(1);
  }

  // Merge with existing (preserves manual fields)
  let final = fresh;
  if (existing.length > 0) {
    final = mergePrograms(existing, fresh);
    console.log(chalk.dim(`  Merged with ${existing.length} existing records — manual fields preserved.`));
  }

  // Save
  savePrograms(final);
  console.log(chalk.dim(`  Saved → data/programs.json\n`));

  // Summary
  summarizeImport(final);

  // Show upcoming deadlines preview
  if (!opts.quiet) {
    const today = new Date();
    const in30  = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcoming = final
      .filter((p) => p.deadlineWinterParsed && !p.eligibilityFlags.includes('DEADLINE_PASSED'))
      .filter((p) => new Date(p.deadlineWinterParsed) <= in30)
      .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed))
      .slice(0, 8);

    if (upcoming.length > 0) {
      console.log();
      printHeader('Deadlines in the next 30 days');
      upcoming.forEach((p) => {
        const ua = p.uniAssist ? chalk.magenta(' [UA]') : '';
        console.log(`  ${colorDeadline(p.deadlineWinterParsed).padEnd(28)}  ${p.name} — ${p.university}${ua}`);
      });
    }

    console.log(chalk.dim('\n  Next: node src/index.js rank score'));
  }
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerImport(program) {
  program
    .command('import [file]')
    .description('Parse Excel spreadsheet and create data/programs.json')
    .option('-f, --force', 'Skip confirmation prompt and overwrite existing data')
    .option('-q, --quiet', 'Suppress deadline preview after import')
    .action((file, opts) => runImport(file, opts));
}
