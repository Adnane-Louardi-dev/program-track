import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import slugify from 'slugify';
import {
  loadPrograms, requirePrograms, requireProfile,
  updateProgram, getProgramById, PATHS, ensureDir, appendLog,
} from '../lib/database.js';
import {
  printHeader, makeTable, colorDeadline, priorityStars,
  TICK, CROSS, WARN,
} from '../lib/formatter.js';
import { callClaude, batchDelay, MODEL } from '../lib/anthropic.js';
import { printComparison } from '../lib/letterDiff.js';
import {
  LETTER_SYSTEM_PROMPT,
  buildLetterPrompt,
  buildRefinePrompt,
  buildScorePrompt,
} from '../templates/letterPrompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../../');

const VALID_STYLES = ['formal', 'personal', 'academic'];

// ── File helpers ──────────────────────────────────────────────────────────

function programSlug(program) {
  const opts = { lower: true, strict: true };
  const uni  = slugify(program.university || 'unknown', opts).slice(0, 24);
  const name = slugify(program.name       || 'program',  opts).slice(0, 24);
  return `${uni}_${name}`;
}

function letterPath(program, version) {
  ensureDir(PATHS.letters);
  return join(PATHS.letters, `${programSlug(program)}_v${version}.md`);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildFrontmatter(program, style, wordCount, version) {
  return [
    '---',
    `program: "${program.name}"`,
    `university: "${program.university}"`,
    `city: "${program.city || ''}"`,
    `generatedAt: "${new Date().toISOString()}"`,
    `style: ${style}`,
    `wordCount: ${wordCount}`,
    `model: ${MODEL}`,
    `version: ${version}`,
    '---',
    '',
  ].join('\n');
}

function readLetterBody(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  // Strip YAML frontmatter
  if (raw.startsWith('---')) {
    const end = raw.indexOf('---', 3);
    if (end !== -1) return raw.slice(end + 3).trim();
  }
  return raw.trim();
}

// ── letter generate ───────────────────────────────────────────────────────

async function runGenerate(id, opts) {
  const profile  = requireProfile();
  const programs = requirePrograms();
  const program  = programs.find((p) => p.id === Number(id));

  if (!program) {
    console.error(chalk.red(`Program ID ${id} not found.`));
    process.exit(1);
  }

  const style = VALID_STYLES.includes(opts.style) ? opts.style : 'formal';

  // Check existing letter
  if (program.motivationLetterGenerated && !opts.force && !opts.dryRun) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: chalk.yellow(`A letter already exists for [${id}] ${program.name}. Generate a new version?`),
      default: true,
    }]);
    if (!overwrite) {
      console.log(chalk.dim('  Aborted.\n'));
      return null;
    }
  }

  const prompt = buildLetterPrompt(profile, program, style);

  // Dry run — just print the prompt
  if (opts.dryRun) {
    console.log();
    printHeader(`Dry Run — Prompt for [${id}] ${program.name}`);
    console.log(chalk.dim('\n── SYSTEM ──────────────────────────────\n'));
    console.log(LETTER_SYSTEM_PROMPT);
    console.log(chalk.dim('\n── USER ────────────────────────────────\n'));
    console.log(prompt);
    console.log();
    return null;
  }

  // Call API
  const spinner = ora(`Generating letter for ${chalk.bold(program.name)} — ${program.university} …`).start();
  let body;
  try {
    body = await callClaude(
      { system: LETTER_SYSTEM_PROMPT, prompt, maxTokens: 1200 },
      { programId: program.id, programName: program.name },
    );
    spinner.succeed('Letter generated');
  } catch (err) {
    spinner.fail(`API error: ${err.message}`);
    return null;
  }

  // Post-process
  const wordCount = countWords(body);
  if (wordCount < 400 || wordCount > 650) {
    console.log(chalk.yellow(`  ${WARN} Word count: ${wordCount} (target: 450–550)`));
  } else {
    console.log(chalk.green(`  ✓  Word count: ${wordCount}`));
  }

  // Versioning
  const existing = program.letterVersions ?? [];
  const version  = existing.length + 1;
  const outPath  = opts.output ?? letterPath(program, version);

  // Write file
  const content = buildFrontmatter(program, style, wordCount, version) + body;
  writeFileSync(outPath, content, 'utf-8');

  // Update program record
  const versionEntry = {
    version,
    path: outPath,
    generatedAt: new Date().toISOString(),
    wordCount,
    style,
  };

  updateProgram(program.id, {
    motivationLetterGenerated: true,
    motivationLetterPath: outPath,
    motivationLetterWordCount: wordCount,
    letterVersions: [...existing, versionEntry],
  });

  console.log(`  ${TICK}  Saved → ${chalk.cyan(outPath)}`);
  console.log(chalk.dim(`       Version ${version}  |  Style: ${style}  |  ${wordCount} words\n`));

  return { body, wordCount, outPath, version };
}

