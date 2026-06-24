// OpenCode web server launcher for the dashboard
// Spawns opencode web on port 1703 with proper env and CORS
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, 'opencode.env');
const WORKSPACE = path.join(__dirname, '..'); // workspace root
const PORT = 1703;
const HOST = '0.0.0.0';
const CORS = [
  `http://100.111.98.27:1702`,
  `http://localhost:1702`,
  `http://127.0.0.1:1702`,
];

// Load env
const env = { ...process.env };
try {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch (e) {
  console.error('[opencode] No env file found, using process env');
}

// CORS flags
const corsFlags = CORS.flatMap(url => ['--cors', url]);

const child = spawn('opencode', [
  'web',
  '--port', String(PORT),
  '--hostname', HOST,
  ...corsFlags,
], {
  cwd: WORKSPACE,
  env,
  stdio: ['pipe', 'inherit', 'inherit'],
  detached: false,
});

child.on('error', (err) => {
  console.error('[opencode] Failed to start:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log('[opencode] Exited with code:', code);
  process.exit(code || 0);
});

// Handle signals
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

console.log(`[opencode] Starting OpenCode web server on ${HOST}:${PORT}...`);
console.log(`[opencode] Workspace: ${WORKSPACE}`);
