// OpenCode proxy server — pass-through with CSP fix for iframe embedding
// Runs on port 1704, proxies everything to OpenCode on port 1703
// Only modifies: CSP (adds frame-ancestors), removes X-Frame-Options
// Preserves ALL other headers including Content-Encoding for compressed assets
const http = require('http');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 1703;
const PROXY_PORT = 1704;
const PROXY_HOST = '0.0.0.0';

// Allow all origins for iframe embedding (CSP frame-ancestors)
function fixCSP(csp) {
  if (!csp) return csp;
  // Only add frame-ancestors if not already present
  if (csp.includes('frame-ancestors')) return csp;
  // Use * to allow embedding from any origin (the dashboard could be accessed via IP, hostname, tailscale, etc.)
  return csp + `; frame-ancestors *`;
}

function proxyRequest(clientReq, clientRes) {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: TARGET_HOST + ':' + TARGET_PORT },
    timeout: 30000,
  };
  // Strip accept-encoding so we get raw (uncompressed) responses for header inspection
  // Actually no — keep it so compressed assets work. Just pass through.

  const proxyReq = http.request(options, (proxyRes) => {
    const cleaned = { ...proxyRes.headers };
    // Fix CSP to allow iframe embedding
    if (cleaned['content-security-policy']) {
      cleaned['content-security-policy'] = fixCSP(cleaned['content-security-policy']);
    }
    // Remove X-Frame-Options (also blocks iframes)
    delete cleaned['x-frame-options'];

    // PRESERVE everything else including content-encoding, transfer-encoding, etc.
    clientRes.writeHead(proxyRes.statusCode, cleaned);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('[oc-proxy] Error:', err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'proxy_error', detail: err.message }));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'proxy_timeout' }));
    }
  });

  clientReq.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }
  proxyRequest(req, res);
});

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`[oc-proxy] OpenCode proxy on ${PROXY_HOST}:${PROXY_PORT} \u2192 ${TARGET_HOST}:${TARGET_PORT}`);
});