// ── letter batch ──────────────────────────────────────────────────────────

async function runBatch(opts) {
  requireProfile();
  const programs = requirePrograms();

  const deadlineWithin = opts.deadlineWithin ? Number(opts.deadlineWithin) : null;
  const limit          = Number(opts.limit ?? 5);
  const priorityFilter = opts.priority?.toLowerCase();
  const style          = VALID_STYLES.includes(opts.style) ? opts.style : 'formal';
  const skipExisting   = !opts.force;

  const today = new Date();

  let pool = programs
    .filter((p) => {
      if (['accepted', 'rejected', 'missed'].includes(p.status)) return false;
      if (skipExisting && p.motivationLetterGenerated) return false;
      if (!p.deadlineWinterParsed) return false;
      const dl = new Date(p.deadlineWinterParsed);
      if (dl < today) return false; // skip overdue
      if (deadlineWithin !== null) {
        const days = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
        if (days > deadlineWithin) return false;
      }
      return true;
    });

  // Priority filter
  if (priorityFilter === 'high') {
    pool = pool.filter((p) => (p.priorityScore ?? 0) >= 70);
  } else if (priorityFilter === 'medium') {
    pool = pool.filter((p) => (p.priorityScore ?? 0) >= 40 && (p.priorityScore ?? 0) < 70);
  }

  // Sort by deadline ascending (most urgent first)
  pool.sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
  pool = pool.slice(0, limit);

  if (pool.length === 0) {
    console.log(chalk.yellow('\n  No programs match the batch criteria.\n'));
    console.log(chalk.dim('  Try: letter batch --deadline-within=60 --limit=10'));
    return;
  }

  console.log();
  console.log(chalk.bold(`  Generating ${pool.length} letter(s) — ${style} style`));
  if (deadlineWithin) console.log(chalk.dim(`  Filter: due within ${deadlineWithin} days`));
  if (priorityFilter) console.log(chalk.dim(`  Filter: priority = ${priorityFilter}`));
  console.log();

  let success = 0;
  let failed  = 0;

  for (let i = 0; i < pool.length; i++) {
    const program = pool[i];
    const spinner = ora({
      text: `[${i + 1}/${pool.length}] ${program.name} — ${program.university}`,
      indent: 2,
    }).start();

    try {
      const profile = requireProfile();
      const prompt  = buildLetterPrompt(profile, program, style);
      const body    = await callClaude(
        { system: LETTER_SYSTEM_PROMPT, prompt, maxTokens: 1200 },
        { programId: program.id, programName: program.name },
      );

      const wordCount   = countWords(body);
      const existing    = program.letterVersions ?? [];
      const version     = existing.length + 1;
      const outPath     = letterPath(program, version);
      const fileContent = buildFrontmatter(program, style, wordCount, version) + body;

      writeFileSync(outPath, fileContent, 'utf-8');
      updateProgram(program.id, {
        motivationLetterGenerated: true,
        motivationLetterPath: outPath,
        motivationLetterWordCount: wordCount,
        letterVersions: [...existing, { version, path: outPath, generatedAt: new Date().toISOString(), wordCount, style }],
      });

      const warnWords = wordCount < 400 || wordCount > 650 ? chalk.yellow(` ⚠ ${wordCount}w`) : chalk.green(` ${wordCount}w`);
      spinner.succeed(`[${i + 1}/${pool.length}] ${program.name}${warnWords}`);
      success++;
    } catch (err) {
      spinner.fail(`[${i + 1}/${pool.length}] ${program.name} — ${chalk.red(err.message)}`);
      appendLog(PATHS.errorsLog, `batch[${program.id}] ${program.name}: ${err.message}`);
      failed++;
    }

    if (i < pool.length - 1) await batchDelay();
  }

  console.log();
  console.log(`  ${TICK}  Done: ${chalk.green(success)} generated, ${failed > 0 ? chalk.red(failed + ' failed') : chalk.dim('0 failed')}`);
  if (failed > 0) console.log(chalk.dim(`  Errors logged to: output/errors.log`));
  console.log(chalk.dim(`\n  Next: node src/index.js letter list --generated`));
  console.log();
}

// ── letter list ───────────────────────────────────────────────────────────

