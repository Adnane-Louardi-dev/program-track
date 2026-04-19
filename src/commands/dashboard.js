/**
 * dashboard.js — registers the `dashboard` command with commander.
 * Starts the Express server and opens the browser.
 */

import { startServer } from '../server.js';

export function registerDashboard(program) {
  program
    .command('dashboard')
    .description('Launch the web dashboard in your browser')
    .option('--port <n>', 'Port to listen on (default: 3000)', '3000')
    .option('--no-open', 'Do not auto-open the browser')
    .action(async (opts) => {
      const port = Number(opts.port) || 3000;

      try {
        await startServer(port);

        if (opts.open !== false) {
          // Dynamically import `open` so it doesn't slow down other commands
          const { default: open } = await import('open');
          await open(`http://localhost:${port}`);
        }

        // Keep the process alive (the server's event loop does this,
        // but we log a helpful hint)
        console.log('  Press Ctrl+C to stop the dashboard.\n');
      } catch {
        process.exit(1);
      }
    });
}
