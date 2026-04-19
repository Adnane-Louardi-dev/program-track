import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import {
  loadChecklist, saveChecklist, loadPrograms, PATHS,
} from '../lib/database.js';
import { printHeader, printBox, TICK, CROSS, WARN } from '../lib/formatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');

// ── Document groups ───────────────────────────────────────────────────────

const GROUPS = [
  {
    label: 'Academic Documents',
    ids: ['d1', 'd2', 'd3', 'd4'],
  },
  {
    label: 'Language Certificates',
    ids: ['d5', 'd6'],
  },
  {
    label: 'Application Materials',
    ids: ['d7', 'd8', 'd9', 'd10'],
  },
  {
    label: 'Uni-Assist',
    ids: ['d11', 'd12'],
    uniAssistOnly: true,
  },
  {
    label: 'Visa / Financial',
    ids: ['d13', 'd14'],
  },
];

// ── docs list ─────────────────────────────────────────────────────────────

async function runList() {
  const checklist = loadChecklist();
  const programs  = loadPrograms();
  const hasUA     = programs.some((p) => p.uniAssist);
  const letters   = programs.filter((p) => p.motivationLetterGenerated).length;
  const total     = programs.length;

  console.log();

  let totalDocs = 0;
  let doneDocs  = 0;

  for (const group of GROUPS) {
    // Skip Uni-Assist section if no UA programs
    if (group.uniAssistOnly && !hasUA) continue;

    console.log(chalk.bold.cyan(`  ${group.label}`));

    for (const id of group.ids) {
      const doc = checklist[id];
      if (!doc) continue;

      totalDocs++;
      if (doc.done) doneDocs++;

      const icon   = doc.done ? TICK : chalk.dim('⬜');
      const label  = doc.done ? chalk.white(doc.label) : chalk.dim(doc.label);
      const badge  = chalk.dim(`[${id}]`);

      // Special live count for letters (d8)
      let extra = '';
      if (id === 'd8') {
        extra = chalk.dim(` (${letters}/${total} generated)`);
      }

      console.log(`    ${icon}  ${label}${extra}  ${badge}`);
    }

    console.log();
  }

  // Progress bar
  const pct    = Math.round((doneDocs / totalDocs) * 100);
  const filled = Math.round(pct / 5);
  const bar    = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(20 - filled));
  console.log(chalk.dim(`  ─────────────────────────────────`));
  console.log(`  Progress: [${bar}] ${chalk.bold(doneDocs + ' / ' + totalDocs)} documents ready`);
  console.log();
  console.log(chalk.dim('  Mark ready: node src/index.js docs check <id>'));
  console.log(chalk.dim('  e.g.      : node src/index.js docs check d1'));
  console.log();
}

// ── docs check ────────────────────────────────────────────────────────────

async function runCheck(id) {
  const checklist = loadChecklist();
  const doc = checklist[id];

  if (!doc) {
    console.error(chalk.red(`Unknown document ID: "${id}"`));
    console.error(chalk.dim(`Valid IDs: ${Object.keys(checklist).join(', ')}`));
    process.exit(1);
  }

  if (doc.done) {
    console.log(`\n  ${TICK}  "${doc.label}" is already marked complete.\n`);
    return;
  }

  checklist[id] = { ...doc, done: true, doneAt: new Date().toISOString().slice(0, 10) };
  saveChecklist(checklist);

  console.log(`\n  ${TICK}  Marked complete: ${chalk.bold(doc.label)}  ${chalk.dim('[' + id + ']')}\n`);
}

// ── docs uncheck ──────────────────────────────────────────────────────────

async function runUncheck(id) {
  const checklist = loadChecklist();
  const doc = checklist[id];

  if (!doc) {
    console.error(chalk.red(`Unknown document ID: "${id}"`));
    process.exit(1);
  }

  if (!doc.done) {
    console.log(`\n  ${WARN} "${doc.label}" is already marked incomplete.\n`);
    return;
  }

  checklist[id] = { ...doc, done: false, doneAt: undefined };
  saveChecklist(checklist);

  console.log(`\n  ${CROSS}  Marked incomplete: ${chalk.bold(doc.label)}  ${chalk.dim('[' + id + ']')}\n`);
}

// ── docs per-program ──────────────────────────────────────────────────────