async function runList(opts) {
  const programs = requirePrograms();

  let list = [...programs];
  if (opts.missing)   list = list.filter((p) => !p.motivationLetterGenerated);
  if (opts.generated) list = list.filter((p) => p.motivationLetterGenerated);

  list.sort((a, b) => {
    if (!a.deadlineWinterParsed) return 1;
    if (!b.deadlineWinterParsed) return -1;
    return a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed);
  });

  if (list.length === 0) {
    console.log(chalk.yellow('\n  No programs match.\n'));
    return;
  }

  const generated = programs.filter((p) => p.motivationLetterGenerated).length;
  console.log();
  printHeader(`Letter Status  —  ${generated}/${programs.length} generated`);
  console.log();

  const table = makeTable(
    ['ID', '★', 'Program', 'University', 'Deadline', 'Letter', 'Words', 'Ver'],
    [5, 5, 28, 26, 13, 10, 7, 5],
  );

  list.forEach((p) => {
    const letterIcon = p.motivationLetterGenerated
      ? chalk.green('✉ yes')
      : chalk.red('✖ no');
    const words = p.motivationLetterWordCount
      ? (p.motivationLetterWordCount < 400 || p.motivationLetterWordCount > 650
        ? chalk.yellow(String(p.motivationLetterWordCount))
        : chalk.green(String(p.motivationLetterWordCount)))
      : chalk.dim('—');
    const versions = p.letterVersions?.length
      ? chalk.cyan(String(p.letterVersions.length))
      : chalk.dim('—');

    table.push([
      chalk.dim(String(p.id)),
      priorityStars(p.priorityScore),
      p.name.slice(0, 26),
      p.university.slice(0, 24),
      colorDeadline(p.deadlineWinterParsed),
      letterIcon,
      words,
      versions,
    ]);
  });

  console.log(table.toString());
  console.log(chalk.dim(`\n  ${list.length} programs shown\n`));
}

// ── letter preview ────────────────────────────────────────────────────────

