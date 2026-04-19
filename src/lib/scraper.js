/**
 * scraper.js — Fetch a program's page (HTML or PDF), extract admission
 * requirements via Claude, persist the result, and recompute eligibility.
 *
 * Public API:
 *   scrapeProgram(id) → { program, oldScore, newScore, deadlineChanged, status }
 */

import { callClaude } from './anthropic.js';
import { SCRAPE_SYSTEM_PROMPT, buildScrapePrompt } from '../templates/scrapePrompt.js';
import { computeFlags, computeScore } from './eligibility.js';
import { getProgramById, updateProgram, appendLog, PATHS } from './database.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS   = 12_000;
const USER_AGENT       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── Public ────────────────────────────────────────────────────────────────

/**
 * Scrape admission requirements for a single program.
 * @param {number|string} id
 * @returns {Promise<{ program, oldScore, newScore, deadlineChanged, status, message }>}
 */
export async function scrapeProgram(id) {
  const program = getProgramById(id);
  if (!program) throw new Error(`Program ${id} not found`);

  const oldScore = program.priorityScore ?? 0;
  const oldDeadline = program.deadlineWinterParsed ?? null;

  const entry = chooseUrl(program);
  if (!entry) {
    throw new Error('No website or accessLink on this program to scrape from');
  }

  // Step 1 — fetch + extract (with up to one followUrl hop)
  const visited = new Set();
  let url = entry;
  let extracted = null;

  for (let hop = 0; hop < 2; hop++) {
    if (visited.has(url)) break;
    visited.add(url);

    const { text, sourceType } = await fetchAndExtract(url);
    const parsed = await extractWithClaude({ program, url, text });

    if (parsed.status === 'followup' && parsed.followUrl && hop === 0) {
      url = absolutize(parsed.followUrl, url);
      continue;
    }

    extracted = { ...parsed, source: url, sourceType };
    break;
  }

  if (!extracted) {
    throw new Error('Could not extract requirements (too many redirects)');
  }

  // Step 2 — build requirements object
  const requirements = {
    scrapedAt:  new Date().toISOString(),
    source:     extracted.source,
    sourceType: extracted.sourceType,
    status:     extracted.status,
    confidence: extracted.confidence ?? null,
    deadline:   extracted.deadline ?? null,
    language:   extracted.language ?? { english: null, german: null },
    academic:   extracted.academic  ?? [],
    documents:  extracted.documents ?? [],
    other:      extracted.other     ?? [],
  };

  const patch = { requirements };

  // Step 3 — reconcile deadline
  let deadlineChanged = false;
  if (requirements.deadline && requirements.deadline !== oldDeadline) {
    patch.deadlineWinterParsed = requirements.deadline;
    const stamp = new Date().toISOString().slice(0, 10);
    const oldStr = oldDeadline ?? '—';
    const noteLine = `[scraped ${stamp}] Deadline updated ${requirements.deadline} (was ${oldStr})`;
    const existing = program.notes ?? '';
    patch.notes = existing ? `${existing}\n${noteLine}` : noteLine;
    deadlineChanged = true;
  }

  // Step 4 — recompute flags & score on the merged program
  const merged = { ...program, ...patch };
  patch.eligibilityFlags = computeFlags(merged);
  patch.priorityScore    = computeScore({ ...merged, eligibilityFlags: patch.eligibilityFlags });

  const updated = updateProgram(id, patch);

  return {
    program: updated,
    oldScore,
    newScore: updated.priorityScore,
    deadlineChanged,
    status: requirements.status,
    message: requirements.status === 'insufficient'
      ? 'Page did not contain admission requirements'
      : null,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────

function chooseUrl(program) {
  const clean = (v) => (typeof v === 'string' && v.startsWith('http')) ? v : null;
  return clean(program.accessLink) || clean(program.website) || null;
}

async function fetchAndExtract(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.7',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Fetch failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const ct = (res.headers.get('content-type') ?? '').toLowerCase();

  if (ct.includes('application/pdf')) {
    const buf = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buf);
    return { text: truncate(text), sourceType: 'pdf' };
  }

  if (ct.includes('text/html') || ct.includes('application/xhtml') || ct === '') {
    const html = await res.text();
    const text = htmlToText(html);
    return { text: truncate(text), sourceType: 'html' };
  }

  throw new Error(`Unsupported content-type: ${ct}`);
}

async function extractPdfText(buffer) {
  // pdf-parse's index.js does a debug file read at import time — import the
  // inner module directly to avoid that side-effect in production.
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = mod.default || mod;
  const data = await pdfParse(buffer);
  return data.text || '';
}

function htmlToText(html) {
  return html
    // drop head/script/style/noscript blocks entirely
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // block-level elements → newlines
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article)[^>]*>/gi, '\n')
    // strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&[a-z]+;/gi, ' ')
    // collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text) {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + '\n\n[…truncated]';
}

function absolutize(target, base) {
  try { return new URL(target, base).toString(); }
  catch { return target; }
}

async function extractWithClaude({ program, url, text }) {
  const prompt = buildScrapePrompt({
    programName: program.name,
    university:  program.university,
    url,
    text,
  });

  const raw = await callClaude(
    { system: SCRAPE_SYSTEM_PROMPT, prompt, maxTokens: 1500 },
    { programId: program.id, programName: program.name },
  );

  return parseJsonResponse(raw, program);
}

function parseJsonResponse(raw, program) {
  // Strip code fences if model added them despite instructions
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  // Find first { … last } to be robust to stray prose
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) {
    appendLog(PATHS.errorsLog, `[scrape:${program.id}] Non-JSON response: ${cleaned.slice(0, 200)}`);
    throw new Error('Claude returned non-JSON response');
  }

  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (err) {
    appendLog(PATHS.errorsLog, `[scrape:${program.id}] JSON parse failed: ${err.message}`);
    throw new Error('Failed to parse Claude JSON response');
  }
}