async function runPerProgram(id) {
  const programs  = loadPrograms();
  const checklist = loadChecklist();

  const program = programs.find((p) => p.id === Number(id));
  if (!program) {
    console.error(chalk.red(`Program ID ${id} not found.`));
    process.exit(1);
  }

  console.log();
  printHeader(`Documents — [${program.id}] ${program.name}`);
  console.log(chalk.dim(`  ${program.university}  |  ${program.city}  |  Deadline: ${program.deadlineWinterParsed ?? '—'}`));
  console.log();

  // Build per-program required document list
  const required = [
    { id: 'd4',  label: 'Transcript of records',          done: checklist.d4?.done },
    { id: 'd1',  label: "Bachelor's degree certificate",  done: checklist.d1?.done },
    { id: 'd5',  label: 'IELTS 7.0+ certificate',         done: checklist.d5?.done },
    { id: 'd7',  label: 'CV / Resume (Europass)',          done: checklist.d7?.done },
    {
      id: 'letter',
      label: 'Motivation letter',
      done: program.motivationLetterGenerated,
      extra: program.motivationLetterGenerated
        ? chalk.dim(`(${program.motivationLetterWordCount ?? '?'} words, v${program.letterVersions?.length ?? 1})`)
        : chalk.dim(`→ node src/index.js letter generate ${program.id}`),
    },
    { id: 'd9',  label: 'Recommendation letters (2x)',    done: checklist.d9?.done },
  ];

  // Add Uni-Assist if needed
  if (program.uniAssist) {
    required.push(
      { id: 'd11', label: 'VPD application submitted (Uni-Assist)', done: checklist.d11?.done, ua: true },
      { id: 'd12', label: 'Uni-Assist fees paid',                   done: checklist.d12?.done, ua: true },
    );
  }

  // German language cert if needed
  if (program.eligibilityFlags?.includes('GERMAN_REQUIRED')) {
    required.push({ id: 'd6', label: 'German B1+ certificate', done: checklist.d6?.done });
  }

  let ready = 0;
  required.forEach((doc) => {
    const icon  = doc.done ? TICK : chalk.dim('⬜');
    const label = doc.done ? chalk.white(doc.label) : chalk.dim(doc.label);
    const ua    = doc.ua ? chalk.magenta(' [UA]') : '';
    const extra = doc.extra ? `  ${doc.extra}` : '';
    const status = doc.done ? chalk.green('ready') : chalk.red('missing');
    if (doc.done) ready++;
    console.log(`  ${icon}  ${label}${ua}${extra}  ${chalk.dim('—')}  ${status}`);
  });

  console.log();
  const pct  = Math.round((ready / required.length) * 100);
  const bar  = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)));
  console.log(chalk.dim(`  ────────────────────────────────────`));
  console.log(`  Readiness: [${bar}] ${chalk.bold(ready + '/' + required.length)} documents ready`);

  if (program.uniAssist) {
    const vpdDate = new Date(new Date(program.deadlineWinterParsed).getTime() - 42 * 24 * 60 * 60 * 1000);
    const daysToVpd = Math.ceil((vpdDate - new Date()) / (1000 * 60 * 60 * 24));
    console.log();
    if (daysToVpd > 0) {
      console.log(chalk.magenta(`  ⚠  Uni-Assist VPD must be submitted by ${vpdDate.toISOString().slice(0, 10)} (${daysToVpd}d)`));
    } else {
      console.log(chalk.red(`  ✖  Uni-Assist VPD submit window has passed (was ${vpdDate.toISOString().slice(0, 10)})`));
    }
  }
  console.log();
}

// ── docs export ───────────────────────────────────────────────────────────

async function runExport() {
  const checklist = loadChecklist();
  const programs  = loadPrograms();
  const letters   = programs.filter((p) => p.motivationLetterGenerated).length;
  const date      = new Date().toISOString().slice(0, 10);
  const outPath   = join(ROOT, `output/exports/checklist_${date}.md`);

  const lines = [
    `# Application Document Checklist`,
    `_Exported: ${date}_`,
    '',
  ];

  let totalDocs = 0;
  let doneDocs  = 0;

  for (const group of GROUPS) {
    lines.push(`## ${group.label}`);
    lines.push('');
    lines.push('| ID | Document | Status |');
    lines.push('|---|---|---|');

    for (const id of group.ids) {
      const doc = checklist[id];
      if (!doc) continue;
      totalDocs++;
      if (doc.done) doneDocs++;

      let label = doc.label;
      if (id === 'd8') label += ` (${letters}/${programs.length} generated)`;
      const status = doc.done ? '✅ Ready' : '⬜ Missing';
      lines.push(`| ${id} | ${label} | ${status} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`**Progress: ${doneDocs} / ${totalDocs} documents ready**`);
  lines.push('');

  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\n  ${TICK}  Exported checklist → ${chalk.cyan(outPath)}\n`);
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerDocs(program) {
  const cmd = program
    .command('docs')
    .description('Manage application document checklist');

  cmd
    .command('list')
    .description('Show all required documents with completion status')
    .action(() => runList());

  cmd
    .command('check <id>')
    .description('Mark a document as complete (e.g. docs check d1)')
    .action((id) => runCheck(id));

  cmd
    .command('uncheck <id>')
    .description('Mark a document as incomplete')
    .action((id) => runUncheck(id));

  cmd
    .command('per-program <id>')
    .description('Show document readiness for a specific program')
    .action((id) => runPerProgram(id));

  cmd
    .command('export')
    .description('Export checklist as a Markdown file')
    .action(() => runExport());
}
