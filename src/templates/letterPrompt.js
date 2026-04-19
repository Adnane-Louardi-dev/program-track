/**
 * letterPrompt.js
 * Builds system and user prompts for motivation letter generation and scoring.
 */

// ── System prompt ─────────────────────────────────────────────────────────

export const LETTER_SYSTEM_PROMPT = `You are a graduate admissions consultant helping a Moroccan CS student write motivation letters for German master's programs. Write authentic, specific letters that sound human — not AI-generated. Avoid clichés. Be direct. Each letter must be tailored to the specific program and university. Never reuse phrasing from one letter to another.`;

// ── Letter generation prompt ──────────────────────────────────────────────

/**
 * Build the user prompt for letter generation.
 * @param {object} profile   — from data/profile.json
 * @param {object} program   — from data/programs.json
 * @param {string} style     — 'formal' | 'personal' | 'academic'
 * @returns {string}
 */
export function buildLetterPrompt(profile, program, style = 'formal') {
  const profileBlock = JSON.stringify({
    name:           profile.name,
    degree:         profile.degree,
    university:     profile.university,
    graduationDate: profile.graduationDate,
    gpa:            profile.gpa,
    germanGPA:      profile.germanGPA,
    ects:           profile.ects,
    english:        profile.english,
    german:         profile.german,
    githubUrl:      profile.githubUrl,
    skills:         profile.skills,
    projects:       profile.projects,
    whyGermany:     profile.whyGermany,
    careerGoals:    profile.careerGoals,
    personalTouch:  profile.personalTouch,
  }, null, 2);

  const needsEctsAddress = program.eligibilityFlags?.includes('ECTS_GAP');
  const ectsNote = needsEctsAddress
    ? `- This program typically expects more than 180 ECTS. Address this gap proactively and frame it positively — emphasize the depth of the Moroccan Licence, strong GPA, and readiness to perform at master's level.`
    : '';

  const rankingContext = [program.ranking1, program.ranking2].filter(Boolean).join(', ') || 'Not ranked';
  const priorityLabel  = (program.priorityScore ?? 0) >= 70 ? 'HIGH — write with full effort'
    : (program.priorityScore ?? 0) >= 40 ? 'MEDIUM'
    : 'LOW';

  return `Write a motivation letter for the following master's program application.

## Applicant Profile
${profileBlock}

## Target Program
- Program: ${program.name}
- University: ${program.university}
- Degree: ${program.degree}
- City: ${program.city || '—'}
- Duration: ${program.duration || '2'} years (${program.semesters || '4'} semesters)
- Program description: ${program.description || 'Not provided — infer from program name and university context.'}
- Assessment type: ${program.assessment || 'Standard application'}
- Special notes: ${program.notes || 'None'}
- University ranking: ${rankingContext}
- Language of instruction: ${program.language}
- Tuition: ${program.tuition || 'Not specified'}
- Priority score: ${program.priorityScore ?? '—'} / 100 (${priorityLabel})

## Requirements
- Length: 450–550 words (exactly 1 page — no more, no less)
- Tone: ${style}
- Output ONLY the letter body — no subject line, no address block, no "Dear Admissions Committee" header. Start directly with the opening paragraph.

### Structure (follow this exactly):
1. **Opening paragraph** — Why THIS specific program at THIS university. Reference something concrete and unique: a specific research group, a module name, a faculty project, the city's tech ecosystem, or the university's specific approach. Do NOT open with "I am writing to apply…"
2. **Academic background** — How the CS degree from Morocco prepared you. Mention 1–2 specific relevant courses or topics. Acknowledge the 180 ECTS honestly if relevant.
3. **Technical projects** — Reference 1–2 GitHub projects from the profile naturally. Name them, describe what was built, what was learned, and tie it directly to the target program's focus.
4. **Why Germany** — Brief and genuine. Not generic tourism praise.
5. **Career vision** — Concrete post-graduation goals. How does this specific program enable them?

### Hard rules:
- Sign off with: "${profile.name}"
- BANNED phrases (never use): "I am passionate about", "ever since I was young", "in today's rapidly evolving world", "I am confident that", "it would be an honor", "I have always been fascinated", "I am writing to apply"
- Do NOT start consecutive paragraphs with "I"
- Do NOT use bullet points inside the letter
- Vary sentence length — mix short punchy sentences with longer ones
${ectsNote}

Output the letter now.`;
}

// ── Refinement prompt ─────────────────────────────────────────────────────

/**
 * Build prompt for letter refinement.
 * @param {string} existingLetter  — current letter body
 * @param {object} program         — program record
 * @param {string} feedback        — user's instructions
 * @param {number} version         — current version number
 */
export function buildRefinePrompt(existingLetter, program, feedback, version) {
  return `You are improving a motivation letter for a German master's program application.

## Program
- Name: ${program.name}
- University: ${program.university}

## Current letter (version ${version}):
${existingLetter}

## Requested changes:
${feedback}

## Instructions:
- Apply the requested changes precisely
- Keep all strengths of the existing letter
- Maintain the same length (450–550 words)
- Do NOT add "I am passionate about", "ever since I was young", or other banned clichés
- Output ONLY the improved letter body — no explanations, no preamble

Output the improved letter now.`;
}

// ── Scoring prompt ────────────────────────────────────────────────────────

/**
 * Build prompt for letter quality scoring.
 * @param {string} letterBody — the letter text
 * @param {object} program    — program record
 */
export function buildScorePrompt(letterBody, program) {
  return `Evaluate this motivation letter for a German master's program application.

## Program
- Name: ${program.name}
- University: ${program.university}
- Description: ${program.description || 'Not provided'}

## Letter to evaluate:
${letterBody}

## Scoring criteria (rate each 1–5):
1. **Relevance to program** — Does it reference specific aspects of this program?
2. **Specificity** — Are claims concrete (named projects, courses, goals)?
3. **Authenticity** — Does it sound human and genuine, not AI-generated?
4. **Structure** — Does it follow a logical flow (why program → background → projects → why Germany → goals)?
5. **Word count compliance** — Is it 450–550 words?

## Output format (respond ONLY with this JSON, nothing else):
{
  "scores": {
    "relevance":     { "score": <1-5>, "comment": "<one sentence>" },
    "specificity":   { "score": <1-5>, "comment": "<one sentence>" },
    "authenticity":  { "score": <1-5>, "comment": "<one sentence>" },
    "structure":     { "score": <1-5>, "comment": "<one sentence>" },
    "wordCount":     { "count": <number>, "compliant": <true|false>, "comment": "<one sentence>" }
  },
  "ectsAddressed": <true|false>,
  "suggestions": ["<specific actionable suggestion>", "<specific actionable suggestion>"],
  "overallComment": "<2-3 sentence overall assessment>"
}`;
}
