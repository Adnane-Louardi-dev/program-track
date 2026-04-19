/**
 * letterDiff.js
 * Sentence-level diff between two letters.
 * Highlights shared sentences in red (potential copy-paste between letters).
 */

import chalk from 'chalk';

/**
 * Split a letter body into sentences for comparison.
 */
function toSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize a sentence for comparison (lowercase, no punctuation).
 */
function normalize(sentence) {
  return sentence.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Find sentences that appear in both letters (after normalization).
 * Returns a Set of normalized duplicates.
 */
function findDuplicates(sentencesA, sentencesB) {
  const normA = new Set(sentencesA.map(normalize));
  const normB = new Set(sentencesB.map(normalize));
  const dupes = new Set();
  for (const s of normA) {
    if (normB.has(s)) dupes.add(s);
  }
  return dupes;
}

/**
 * Render a letter column for side-by-side display.
 * Highlights duplicate sentences in red.
 * @param {string[]} sentences
 * @param {Set<string>} dupes
 * @param {number} width  — column width in chars
 * @returns {string[]}    — array of wrapped lines
 */
function renderColumn(sentences, dupes, width) {
  const lines = [];
  for (const sentence of sentences) {
    const isDupe = dupes.has(normalize(sentence));
    const words  = sentence.split(' ');
    let   line   = '';

    for (const word of words) {
      if ((line + ' ' + word).trim().length > width) {
        const rendered = isDupe ? chalk.red(line.trim()) : line.trim();
        lines.push(rendered);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line.trim()) {
      const rendered = isDupe ? chalk.red(line.trim()) : line.trim();
      lines.push(rendered);
    }
    lines.push(''); // blank line between sentences
  }
  return lines;
}

/**
 * Strip ANSI codes for length measurement.
 */
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Print a side-by-side comparison of two letter bodies.
 * Shared sentences are highlighted in red.
 * @param {string} bodyA
 * @param {string} bodyB
 * @param {string} labelA
 * @param {string} labelB
 */
export function printComparison(bodyA, bodyB, labelA = 'Letter A', labelB = 'Letter B') {
  const COL_WIDTH  = 52;
  const SEPARATOR  = chalk.dim(' │ ');
  const SEP_RAW    = 3; // length of separator without ANSI

  const sentencesA = toSentences(bodyA);
  const sentencesB = toSentences(bodyB);
  const dupes      = findDuplicates(sentencesA, sentencesB);

  const linesA = renderColumn(sentencesA, dupes, COL_WIDTH);
  const linesB = renderColumn(sentencesB, dupes, COL_WIDTH);

  const maxLines = Math.max(linesA.length, linesB.length);

  // Header
  const headerA = chalk.bold.cyan(labelA.slice(0, COL_WIDTH).padEnd(COL_WIDTH));
  const headerB = chalk.bold.cyan(labelB.slice(0, COL_WIDTH).padEnd(COL_WIDTH));
  const divLine = chalk.dim('─'.repeat(COL_WIDTH) + '─┼─' + '─'.repeat(COL_WIDTH));

  console.log();
  console.log(headerA + SEPARATOR + headerB);
  console.log(divLine);

  for (let i = 0; i < maxLines; i++) {
    const rawA  = linesA[i] ?? '';
    const rawB  = linesB[i] ?? '';
    const padA  = rawA + ' '.repeat(Math.max(0, COL_WIDTH - stripAnsi(rawA).length));
    console.log(padA + SEPARATOR + rawB);
  }

  console.log(divLine);
  console.log();

  // Summary
  if (dupes.size === 0) {
    console.log(chalk.green('  ✓  No duplicate sentences detected between the two letters.'));
  } else {
    console.log(chalk.red(`  ⚠  ${dupes.size} sentence(s) appear in both letters (shown in red).`));
    console.log(chalk.dim('     Consider rephrasing these to avoid repetition across applications.'));
  }

  console.log(chalk.dim(`\n  Letter A: ${sentencesA.length} sentences | Letter B: ${sentencesB.length} sentences`));
  console.log();
}
