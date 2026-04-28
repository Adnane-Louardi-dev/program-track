#!/usr/bin/env node

import 'dotenv/config';
import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

// ── Lazy-load commands (keeps startup fast) ────────────────────────────────
async function registerCommands() {
  const [
    { registerSetup },
    { registerImport },
    { registerStatus },
    { registerLetter },
    { registerDocs },
    { registerPlan },
    { registerRank },
    { registerDashboard },
    { registerScrape },
  ] = await Promise.all([
    import('./commands/setup.js'),
    import('./commands/import.js'),
    import('./commands/status.js'),
    import('./commands/letter.js'),
    import('./commands/docs.js'),
    import('./commands/plan.js'),
    import('./commands/rank.js'),
    import('./commands/dashboard.js'),
    import('./commands/scrape.js'),
  ]);

  registerSetup(program);
  registerImport(program);
  registerStatus(program);
  registerLetter(program);
  registerDocs(program);
  registerPlan(program);
  registerRank(program);
  registerDashboard(program);
  registerScrape(program);
}

// ── Startup deadline warning ───────────────────────────────────────────────
async function checkUrgentDeadlines() {
  try {
    const { readJSON } = await import('./lib/database.js');
    const { PATHS } = await import('./lib/database.js');
    const programs = readJSON(PATHS.programs);
    if (!programs) return;

    const today = new Date();
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const skip = new Set(['missed', 'accepted', 'rejected', 'impossible']);

    const urgent = programs.filter((p) => {
      if (skip.has(p.status) || !p.deadlineWinterParsed) return false;
      const d = new Date(p.deadlineWinterParsed);
      return d >= today && d <= in7Days;
    });

    if (urgent.length > 0) {
      const { chalk } = await import('./lib/formatter.js');
      console.log(chalk.bgRed.white.bold(` ⚠  ${urgent.length} deadline(s) within 7 days! `) +
        '  Run: ' + chalk.cyan('node src/index.js status deadlines'));
      urgent.forEach((p) => {
        const d = new Date(p.deadlineWinterParsed);
        const daysLeft = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
        console.log(chalk.red(`   • [${p.id}] ${p.name} — ${p.university} (${daysLeft}d left)`));
      });
      console.log();
    }
  } catch {
    // Non-fatal — silently skip if data not yet initialized
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  program
    .name('gma')
    .description('German Masters Application Hub — automate your application process')
    .version(pkg.version, '-v, --version');

  await registerCommands();
  await checkUrgentDeadlines();

  program.parseAsync(process.argv).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

// main()
// .catch((err) => {
//     console.error('Error:', err.message);
//     process.exit(1);
// });

main();
