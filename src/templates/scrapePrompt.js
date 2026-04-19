/**
 * scrapePrompt.js — builds the Claude prompt for extracting admission
 * requirements from a fetched university program page.
 */

export const SCRAPE_SYSTEM_PROMPT = `You are an admissions-requirements extractor for German master's programs. You receive raw text scraped from a university program web page or PDF and return a single JSON object describing admission requirements for Winter Semester 2026/27.

You must:
- Return ONLY a JSON object — no prose, no markdown fences, no explanation.
- Be conservative: do not invent facts. If a field isn't stated on the page, set it to null or [].
- Normalize deadlines to YYYY-MM-DD. If multiple dates are listed, pick the application deadline for Winter Semester (intake October/Wintersemester). If only a summer deadline is shown, set deadline to null.
- If the provided page is clearly a landing/overview page that POINTS to a separate requirements page or PDF (e.g. "Admission requirements: see here [link]"), instead of extracting, return { "status": "followup", "followUrl": "<absolute url>" }.
- If the page has no meaningful admission info at all, return { "status": "insufficient" }.
- Otherwise return { "status": "ok", ...fields }.`;

/**
 * @param {{ programName: string, university: string, url: string, text: string }} args
 */
export function buildScrapePrompt({ programName, university, url, text }) {
  return `PROGRAM: ${programName}
UNIVERSITY: ${university}
SOURCE URL: ${url}
TARGET INTAKE: Winter Semester 2026/27

Return a JSON object with this exact shape (omit followUrl unless status=followup):
{
  "status": "ok" | "followup" | "insufficient",
  "followUrl": "https://..."  // only when status=followup
  "confidence": "high" | "medium" | "low",
  "deadline": "YYYY-MM-DD" | null,
  "language": {
    "english": "string describing English requirements or null",
    "german":  "string describing German requirements or null"
  },
  "academic":  ["bullet point", ...],   // degree, ECTS, GPA, field of study
  "documents": ["bullet point", ...],   // CV, transcript, letters, etc.
  "other":     ["bullet point", ...]    // fees, portfolio, GRE, interview
}

Keep each bullet point under 140 characters. Prefer specific numbers (e.g. "Bachelor with min. 180 ECTS in Computer Science") over vague text ("good bachelor's degree"). Deduplicate. Omit categories with no items as empty arrays.

--- PAGE TEXT START ---
${text}
--- PAGE TEXT END ---`;
}
