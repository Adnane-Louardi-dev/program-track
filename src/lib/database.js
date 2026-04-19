import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');

// ── Canonical file paths ──────────────────────────────────────────────────
export const PATHS = {
  programs:  join(ROOT, 'data/programs.json'),
  profile:   join(ROOT, 'data/profile.json'),
  checklist: join(ROOT, 'data/checklist.json'),
  priorities: join(ROOT, 'data/priorities.json'),
  letters:   join(ROOT, 'output/letters'),
  exports:   join(ROOT, 'output/exports'),
  errorsLog: join(ROOT, 'output/errors.log'),
};

// ── Default checklist (created on first use) ──────────────────────────────
const DEFAULT_CHECKLIST = {
  d1:  { label: "Bachelor's degree certificate (certified copy)", done: false },
  d2:  { label: 'S5 Relevé des notes', done: false },
  d3:  { label: 'S6 Relevé des notes (after graduation)', done: false },
  d4:  { label: 'Full transcript of records', done: false },
  d5:  { label: 'IELTS 7.0+ certificate', done: false },
  d6:  { label: 'German B1 certificate (if needed)', done: false },
  d7:  { label: 'CV / Resume (Europass)', done: false },
  d8:  { label: 'Motivation letters', done: false },
  d9:  { label: 'Recommendation letters (2x)', done: false },
  d10: { label: 'GitHub portfolio document', done: false },
  d11: { label: 'VPD application submitted', done: false },
  d12: { label: 'Uni-Assist fees paid', done: false },
  d13: { label: 'Blocked account proof (€11,208+)', done: false },
  d14: { label: 'Valid passport copy', done: false },
};

// ── Core helpers ──────────────────────────────────────────────────────────

/**
 * Read and parse a JSON file.
 * Returns null (never throws) if the file does not exist or is malformed.
 */
export function readJSON(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write data as pretty-printed JSON.
 * Creates parent directories automatically.
 */
export function writeJSON(filePath, data) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Append a line to a log file (e.g. errors.log).
 * Creates the file if it doesn't exist.
 */
export function appendLog(filePath, message) {
  ensureDir(dirname(filePath));
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  import('fs').then(({ appendFileSync }) => appendFileSync(filePath, line, 'utf-8'));
}

/** Create a directory (and parents) if it doesn't exist. */
export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// ── Domain-specific accessors ─────────────────────────────────────────────

/** Load programs array. Returns [] if not yet initialized. */
export function loadPrograms() {
  return readJSON(PATHS.programs) ?? [];
}

/** Save programs array. */
export function savePrograms(programs) {
  writeJSON(PATHS.programs, programs);
}

/** Load a single program by id. Returns null if not found. */
export function getProgramById(id) {
  const programs = loadPrograms();
  return programs.find((p) => p.id === Number(id)) ?? null;
}

/** Update a single program by id (merges fields). Saves to disk. */
export function updateProgram(id, patch) {
  const programs = loadPrograms();
  const idx = programs.findIndex((p) => p.id === Number(id));
  if (idx === -1) return false;
  programs[idx] = { ...programs[idx], ...patch };
  savePrograms(programs);
  return programs[idx];
}

/** Load profile. Returns null if setup hasn't been run. */
export function loadProfile() {
  return readJSON(PATHS.profile);
}

/** Save profile. */
export function saveProfile(profile) {
  writeJSON(PATHS.profile, profile);
}

/** Load document checklist. Initializes with defaults if missing. */
export function loadChecklist() {
  const existing = readJSON(PATHS.checklist);
  if (existing) return existing;
  writeJSON(PATHS.checklist, DEFAULT_CHECKLIST);
  return { ...DEFAULT_CHECKLIST };
}

/** Save document checklist. */
export function saveChecklist(checklist) {
  writeJSON(PATHS.checklist, checklist);
}

// ── Guards ────────────────────────────────────────────────────────────────

/**
 * Assert programs.json exists and is non-empty.
 * Prints an actionable error and exits if not.
 */
export function requirePrograms() {
  const programs = loadPrograms();
  if (programs.length === 0) {
    console.error('No programs found. Run: node src/index.js import <file>');
    process.exit(1);
  }
  return programs;
}

/**
 * Assert profile.json exists and has required fields.
 * Prints an actionable error and exits if not.
 */
export function requireProfile() {
  const profile = loadProfile();
  const missing = !profile || !profile.name || !profile.projects?.length || !profile.careerGoals;
  if (missing) {
    console.error('Profile incomplete. Run: node src/index.js setup init');
    process.exit(1);
  }
  return profile;
}
