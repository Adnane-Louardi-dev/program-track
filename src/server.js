/**
 * server.js - Express API server for the GMA Dashboard
 */
import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadPrograms, savePrograms, loadChecklist, saveChecklist, loadProfile, getProgramById, updateProgram } from './lib/database.js';
import { computeFlags, computeScore } from './lib/eligibility.js';
import { scrapeProgram } from './lib/scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_STATUSES = ['not-yet', 'filling', 'pending', 'accepted', 'rejected', 'missed'];

function daysUntil(isoDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(isoDate) - today) / (24 * 60 * 60 * 1000));
}

function applyFilters(programs, query) {
  let list = [...programs];
  if (query.status)   list = list.filter(p => p.status === query.status);
  if (query.language) list = list.filter(p => (p.language || '').toLowerCase().includes(query.language.toLowerCase()));
  if (query.city)     list = list.filter(p => (p.city || '').toLowerCase().includes(query.city.toLowerCase()));
  if (query.flag)     list = list.filter(p => (p.eligibilityFlags || []).includes(query.flag.toUpperCase()));
  if (query.search) {
    const q = query.search.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q) || (p.university || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q));
  }
  if (query.uniassist === 'true') list = list.filter(p => p.uniAssist);
  const sort = query.sort || 'deadline';
  if (sort === 'score') {
    list.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  } else if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'university') {
    list.sort((a, b) => (a.university || '').localeCompare(b.university || ''));
  } else {
    list.sort((a, b) => {
      if (!a.deadlineWinterParsed) return 1;
      if (!b.deadlineWinterParsed) return -1;
      return a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed);
    });
  }
  return list;
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, 'dashboard')));

  const nm = join(__dirname, '..', 'node_modules');
  app.get('/lib/react.min.js',     (_, res) => res.sendFile(join(nm, 'react/umd/react.production.min.js')));
  app.get('/lib/react-dom.min.js', (_, res) => res.sendFile(join(nm, 'react-dom/umd/react-dom.production.min.js')));
  app.get('/lib/htm.js',           (_, res) => res.sendFile(join(nm, 'htm/dist/htm.js')));

  app.get('/api/programs', (req, res) => {
    try {
      const programs = loadPrograms();
      const list = applyFilters(programs, req.query);
      res.json({ programs: list, total: programs.length, filtered: list.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/programs/deadlines', (req, res) => {
    try {
      const programs = loadPrograms();
      const weeks = Number(req.query.weeks || 8);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cutoff = new Date(today.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
      const skip = new Set(['missed', 'accepted', 'rejected']);
      const deadlines = programs
        .filter(p => {
          if (skip.has(p.status) || !p.deadlineWinterParsed) return false;
          const d = new Date(p.deadlineWinterParsed);
          return d >= today && d <= cutoff;
        })
        .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed))
        .map(p => ({
          id: p.id,
          name: p.name,
          university: p.university,
          deadlineWinterParsed: p.deadlineWinterParsed,
          daysLeft: daysUntil(p.deadlineWinterParsed),
          status: p.status,
          motivationLetterGenerated: p.motivationLetterGenerated,
          uniAssist: p.uniAssist,
          priorityScore: p.priorityScore
        }));
      res.json({ deadlines });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/programs/:id', (req, res) => {
    try {
      const program = getProgramById(req.params.id);
      if (!program) return res.status(404).json({ error: 'Program not found' });
      res.json({ program });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/programs/:id', (req, res) => {
    try {
      const { status, notes, documentsSubmitted } = req.body;
      const patch = {};
      if (status !== undefined) {
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status: ' + status });
        patch.status = status;
        if (status === 'accepted' || status === 'filling') patch.appliedDate = new Date().toISOString().slice(0, 10);
      }
      if (notes !== undefined)              patch.notes = notes;
      if (documentsSubmitted !== undefined) patch.documentsSubmitted = documentsSubmitted;
      const updated = updateProgram(req.params.id, patch);
      if (!updated) return res.status(404).json({ error: 'Program not found' });
      if (status !== undefined) {
        const programs = loadPrograms();
        const idx = programs.findIndex(p => p.id === updated.id);
        if (idx !== -1) {
          programs[idx].eligibilityFlags = computeFlags(programs[idx]);
          programs[idx].priorityScore    = computeScore(programs[idx]);
          savePrograms(programs);
          updated.eligibilityFlags = programs[idx].eligibilityFlags;
          updated.priorityScore    = programs[idx].priorityScore;
        }
      }
      res.json({ program: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/programs/:id/scrape', async (req, res) => {
    try {
      const result = await scrapeProgram(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/programs/:id/letter', (req, res) => {
    try {
      const program = getProgramById(req.params.id);
      if (!program) return res.status(404).json({ error: 'Program not found' });
      if (!program.motivationLetterGenerated || !program.motivationLetterPath) return res.status(404).json({ error: 'No letter generated' });
      if (!existsSync(program.motivationLetterPath)) return res.status(404).json({ error: 'Letter file not found on disk' });
      const raw = readFileSync(program.motivationLetterPath, 'utf-8');
      let content = raw;
      if (raw.startsWith('---')) { const end = raw.indexOf('---', 3); if (end !== -1) content = raw.slice(end + 3).trim(); }
      res.json({ content, path: program.motivationLetterPath });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/summary', (req, res) => {
    try {
      const programs = loadPrograms();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in7  = new Date(today.getTime() + 7  * 24 * 60 * 60 * 1000);
      const in14 = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
      const skip = new Set(['missed', 'accepted', 'rejected']);
      const count = pred => programs.filter(pred).length;
      res.json({
        total: programs.length,
        byStatus: {
          'not-yet':  count(p => p.status === 'not-yet'),
          'filling':  count(p => p.status === 'filling'),
          'pending':  count(p => p.status === 'pending'),
          'accepted': count(p => p.status === 'accepted'),
          'rejected': count(p => p.status === 'rejected'),
          'missed':   count(p => p.status === 'missed')
        },
        lettersGenerated:  count(p => p.motivationLetterGenerated),
        highPriority:      count(p => (p.priorityScore || 0) >= 70),
        mediumPriority:    count(p => (p.priorityScore || 0) >= 40 && (p.priorityScore || 0) < 70),
        lowPriority:       count(p => (p.priorityScore || 0) < 40),
        uniAssistCount:    count(p => p.uniAssist),
        urgentDeadlines7:  programs.filter(p => {
          if (skip.has(p.status) || !p.deadlineWinterParsed) return false;
          const d = new Date(p.deadlineWinterParsed);
          return d >= today && d <= in7;
        }).length,
        urgentDeadlines14: programs.filter(p => {
          if (skip.has(p.status) || !p.deadlineWinterParsed) return false;
          const d = new Date(p.deadlineWinterParsed);
          return d >= today && d <= in14;
        }).length,
        strongFit: count(p => (p.eligibilityFlags || []).includes('STRONG_FIT')),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/checklist', (req, res) => {
    try {
      const checklist = loadChecklist();
      const items = Object.entries(checklist);
      res.json({ checklist, total: items.length, done: items.filter(([, v]) => v.done).length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/checklist/:itemId', (req, res) => {
    try {
      const checklist = loadChecklist();
      const item = checklist[req.params.itemId];
      if (!item) return res.status(404).json({ error: 'Item not found' });
      if (typeof req.body.done !== 'boolean') return res.status(400).json({ error: 'done must be boolean' });
      item.done = req.body.done;
      saveChecklist(checklist);
      res.json({ item });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/plan/today', (req, res) => {
    try {
      const programs = loadPrograms();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const DAY_MS = 24 * 60 * 60 * 1000;
      const skip = new Set(['accepted', 'rejected', 'missed']);
      const actionable = programs.filter(p => !skip.has(p.status) && p.deadlineWinterParsed);
      const overdue = programs.filter(p => {
        if (skip.has(p.status) || !p.deadlineWinterParsed) return false;
        return new Date(p.deadlineWinterParsed) < today;
      }).sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
      const thisWeek = actionable.filter(p => {
        const d = daysUntil(p.deadlineWinterParsed);
        return d >= 0 && d < 7;
      }).sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
      const nextWeek = actionable.filter(p => {
        const d = daysUntil(p.deadlineWinterParsed);
        return d >= 7 && d < 14;
      }).sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
      const uniAssistUrgent = programs.filter(p => {
        if (!p.uniAssist || !p.deadlineWinterParsed || skip.has(p.status)) return false;
        const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
        const d = Math.ceil((vpd - today) / DAY_MS);
        return d >= 0 && d <= 14;
      }).map(p => {
        const vpd = new Date(new Date(p.deadlineWinterParsed).getTime() - 42 * DAY_MS);
        return Object.assign({}, p, {
          vpdDeadline: vpd.toISOString().slice(0, 10),
          daysToVpd: Math.ceil((vpd - today) / DAY_MS)
        });
      });
      const lettersNeeded = actionable.filter(p => !p.motivationLetterGenerated && daysUntil(p.deadlineWinterParsed) <= 30)
        .sort((a, b) => a.deadlineWinterParsed.localeCompare(b.deadlineWinterParsed));
      const suggestedActions = [];
      if (lettersNeeded.length > 0) suggestedActions.push({ priority: 1, text: 'Generate ' + lettersNeeded.length + ' missing letter(s) due within 30 days' });
      if (overdue.length > 0)       suggestedActions.push({ priority: 2, text: 'Check if ' + overdue.length + ' overdue program(s) still accept late applications' });
      const uaTotal = programs.filter(p => p.uniAssist && !skip.has(p.status)).length;
      if (uaTotal > 0) suggestedActions.push({ priority: 3, text: 'Submit Uni-Assist VPD for ' + uaTotal + ' programs (6-week processing time)' });
      suggestedActions.push({ priority: 4, text: actionable.filter(p => !p.motivationLetterGenerated).length + ' programs still need motivation letters' });
      res.json({ overdue, thisWeek, nextWeek, uniAssistUrgent, lettersNeeded, suggestedActions });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/profile', (req, res) => {
    try { res.json({ profile: loadProfile() || {} }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/{*path}', (req, res) => {
    const indexPath = join(__dirname, 'dashboard', 'index.html');
    if (existsSync(indexPath)) { res.sendFile(indexPath); } else { res.status(404).send('Dashboard not found.'); }
  });

  return app;
}

export async function startServer(port) {
  port = port || 3000;
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log('\n  GMA Dashboard running at http://localhost:' + port + '\n');
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('\n  Port ' + port + ' is already in use. Try --port ' + (port + 1) + '\n');
      } else {
        console.error('\n  Server error: ' + err.message + '\n');
      }
      reject(err);
    });
    process.on('SIGINT', () => { server.close(() => process.exit(0)); });
    process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  });
}
