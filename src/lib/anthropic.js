/**
 * anthropic.js
 * Thin wrapper around the OpenRouter Chat Completions API (OpenAI-compatible).
 * Kept filename/export name for compatibility with existing callers.
 */

import { appendLog, PATHS } from './database.js';

const ENDPOINT      = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL         = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';
const MAX_RETRIES   = 3;
const RETRY_DELAY   = 5000;
const BATCH_DELAY   = 2000;

function getKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === 'sk-or-your-key-here') {
    console.error('OPENROUTER_API_KEY not set. Add it to .env (get one at https://openrouter.ai/keys)');
    process.exit(1);
  }
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the LLM with retry on overload / rate limits.
 * @param {object} params   — { system, prompt, maxTokens }
 * @param {object} [meta]   — { programId, programName } for error logging
 * @returns {Promise<string>} — raw text response
 */
export async function callClaude({ system, prompt, maxTokens = 1200 }, meta = {}) {
  const key = getKey();
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'https://github.com/local/german-masters-app',
          'X-Title':       'German Masters App',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        const err = new Error(`${res.status} ${bodyText}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('OpenRouter returned no message content');
      }
      return content;
    } catch (err) {
      lastError = err;

      const retryable = err.status === 429 || err.status === 502 || err.status === 503 || err.status === 529 ||
        (err.message ?? '').includes('overloaded');

      if (retryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY * attempt;
        process.stderr.write(`  ⟳  API busy — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})\n`);
        await sleep(delay);
        continue;
      }

      const errMsg = `[program:${meta.programId ?? '?'}] ${meta.programName ?? ''} — ${err.message}`;
      appendLog(PATHS.errorsLog, errMsg);
      throw err;
    }
  }

  throw lastError;
}

/** Delay used between batch API calls. */
export async function batchDelay() {
  await sleep(BATCH_DELAY);
}

export { MODEL };
