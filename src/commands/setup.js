import { existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { loadProfile, saveProfile, PATHS } from '../lib/database.js';
import { printBox, printHeader, TICK, CROSS, WARN } from '../lib/formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');
const ENV_PATH = join(ROOT, '.env');

// ─────────────────────────────────────────────────────────────────────────────
// setup init
// ─────────────────────────────────────────────────────────────────────────────

async function runInit(opts) {
  const existing = loadProfile();

  if (existing && !opts.force) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: chalk.yellow('Profile already exists. Overwrite it?'),
      default: false,
    }]);
    if (!overwrite) {
      console.log(chalk.dim('Aborted. Profile unchanged.'));
      return;
    }
  }

  console.log();
  printHeader('German Masters — Profile Setup');
  console.log(chalk.dim('  Answer each question. Press Enter to accept defaults.\n'));

  // ── Step 1: Personal info ────────────────────────────────────────────────
  const personal = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Full name:',
      validate: (v) => v.trim().length > 0 || 'Name is required',
    },
    {
      type: 'input',
      name: 'degree',
      message: 'Bachelor degree title:',
      default: 'B.Sc. Computer Science',
    },
    {
      type: 'input',
      name: 'university',
      message: 'Your university (with country):',
      default: 'University, Morocco',
      validate: (v) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'graduationDate',
      message: 'Expected graduation date (e.g. June 2026):',
      default: 'June 2026',
    },
    {
      type: 'input',
      name: 'gpa',
      message: 'GPA (e.g. 14.5/20 — Bien):',
      default: '14.5/20 (Bien)',
    },
    {
      type: 'input',
      name: 'germanGPA',
      message: 'German scale GPA equivalent (e.g. 2.2):',
      default: '2.2',
    },
    {
      type: 'input',
      name: 'ects',
      message: 'ECTS credits:',
      default: '180',
    },
  ]);

  // ── Step 2: Language ─────────────────────────────────────────────────────
  const language = await inquirer.prompt([
    {
      type: 'input',
      name: 'english',
      message: 'English certification (e.g. IELTS 7.5 (C1)):',
      default: 'IELTS 7.5 (C1)',
    },
    {
      type: 'input',
      name: 'german',
      message: 'German level (e.g. B1 partial):',
      default: 'B1 partial (Goethe listening & reading)',
    },
  ]);

  // ── Step 3: GitHub + skills ──────────────────────────────────────────────
  const online = await inquirer.prompt([
    {
      type: 'input',
      name: 'githubUrl',
      message: 'GitHub profile URL:',
      validate: (v) => v.startsWith('http') || 'Enter a valid URL',
    },
    {
      type: 'input',
      name: 'skills',
      message: 'Key skills (comma-separated):',
      default: 'Python, Machine Learning, Web Development, Data Analysis',
      filter: (v) => v.split(',').map((s) => s.trim()).filter(Boolean),
    },
  ]);

  // ── Step 4: Projects ─────────────────────────────────────────────────────
  console.log(chalk.cyan('\n  Add your GitHub projects (used to personalize letters):'));
  const projects = [];
  let addMore = true;

  while (addMore) {
    const project = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: `  Project ${projects.length + 1} name:`,
        validate: (v) => v.trim().length > 0 || 'Required',
      },
      {
        type: 'input',
        name: 'description',
        message: '  What it does and what tech you used:',
        validate: (v) => v.trim().length > 0 || 'Required',
      },
      {
        type: 'input',
        name: 'relevance',
        message: '  How it relates to your CS skills / target programs:',
        validate: (v) => v.trim().length > 0 || 'Required',
      },
    ]);
    projects.push(project);

    const { more } = await inquirer.prompt([{
      type: 'confirm',
      name: 'more',
      message: '  Add another project?',
      default: projects.length < 2,
    }]);
    addMore = more;
  }

  // ── Step 5: Motivation ───────────────────────────────────────────────────
  console.log(chalk.cyan('\n  Motivation & goals (used in letter generation):'));
  const motivation = await inquirer.prompt([
    {
      type: 'input',
      name: 'whyGermany',
      message: 'Why Germany specifically? (be genuine, 1–2 sentences):',
      validate: (v) => v.trim().length > 10 || 'Please write at least a sentence',
    },
    {
      type: 'input',
      name: 'careerGoals',
      message: 'Career goals after the master\'s (concrete):',
      validate: (v) => v.trim().length > 10 || 'Please write at least a sentence',
    },
    {
      type: 'input',
      name: 'personalTouch',
      message: 'Any unique aspect of your background / story (optional):',
      default: '',
    },
  ]);

  // ── Step 6: API key ──────────────────────────────────────────────────────
  console.log(chalk.cyan('\n  OpenRouter API configuration:'));
  const currentKey = process.env.OPENROUTER_API_KEY ?? '';
  const hasKey = currentKey && currentKey !== 'sk-or-your-key-here';

  const { apiKey } = await inquirer.prompt([{
    type: 'password',
    name: 'apiKey',
    message: hasKey
      ? `OpenRouter API key (leave blank to keep existing ${chalk.dim('sk-or-...' + currentKey.slice(-4))}): `
      : 'OpenRouter API key (from openrouter.ai/keys):',
    mask: '*',
  }]);

  const finalKey = apiKey.trim() || currentKey;
  if (finalKey && finalKey !== 'sk-or-your-key-here') {
    writeFileSync(ENV_PATH, `OPENROUTER_API_KEY=${finalKey}\n`, 'utf-8');
    console.log(chalk.dim('  API key saved to .env'));
  } else {
    console.log(chalk.yellow('  ⚠  No API key set — letter generation will not work until you add one to .env'));
  }

  // ── Assemble and save ─────────────────────────────────────────────────────
  const profile = {
    name: personal.name.trim(),
    degree: personal.degree.trim(),
    university: personal.university.trim(),
    graduationDate: personal.graduationDate.trim(),
    gpa: personal.gpa.trim(),
    germanGPA: personal.germanGPA.trim(),
    ects: personal.ects.trim(),
    english: language.english.trim(),
    german: language.german.trim(),
    githubUrl: online.githubUrl.trim(),
    skills: online.skills,
    projects,
    whyGermany: motivation.whyGermany.trim(),
    careerGoals: motivation.careerGoals.trim(),
    personalTouch: motivation.personalTouch.trim(),
  };

  saveProfile(profile);

  console.log();
  printBox('Profile Saved', [
    `${TICK}  data/profile.json written`,
    `Name:        ${chalk.bold(profile.name)}`,
    `Degree:      ${profile.degree}  (${profile.ects} ECTS)`,
    `GPA:         ${profile.gpa}  → ${profile.germanGPA} (German)`,
    `English:     ${profile.english}`,
    `German:      ${profile.german}`,
    `Projects:    ${profile.projects.length} added`,
  ], { color: 'green' });

  console.log(chalk.dim('\n  Next: node src/index.js import ./german-master-programms.xlsx\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// setup check
// ─────────────────────────────────────────────────────────────────────────────

async function runCheck() {
  console.log();
  printHeader('Environment Check');
  console.log();

  const checks = [];

  // programs.json
  const hasPrograms = existsSync(PATHS.programs);
  let programCount = 0;
  if (hasPrograms) {
    try {
      const { readJSON } = await import('../lib/database.js');
      const p = readJSON(PATHS.programs);
      programCount = Array.isArray(p) ? p.length : 0;
    } catch { /* ignore */ }
  }
  checks.push({
    ok: hasPrograms && programCount > 0,
    label: hasPrograms
      ? `data/programs.json found (${programCount} programs)`
      : 'data/programs.json missing — run: import <file>',
  });

  // profile.json
  const profile = loadProfile();
  const profileComplete = profile && profile.name && profile.projects?.length > 0 && profile.careerGoals;
  checks.push({
    ok: !!profileComplete,
    label: profile
      ? (profileComplete ? 'data/profile.json complete' : 'data/profile.json incomplete — run: setup init')
      : 'data/profile.json missing — run: setup init',
  });

  // API key
  const key = process.env.OPENROUTER_API_KEY;
  const keyOk = key && key !== 'sk-or-your-key-here' && key.startsWith('sk-or-');
  checks.push({
    ok: !!keyOk,
    label: keyOk ? 'OPENROUTER_API_KEY is set' : 'OPENROUTER_API_KEY not set — add to .env',
  });

  // output directories
  const lettersDir = existsSync(PATHS.letters);
  const exportsDir = existsSync(PATHS.exports);
  checks.push({
    ok: lettersDir,
    label: lettersDir ? 'output/letters/ directory exists' : 'output/letters/ missing (will be auto-created)',
    warn: !lettersDir,
  });
  checks.push({
    ok: exportsDir,
    label: exportsDir ? 'output/exports/ directory exists' : 'output/exports/ missing (will be auto-created)',
    warn: !exportsDir,
  });

  // pandoc (optional — for PDF export)
  let pandocOk = false;
  try {
    execSync('pandoc --version', { stdio: 'ignore' });
    pandocOk = true;
  } catch { /* not installed */ }
  checks.push({
    ok: pandocOk,
    optional: true,
    label: pandocOk ? 'pandoc found — PDF export available' : 'pandoc not found — PDF export unavailable (optional)',
  });

  // npm dependencies — spot-check key packages
  const required = ['@anthropic-ai/sdk', 'commander', 'exceljs', 'chalk', 'inquirer', 'ora'];
  let depsOk = true;
  const missingDeps = [];
  for (const dep of required) {
    try {
      await import(dep);
    } catch {
      depsOk = false;
      missingDeps.push(dep);
    }
  }
  checks.push({
    ok: depsOk,
    label: depsOk
      ? 'All npm dependencies installed'
      : `Missing packages: ${missingDeps.join(', ')} — run: npm install`,
  });

  // Print results
  let allGood = true;
  for (const c of checks) {
    if (c.optional) {
      const icon = c.ok ? TICK : chalk.dim('○ ');
      console.log(`  ${icon}  ${chalk.dim(c.label)}`);
    } else if (c.ok) {
      console.log(`  ${TICK}  ${c.label}`);
    } else if (c.warn) {
      console.log(`  ${WARN} ${chalk.yellow(c.label)}`);
    } else {
      console.log(`  ${CROSS}  ${chalk.red(c.label)}`);
      allGood = false;
    }
  }

  console.log();
  if (allGood) {
    console.log(chalk.green.bold('  Everything looks good. You\'re ready to run imports and generate letters.'));
  } else {
    console.log(chalk.yellow.bold('  Some checks failed. Fix the issues above before proceeding.'));
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

export function registerSetup(program) {
  const cmd = program
    .command('setup')
    .description('First-run setup and environment check');

  cmd
    .command('init')
    .description('Interactive wizard to create profile.json and .env')
    .option('-f, --force', 'Overwrite existing profile without prompting')
    .action((opts) => runInit(opts));

  cmd
    .command('check')
    .description('Validate environment, API key, and dependencies')
    .action(() => runCheck());
}
