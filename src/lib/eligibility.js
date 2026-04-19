/**
 * eligibility.js
 * Computes eligibility flags and priority score (0–100) for a program.
 * Called during import and by `rank score`.
 */

// ── Flag detection ────────────────────────────────────────────────────────

const ECTS_GAP_PATTERNS = [
  /\b2[1-9]\d\s*ects\b/i,
  /\bbachelor.{0,20}2[1-9]\d\s*ects\b/i,
  /\b210\b.*\bects\b/i,
  /\b240\b.*\bects\b/i,
  /mindestens\s*2[1-9]\d/i,
  /at\s*least\s*2[1-9]\d\s*ects/i,
];

const GERMAN_REQUIRED_PATTERNS = [
  /\bdeutschkenntnisse\b/i,
  /\bnur\s+auf\s+deutsch\b/i,
  /\bgerman\s+c1\b/i,
  /\bdeutsch\s+c1\b/i,
  /\bc1\s+deutsch\b/i,
  /\bsprache.*deutsch\b/i,
  /\bunterrricht.*deutsch\b/i,
  /\blehrsprache.*deutsch\b/i,
];

const GPA_RISK_PATTERNS = [
  /\bnumerus\s+clausus\b/i,
  /\bnc\b/i,
  /\bcompetitive\s+admission\b/i,
  /\bgpa\s+(above|minimum|cutoff|of)\s+[12]\.\d/i,
  /\bmindestnote\b/i,
  /\bdurchschnittsnote\b/i,
];

/**
 * Compute eligibility flags for a program.
 * @param {object} program — raw program record
 * @returns {string[]} — array of flag strings
 */
export function computeFlags(program) {
  const flags = [];
  const searchText = [
    program.description ?? '',
    program.notes ?? '',
    program.assessment ?? '',
  ].join(' ');

  // ECTS gap
  if (ECTS_GAP_PATTERNS.some((re) => re.test(searchText))) {
    flags.push('ECTS_GAP');
  }

  // German required — also check language field directly
  const langIsGerman =
    /^deutsch/i.test(program.language ?? '') ||
    /^german$/i.test(program.language ?? '');
  if (langIsGerman || GERMAN_REQUIRED_PATTERNS.some((re) => re.test(searchText))) {
    flags.push('GERMAN_REQUIRED');
  }

  // Deadline passed
  if (program.deadlineWinterParsed) {
    const dl = new Date(program.deadlineWinterParsed);
    if (dl < new Date()) flags.push('DEADLINE_PASSED');
  }

  // GPA risk
  if (GPA_RISK_PATTERNS.some((re) => re.test(searchText))) {
    flags.push('GPA_RISK');
  }

  // Strong fit — English, no ECTS gap, no German required, deadline not passed
  const isEnglish = /english/i.test(program.language ?? '');
  if (
    isEnglish &&
    !flags.includes('ECTS_GAP') &&
    !flags.includes('GERMAN_REQUIRED') &&
    !flags.includes('DEADLINE_PASSED')
  ) {
    flags.push('STRONG_FIT');
  }

  return flags;
}

// ── Priority scoring ──────────────────────────────────────────────────────

/**
 * Compute a priority score (0–100) for a program.
 * Higher = better fit for the applicant profile.
 */
export function computeScore(program) {
  let score = 0;
  const flags = program.eligibilityFlags ?? computeFlags(program);

  // +20 English program
  if (/english/i.test(program.language ?? '')) score += 20;

  // +25 ECTS ≥ 180 acceptable (no ECTS_GAP flag)
  if (!flags.includes('ECTS_GAP')) score += 25;

  // +20 GPA match — no GPA risk flag
  if (!flags.includes('GPA_RISK')) score += 20;

  // +15 Deadline not missed
  if (!flags.includes('DEADLINE_PASSED')) score += 15;

  // +5 Tuition-free
  if (/free|kostenlos|keine\s*geb/i.test(program.tuition ?? '')) score += 5;

  // +10 Ranking bonus (any ranking info present)
  if (program.ranking1 || program.ranking2) score += 10;

  // -5 Uni-Assist complexity
  if (program.uniAssist) score -= 5;

  // -20 German required
  if (flags.includes('GERMAN_REQUIRED')) score -= 20;

  return Math.max(0, Math.min(100, score));
}
