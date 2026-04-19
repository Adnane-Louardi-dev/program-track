/**
 * scrape.js — CLI command to scrape admission requirements for one program.
 *
 *   node src/index.js scrape <id>
 */

import ora from 'ora';
import chalk from 'chalk';
import { requirePrograms, getProgramById } from '../lib/database.js';
import { scrapeProgram } from '../lib/scraper.js';
import { colorStatus, priorityStars } from '../lib/formatter.js';

async function runScrape(id) {
  requirePrograms();

  const program = getProgramById(id);
  if (!program) {
    console.error(chalk.red(`Program ID ${id} not found.`));
    process.exit(1);
  }

  const target = program.accessLink || program.website;
  if (!target || !target.startsWith('http')) {
    console.error(chalk.red(`Program ${id} has no valid website or accessLink.`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold(`  [${id}] ${program.name}`));
  console.log(chalk.dim(`       ${program.university}`));
  console.log(chalk.dim(`       → ${target}\n`));

  const spinner = ora({ text: 'Fetching page…', color: 'yellow' }).start();

  try {
    const result = await scrapeProgram(id);
    spinner.succeed(chalk.green('Scraped successfully'));

    const req = result.program.requirements;
    console.log();
    console.log(chalk.bold('  Requirements'));
    console.log(chalk.dim(`       source:      ${req.source}`));
    console.log(chalk.dim(`       type:        ${req.sourceType}`));
    console.log(chalk.dim(`       confidence:  ${req.confidence ?? '—'}`));
    console.log(chalk.dim(`       deadline:    ${req.deadline ?? '—'}`));
    console.log(chalk.dim(`       academic:    ${req.academic.length} item(s)`));
    console.log(chalk.dim(`       documents:   ${req.documents.length} item(s)`));
    console.log(chalk.dim(`       other:       ${req.other.length} item(s)`));

    console.log();
    const delta = result.newScore - result.oldScore;
    const deltaStr = delta === 0 ? chalk.dim('±0')
                   : delta  >  0 ? chalk.green(`+${delta}`)
                                 : chalk.red(String(delta));
    console.log(`  Score:    ${result.oldScore} → ${chalk.bold(result.newScore)}  (${deltaStr})  ${priorityStars(result.newScore)}`);
    console.log(`  Status:   ${colorStatus(result.program.status)}`);

    if (result.deadlineChanged) {
      console.log(chalk.yellow(`  ⚠  Deadline updated: ${result.program.deadlineWinterParsed}  (note appended)`));
    }

    if (result.status === 'insufficient') {
      console.log(chalk.yellow('\n  ⚠  Page did not contain admission requirements. Try editing accessLink manually.'));
    }
    console.log();
  } catch (err) {
    spinner.fail(chalk.red(err.message));
    console.log(chalk.dim('\n  See output/errors.log for details.\n'));
    process.exit(1);
  }
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerScrape(program) {
  program
    .command('scrape <id>')
    .description('Scrape admission requirements from a program\'s page')
    .action((id) => runScrape(id));
}