async function runPreview(id) {
  const program = getProgramById(id);
  if (!program) {
    console.error(chalk.red(`Program ID ${id} not found.`));
    process.exit(1);
  }

  if (!program.motivationLetterPath || !existsSync(program.motivationLetterPath)) {
    console.log(chalk.yellow(`\n  No letter found for [${id}] ${program.name}.`));
    console.log(chalk.dim(`  Run: node src/index.js letter generate ${id}\n`));
    return;
  }

  const raw  = readFileSync(program.motivationLetterPath, 'utf-8');
  const body = readLetterBody(program.motivationLetterPath);
  const meta = program.letterVersions?.at(-1) ?? {};

  console.log();
  // Metadata box
  console.log(chalk.cyan('┌' + '─'.repeat(60) + '┐'));
  console.log(chalk.cyan('│') + chalk.bold(` [${program.id}] ${program.name}`.slice(0, 59).padEnd(59)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.dim(` ${program.university}`.slice(0, 59).padEnd(59)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.dim(` Version ${meta.version ?? 1}  |  ${meta.style ?? 'formal'}  |  ${meta.wordCount ?? '?'} words  |  ${(meta.generatedAt ?? '').slice(0, 10)}`.padEnd(59)) + chalk.cyan('│'));
  console.log(chalk.cyan('└' + '─'.repeat(60) + '┘'));
  console.log();

  // Letter body — wrap at 72 chars
  const words = body.split(/\s+/);
  let   line  = '';
  for (const word of words) {
    if (word === '' && line === '') {
      console.log();
      continue;
    }
    if ((line + ' ' + word).trim().length > 72) {
      console.log('  ' + line.trim());
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line.trim()) console.log('  ' + line.trim());

  console.log();
  console.log(chalk.dim(`  File: ${program.motivationLetterPath}`));
  console.log();
}

// ── letter refine ─────────────────────────────────────────────────────────

async function runRefine(id, opts) {
  const feedback = opts.feedback;
  if (!feedback) {
    console.error(chalk.red('--feedback is required. Example: --feedback="Make paragraph 2 more specific"'));
    process.exit(1);
  }

  const program = getProgramById(id);
  if (!program) { console.error(chalk.red(`Program ID ${id} not found.`)); process.exit(1); }

  if (!program.motivationLetterPath || !existsSync(program.motivationLetterPath)) {
    console.log(chalk.yellow(`No letter found for [${id}]. Generate one first.`));
    process.exit(1);
  }

  const currentBody    = readLetterBody(program.motivationLetterPath);
  const currentVersion = program.letterVersions?.length ?? 1;
  const newVersion     = currentVersion + 1;

  const spinner = ora(`Refining letter (v${currentVersion} → v${newVersion}) …`).start();
  let newBody;
  try {
    const prompt = buildRefinePrompt(currentBody, program, feedback, currentVersion);
    newBody = await callClaude(
      { system: LETTER_SYSTEM_PROMPT, prompt, maxTokens: 1200 },
      { programId: program.id, programName: program.name },
    );
    spinner.succeed(`Refined to v${newVersion}`);
  } catch (err) {
    spinner.fail(`API error: ${err.message}`);
    return;
  }

  const wordCount = countWords(newBody);
  const style     = program.letterVersions?.at(-1)?.style ?? 'formal';
  const outPath   = letterPath(program, newVersion);
  const content   = buildFrontmatter(program, style, wordCount, newVersion) + newBody;

  writeFileSync(outPath, content, 'utf-8');

  const existing = program.letterVersions ?? [];
  updateProgram(program.id, {
    motivationLetterPath: outPath,
    motivationLetterWordCount: wordCount,
    letterVersions: [...existing, {
      version: newVersion, path: outPath,
      generatedAt: new Date().toISOString(), wordCount, style,
    }],
  });

  console.log(`  ${TICK}  Saved v${newVersion} → ${chalk.cyan(outPath)}  (${wordCount} words)\n`);

  // Show diff between old and new
  console.log(chalk.bold('  Changes (red = shared sentences, may indicate unchanged sections):'));
  const labelA = `v${currentVersion} — original`;
  const labelB = `v${newVersion} — refined`;
  printComparison(currentBody, newBody, labelA, labelB);
}

// ── letter score ──────────────────────────────────────────────────────────

async function runScore(id) {
  const program = getProgramById(id);
  if (!program) { console.error(chalk.red(`Program ID ${id} not found.`)); process.exit(1); }

  if (!program.motivationLetterPath || !existsSync(program.motivationLetterPath)) {
    console.log(chalk.yellow(`\n  No letter found for [${id}]. Generate one first.\n`)); return;
  }

  const body    = readLetterBody(program.motivationLetterPath);
  const prompt  = buildScorePrompt(body, program);

  const spinner = ora('Scoring letter with Claude …').start();
  let raw;
  try {
    raw = await callClaude(
      { system: 'You are a graduate admissions expert. Respond only with valid JSON.', prompt, maxTokens: 600 },
      { programId: program.id },
    );
    spinner.succeed('Scored');
  } catch (err) {
    spinner.fail(`API error: ${err.message}`); return;
  }

  // Parse JSON — strip any markdown fences
  let result;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    console.error(chalk.red('  Failed to parse score response. Raw output:'));
    console.log(raw);
    return;
  }

  const { scores, ectsAddressed, suggestions, overallComment } = result;
  const stars = (n) => chalk.yellow('★'.repeat(n)) + chalk.dim('☆'.repeat(5 - n));

  console.log();
  console.log(chalk.cyan('┌' + '─'.repeat(58) + '┐'));
  console.log(chalk.cyan('│') + chalk.bold(` Letter Quality Report`).padEnd(58) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + chalk.dim(` [${program.id}] ${program.name} — ${program.university}`.slice(0, 57).padEnd(57)) + chalk.cyan('│'));
  console.log(chalk.cyan('├' + '─'.repeat(58) + '┤'));

  const row = (label, scoreObj) => {
    const s   = scoreObj?.score ?? 0;
    const txt = `${label.padEnd(28)} ${stars(s)}  (${s}/5)`;
    console.log(chalk.cyan('│') + ' ' + txt.padEnd(57) + chalk.cyan('│'));
    if (scoreObj?.comment) {
      const cmt = `  ${chalk.dim(scoreObj.comment)}`.slice(0, 57);
      console.log(chalk.cyan('│') + cmt.padEnd(57) + chalk.cyan('│'));
    }
  };

  row('Relevance to program:', scores?.relevance);
  row('Specificity:',         scores?.specificity);
  row('Authenticity:',        scores?.authenticity);
  row('Structure:',           scores?.structure);

  const wc     = scores?.wordCount;
  const wcLine = `Word count: ${wc?.count ?? '?'}  ${wc?.compliant ? chalk.green('✓') : chalk.red('✗')}`;
  console.log(chalk.cyan('│') + ` ${wcLine}`.padEnd(57) + chalk.cyan('│'));
  if (wc?.comment) {
    console.log(chalk.cyan('│') + chalk.dim(`  ${wc.comment}`).slice(0, 57).padEnd(57) + chalk.cyan('│'));
  }

  const ectsLine = `ECTS gap addressed: ${ectsAddressed ? chalk.green('✅') : chalk.dim('n/a')}`;
  console.log(chalk.cyan('│') + ` ${ectsLine}`.padEnd(68) + chalk.cyan('│'));

  console.log(chalk.cyan('├' + '─'.repeat(58) + '┤'));

  if (suggestions?.length) {
    console.log(chalk.cyan('│') + chalk.bold(' Suggestions:').padEnd(58) + chalk.cyan('│'));
    suggestions.forEach((s) => {
      const wrapped = `  • ${s}`;
      for (let i = 0; i < wrapped.length; i += 56) {
        console.log(chalk.cyan('│') + chalk.dim(wrapped.slice(i, i + 56)).padEnd(57) + chalk.cyan('│'));
      }
    });
  }

  if (overallComment) {
    console.log(chalk.cyan('├' + '─'.repeat(58) + '┤'));
    const lines = overallComment.match(/.{1,55}/g) ?? [];
    lines.forEach((l) => {
      console.log(chalk.cyan('│') + (' ' + l).padEnd(58) + chalk.cyan('│'));
    });
  }

  console.log(chalk.cyan('└' + '─'.repeat(58) + '┘'));
  console.log();
}

// ── letter compare ────────────────────────────────────────────────────────

async function runCompare(id1, id2) {
  const p1 = getProgramById(id1);
  const p2 = getProgramById(id2);

  if (!p1) { console.error(chalk.red(`Program ID ${id1} not found.`)); process.exit(1); }
  if (!p2) { console.error(chalk.red(`Program ID ${id2} not found.`)); process.exit(1); }

  const body1 = p1.motivationLetterPath && existsSync(p1.motivationLetterPath)
    ? readLetterBody(p1.motivationLetterPath) : null;
  const body2 = p2.motivationLetterPath && existsSync(p2.motivationLetterPath)
    ? readLetterBody(p2.motivationLetterPath) : null;

  if (!body1) {
    console.log(chalk.yellow(`No letter for [${id1}] ${p1.name}. Generate it first.`)); return;
  }
  if (!body2) {
    console.log(chalk.yellow(`No letter for [${id2}] ${p2.name}. Generate it first.`)); return;
  }

  const label1 = `[${id1}] ${p1.name.slice(0, 22)}`;
  const label2 = `[${id2}] ${p2.name.slice(0, 22)}`;
  printComparison(body1, body2, label1, label2);
}

// ── Register ──────────────────────────────────────────────────────────────

export function registerLetter(program) {
  const cmd = program
    .command('letter')
    .description('Generate and manage motivation letters via Claude API');

  cmd
    .command('generate <id>')
    .description('Generate a motivation letter for a program')
    .option('--style <style>', `Letter style: formal (default) | personal | academic`, 'formal')
    .option('--output <path>', 'Custom output path for the letter file')
    .option('--dry-run', 'Print the prompt without calling the API')
    .option('-f, --force', 'Overwrite existing letter without prompting')
    .action((id, opts) => runGenerate(id, opts));

  cmd
    .command('batch')
    .description('Generate letters for multiple programs')
    .option('--deadline-within <days>', 'Only programs with deadline within N days')
    .option('--limit <n>', 'Max number of letters to generate (default: 5)', '5')
    .option('--priority <level>', 'Filter by priority: high | medium')
    .option('--style <style>', 'Letter style: formal (default) | personal | academic', 'formal')
    .option('-f, --force', 'Re-generate even if letter already exists')
    .action((opts) => runBatch(opts));

  cmd
    .command('list')
    .description('Table of letter status for all programs')
    .option('--missing', 'Show only programs without a letter')
    .option('--generated', 'Show only programs with a letter')
    .action((opts) => runList(opts));

  cmd
    .command('preview <id>')
    .description('Display a letter in the terminal')
    .action((id) => runPreview(id));

  cmd
    .command('refine <id>')
    .description('Improve an existing letter based on feedback')
    .requiredOption('--feedback <text>', 'Instructions for how to improve the letter')
    .action((id, opts) => runRefine(id, opts));

  cmd
    .command('score <id>')
    .description('Have Claude evaluate the quality of a letter (1–5 per dimension)')
    .action((id) => runScore(id));

  cmd
    .command('compare <id1> <id2>')
    .description('Side-by-side diff of two letters to detect reused phrasing')
    .action((id1, id2) => runCompare(id1, id2));
}
