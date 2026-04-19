/**
 * excel.js
 * Reads german-master-programms.xlsx and returns a clean array of program objects.
 * Handles yellow cell detection, unicode cleanup, and deadline parsing.
 */

import ExcelJS from 'exceljs';
import slugify from 'slugify';
import { parseDeadline } from './deadlineParser.js';
import { computeFlags, computeScore } from './eligibility.js';

// ── Column mapping ────────────────────────────────────────────────────────
// Maps header names (lowercased, trimmed) → field names in program object.
const COLUMN_MAP = {
  'status':              'statusRaw',
  'name':                'name',
  'university':          'university',
  'university name':     'university',
  'website':             'website',
  'deadline winter':     'deadlineWinter',
  'deadline summer':     'deadlineSummer',
  'duration':            'duration',
  'duration(y)':         'duration',
  'semesters':           'semesters',
  'city':                'city',
  'city name':           'city',
  'degree':              'degree',
  'language':            'language',
  'tuition':             'tuition',
  'tuition fee':         'tuition',
  'ranking1':            'ranking1',
  'ranking 1':           'ranking1',
  'ranking2':            'ranking2',
  'ranking 2':           'ranking2',
  'type of assessment':  'assessment',
  'access link':         'accessLink',
  'access_link':         'accessLink',
  'description':         'description',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Cyrillic lookalike → Latin replacement map.
 * These characters are visually identical to Latin letters but have different code points.
 */
const CYRILLIC_TO_LATIN = {
  '\u0410': 'A', '\u0430': 'a',  // А а
  '\u0412': 'B', '\u0432': 'b',  // В в  (approximate)
  '\u0421': 'C', '\u0441': 'c',  // С с
  '\u0415': 'E', '\u0435': 'e',  // Е е
  '\u0417': '3',                  // З
  '\u041D': 'H',                  // Н
  '\u0406': 'I', '\u0456': 'i',  // І і
  '\u0408': 'J',                  // Ј
  '\u041A': 'K',                  // К
  '\u041C': 'M',                  // М
  '\u041E': 'O', '\u043E': 'o',  // О о
  '\u0420': 'R', '\u0440': 'r',  // Р р
  '\u0422': 'T',                  // Т
  '\u0425': 'X', '\u0445': 'x',  // Х х
  '\u0443': 'y',                  // у  (looks like y)
  '\u0412': 'B',                  // В
  '\u0395': 'E',                  // Greek Ε
  '\u039F': 'O', '\u03BF': 'o',  // Greek Ο ο
  '\u0391': 'A', '\u03B1': 'a',  // Greek Α α (approximate)
};

const CYRILLIC_RE = new RegExp(Object.keys(CYRILLIC_TO_LATIN).join('|'), 'g');

/** Replace Cyrillic/Greek lookalike characters with Latin equivalents. */
function cleanText(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(CYRILLIC_RE, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract string value from a cell, handling hyperlinks and rich text. */
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';

  // Hyperlink object: { text, hyperlink } or { text: { richText: [...] }, hyperlink }
  if (typeof v === 'object' && v.hyperlink) {
    return v.hyperlink; // return the actual URL
  }
  if (typeof v === 'object' && v.richText) {
    return cleanText(v.richText.map((r) => r.text).join(''));
  }
  if (v instanceof Date) return v; // pass Date objects through for deadline parser
  return cleanText(String(v));
}

/** Extract URL from a cell (website / access_link columns). */
function cellUrl(cell) {
  const v = cell?.value;
  if (!v) return '';
  if (typeof v === 'object' && v.hyperlink) return String(v.hyperlink).trim();
  if (typeof v === 'object' && v.text) {
    // Sometimes text is a richText array
    const text = typeof v.text === 'object' && v.text.richText
      ? v.text.richText.map((r) => r.text).join('')
      : String(v.text);
    return text.trim();
  }
  return cleanText(String(v));
}

/**
 * Detect yellow highlight on a cell.
 * Yellow = fgColor ARGB starts with 'FFFF' (after alpha).
 */
function isYellowCell(cell) {
  const argb = cell?.fill?.fgColor?.argb;
  if (!argb) return false;
  return argb.toUpperCase().startsWith('FFFF') && argb.length === 8;
}

/**
 * Map a raw status string from the sheet to a valid internal status.
 */
function normalizeStatus(raw) {
  if (!raw) return 'not-yet';
  const s = String(raw).toLowerCase().trim();
  if (s.includes('fill')) return 'filling';
  if (s.includes('pend')) return 'pending';
  if (s.includes('accept')) return 'accepted';
  if (s.includes('reject')) return 'rejected';
  if (s.includes('miss')) return 'missed';
  return 'not-yet';
}

// ── Main parser ───────────────────────────────────────────────────────────

/**
 * Parse the Excel file and return an array of program objects.
 * @param {string} filePath — absolute path to the .xlsx file
 * @returns {Promise<object[]>}
 */
export async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheets found in the Excel file.');

  // ── Detect header row ──────────────────────────────────────────────────
  let headerRowNum = 1;
  let headerMap = {};   // colNumber → fieldName

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const values = row.values.slice(1); // exceljs is 1-indexed
    const lower = values.map((v) => cleanText(String(v ?? '')).toLowerCase());
    // Detect header row by checking for known column names
    const matches = lower.filter((h) => COLUMN_MAP[h] !== undefined).length;
    if (matches >= 3 && rowNum <= 5) {
      headerRowNum = rowNum;
      lower.forEach((h, i) => {
        if (COLUMN_MAP[h]) headerMap[i + 1] = COLUMN_MAP[h];
      });
    }
  });

  if (Object.keys(headerMap).length === 0) {
    // Fallback: assume positional columns per plan spec
    const positional = [
      'statusRaw', 'name', 'university', 'website',
      'deadlineWinter', 'deadlineSummer', 'duration', 'semesters',
      'city', 'degree', 'language', 'tuition',
      'ranking1', 'ranking2', 'assessment', 'accessLink', 'description',
    ];
    positional.forEach((field, i) => { headerMap[i + 1] = field; });
  }

  // ── Parse data rows ────────────────────────────────────────────────────
  const programs = [];
  let id = 1;

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return; // skip header

    // Skip completely empty rows
    const allEmpty = row.values.slice(1).every((v) => v === null || v === undefined || v === '');
    if (allEmpty) return;

    // Build raw record from mapped columns
    const raw = {};
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const field = headerMap[colNum];
      if (!field) return;
      if (field === 'deadlineWinter' || field === 'deadlineSummer') {
        raw[field] = cell.value; // preserve Date objects for deadline parser
      } else if (field === 'website' || field === 'accessLink') {
        raw[field] = cellUrl(cell);
      } else {
        raw[field] = cellText(cell);
      }
    });

    // Skip if no program name
    if (!raw.name || String(raw.name).trim() === '') return;

    // Detect Uni-Assist (yellow highlight on first cell of row)
    const firstCell = row.getCell(1);
    const uniAssist = isYellowCell(firstCell);

    // Parse deadlines
    const deadlineWinterParsed = parseDeadline(raw.deadlineWinter);
    const deadlineSummerParsed = parseDeadline(raw.deadlineSummer);

    const program = {
      id,
      name: cleanText(raw.name),
      university: cleanText(raw.university ?? ''),
      website: cleanText(raw.website ?? ''),
      deadlineWinter: cleanText(String(raw.deadlineWinter ?? '')),
      deadlineWinterParsed,
      deadlineSummer: cleanText(String(raw.deadlineSummer ?? '')),
      deadlineSummerParsed,
      duration: cleanText(raw.duration ?? ''),
      semesters: cleanText(raw.semesters ?? ''),
      city: cleanText(raw.city ?? ''),
      degree: cleanText(raw.degree ?? ''),
      language: cleanText(raw.language ?? ''),
      tuition: cleanText(raw.tuition ?? ''),
      ranking1: cleanText(raw.ranking1 ?? ''),
      ranking2: cleanText(raw.ranking2 ?? ''),
      assessment: cleanText(raw.assessment ?? ''),
      accessLink: cleanText(raw.accessLink ?? ''),
      description: cleanText(raw.description ?? ''),
      uniAssist,
      status: normalizeStatus(raw.statusRaw),
      notes: '',
      appliedDate: null,
      documentsSubmitted: [],
      motivationLetterGenerated: false,
      motivationLetterPath: null,
      motivationLetterWordCount: null,
      priorityScore: null,
      eligibilityFlags: [],
      letterVersions: [],
    };

    // Compute eligibility flags and score immediately
    program.eligibilityFlags = computeFlags(program);
    program.priorityScore = computeScore(program);

    programs.push(program);
    id++;
  });

  return programs;
}

/**
 * Merge a freshly parsed programs array with an existing one,
 * preserving manually-set fields on existing records (matched by id).
 */
export function mergePrograms(existing, fresh) {
  const PRESERVE = [
    'status', 'notes', 'appliedDate', 'documentsSubmitted',
    'motivationLetterGenerated', 'motivationLetterPath',
    'motivationLetterWordCount', 'letterVersions',
  ];

  const existingMap = new Map(existing.map((p) => [p.id, p]));

  return fresh.map((p) => {
    const old = existingMap.get(p.id);
    if (!old) return p;
    const preserved = {};
    for (const key of PRESERVE) {
      if (old[key] !== undefined) preserved[key] = old[key];
    }
    return { ...p, ...preserved };
  });
}
