/**
 * deadlineParser.js
 * Converts any deadline string (or Excel serial) into an ISO date string.
 * Always returns YYYY-MM-DD or null — never throws.
 */

const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const YEAR = 2026; // all WS 2026/27 deadlines fall in 2026

// ── Helpers ───────────────────────────────────────────────────────────────

function toISO(day, month, year = YEAR) {
  if (!day || !month) return null;
  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function resolveMonth(str) {
  if (!str) return null;
  const key = str.toLowerCase().trim().slice(0, 3);
  return MONTH_MAP[key] ?? null;
}

/**
 * Parse "DD Mon" or "Mon DD" or "DD.MM" style fragments.
 * Returns { day, month } or null.
 */
function parseFragment(s) {
  s = s.trim();

  // "25.05" or "25.05.2026"
  const dotMatch = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.\d{4})?$/);
  if (dotMatch) {
    return { day: Number(dotMatch[1]), month: Number(dotMatch[2]) };
  }

  // "31 May" or "May 31"
  const wordMatch = s.match(/^(\d{1,2})\s+([A-Za-z]+)$/) ||
                    s.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (wordMatch) {
    const [, a, b] = wordMatch;
    if (/^\d+$/.test(a)) return { day: Number(a), month: resolveMonth(b) };
    return { day: Number(b), month: resolveMonth(a) };
  }

  return null;
}

/**
 * Extract all date fragments from a string, return sorted ISO dates.
 * Returns [] if none found.
 */
function extractAllDates(raw) {
  // Split on common separators: "/", ",", "to", "-" (but not inside dates like "15.05")
  const parts = raw
    .replace(/\bto\b/gi, '|')
    .replace(/[,/]/g, '|')
    .replace(/(?<!\d)-(?!\d)/g, '|')   // dash not between digits
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const dates = [];
  for (const part of parts) {
    const frag = parseFragment(part);
    if (frag && frag.day && frag.month) {
      dates.push(toISO(frag.day, frag.month));
    }
  }
  return dates.filter(Boolean).sort();
}

// ── Excel serial date conversion ─────────────────────────────────────────

function excelSerialToISO(serial) {
  if (typeof serial !== 'number' || serial < 1) return null;
  // Excel epoch: Jan 1, 1900 = serial 1 (with the off-by-two leap year bug)
  const msPerDay = 86400 * 1000;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(excelEpoch.getTime() + serial * msPerDay);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Parse a deadline value from the Excel cell.
 * - If it's a Date object (exceljs parsed it): format directly.
 * - If it's a number: treat as Excel serial.
 * - If it's a string: apply pattern matching.
 *
 * Strategy per CLAUDE.md:
 *   "X to Y"          → take END date (treat as latest possible)
 *   "X/Y" or "X, Y"   → take FIRST (earliest) date
 *   "X - Y"            → take START date
 *   Single date        → that date
 *
 * Returns ISO string (YYYY-MM-DD) or null.
 */
export function parseDeadline(raw) {
  try {
    if (!raw && raw !== 0) return null;

    // exceljs Date object
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) return null;
      const y = raw.getFullYear();
      const m = String(raw.getMonth() + 1).padStart(2, '0');
      const d = String(raw.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // Excel serial number
    if (typeof raw === 'number') {
      return excelSerialToISO(raw);
    }

    const s = String(raw).trim();
    if (!s || s === '-' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'tbd') return null;

    // "X to Y" range → take end date (latest)
    const toMatch = s.match(/^(.+?)\s+to\s+(.+)$/i);
    if (toMatch) {
      const dates = extractAllDates(s);
      return dates[dates.length - 1] ?? null; // last = latest
    }

    // Multiple dates separated by "/" or "," → take first (earliest)
    if (/[/,]/.test(s)) {
      const dates = extractAllDates(s);
      return dates[0] ?? null;
    }

    // "X - Y" range → take start date
    if (/-/.test(s) && !/^\d{1,2}\.\d{1,2}$/.test(s)) {
      const dates = extractAllDates(s);
      return dates[0] ?? null;
    }

    // Single date
    const frag = parseFragment(s);
    if (frag && frag.day && frag.month) return toISO(frag.day, frag.month);

    return null;
  } catch {
    return null;
  }
}
