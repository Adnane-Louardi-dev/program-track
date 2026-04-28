import chalk from 'chalk';
import Table from 'cli-table3';

export { chalk };

// ── Box drawing ───────────────────────────────────────────────────────────

/**
 * Print a titled box around lines of text.
 * @param {string} title
 * @param {string[]} lines  — pre-formatted strings (chalk OK)
 * @param {{ color?: string }} [opts]
 */
export function printBox(title, lines, { color = 'cyan' } = {}) {
  const c = chalk[color] ?? chalk.cyan;
  const rawLines = lines.map((l) => stripAnsi(l));
  const titleLen = stripAnsi(title).length;
  const maxLen = Math.max(titleLen + 2, ...rawLines.map((l) => l.length + 2));

  const top    = c('╔' + '═'.repeat(maxLen + 2) + '╗');
  const mid    = c('╠' + '═'.repeat(maxLen + 2) + '╣');
  const bottom = c('╚' + '═'.repeat(maxLen + 2) + '╝');

  const pad = (str, raw) => {
    const spaces = maxLen - raw.length;
    return c('║') + '  ' + str + ' '.repeat(spaces) + '  ' + c('║');
  };

  console.log(top);
  console.log(pad(chalk.bold(title), titleLen));
  console.log(mid);
  lines.forEach((line, i) => console.log(pad(line, rawLines[i])));
  console.log(bottom);
}

/**
 * Print a simple single-border section header.
 */
export function printHeader(text) {
  const line = '─'.repeat(stripAnsi(text).length + 4);
  console.log(chalk.cyan(line));
  console.log(chalk.cyan('  ') + chalk.bold(text));
  console.log(chalk.cyan(line));
}

// ── Status badges ─────────────────────────────────────────────────────────

const STATUS_COLOR = {
  'not-yet':  chalk.white,
  'filling':  chalk.yellow,
  'pending':  chalk.cyan,
  'accepted': chalk.green,
  'rejected': chalk.red,
  'missed':   chalk.red.dim,
  'impossible': chalk.gray,
};

export function colorStatus(status) {
  const fn = STATUS_COLOR[status] ?? chalk.white;
  return fn(status.toUpperCase());
}

/** Deadline coloring: red < 14d, yellow < 30d, green otherwise. */
export function colorDeadline(isoDate) {
  if (!isoDate) return chalk.dim('—');
  const days = Math.ceil((new Date(isoDate) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0)  return chalk.red.dim('MISSED');
  if (days < 14) return chalk.red(`${isoDate} (${days}d)`);
  if (days < 30) return chalk.yellow(`${isoDate} (${days}d)`);
  return chalk.green(`${isoDate} (${days}d)`);
}

/** Priority stars: ≥70 = ★★★, ≥40 = ★★☆, else ★☆☆ */
export function priorityStars(score) {
  if (score === null || score === undefined) return chalk.dim('  —  ');
  if (score >= 70) return chalk.green('★★★');
  if (score >= 40) return chalk.yellow('★★☆');
  return chalk.red('★☆☆');
}

// ── Tables ────────────────────────────────────────────────────────────────

/**
 * Create a pre-configured cli-table3 instance.
 * @param {string[]} head  — column headers
 * @param {number[]} [colWidths]
 */
export function makeTable(head, colWidths) {
  return new Table({
    head: head.map((h) => chalk.bold.cyan(h)),
    colWidths,
    wordWrap: true,
    style: { border: ['dim'] },
  });
}

// ── Misc ──────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes for length calculations. */
export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\x1B\[[0-9;]*m/g, '');
}

/** Tick / cross symbols */
export const TICK  = chalk.green('✅');
export const CROSS = chalk.red('❌');
export const WARN  = chalk.yellow('⚠️ ');
export const INFO  = chalk.cyan('ℹ️ ');
