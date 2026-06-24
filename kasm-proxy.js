// KasmVNC auth proxy - accepts Amir:Silverhand, proxies to kasm_user:Silverhand
// Handles both HTTP and WebSocket connections
const http = require('http');
const https = require('https');
const PORT = 2089;

const TARGET = 'https://100.111.98.27:2088';
const PROXY_AUTH = 'Basic ' + Buffer.from('kasm_user:Silverhand').toString('base64');

function makeFwdHeaders(req) {
  return {
    'Authorization': PROXY_AUTH,
    'Host': '100.111.98.27:2088',
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'Accept': req.headers['accept'] || '*/*',
    'accept-encoding': 'gzip, deflate, identity',
    'Connection': req.headers['connection'] || 'keep-alive',
    'Upgrade': req.headers['upgrade'] || '',
    'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '',
    'Sec-WebSocket-Version': req.headers['sec-websocket-version'] || '',
    'Sec-WebSocket-Extensions': req.headers['sec-websocket-extensions'] || ''
  };
}

const server = http.createServer((req, res) => {
  const auth = req.headers['authorization'] || '';
  const expected = Buffer.from('Amir:Silverhand').toString('base64');
  if (auth !== 'Basic ' + expected) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Kasm Desktop"' });
    res.end('Unauthorized');
    return;
  }

  const proxyReq = https.request({
    hostname: '100.111.98.27', port: 2088,
    path: req.url, method: req.method,
    headers: makeFwdHeaders(req), rejectUnauthorized: false
  }, (proxyRes) => {
    const outHeaders = { ...proxyRes.headers };
    delete outHeaders['connection'];
    res.writeHead(proxyRes.statusCode, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[kasm-proxy] Error:', err.message);
    if (!res.headersSent) { res.writeHead(502); res.end('Proxy error'); }
  });

  req.pipe(proxyReq);
});

// WebSocket upgrade proxy
server.on('upgrade', (req, socket, head) => {
  const auth = req.headers['authorization'] || '';
  const expected = Buffer.from('Amir:Silverhand').toString('base64');
  if (auth !== 'Basic ' + expected) {
    socket.destroy();
    return;
  }

  const proxyReq = https.request({
    hostname: '100.111.98.27', port: 2088,
    path: req.url, method: 'GET',
    headers: makeFwdHeaders(req), rejectUnauthorized: false
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket) => {
    // Forward the upgrade response to the client
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + proxyRes.headers['sec-websocket-accept'],
      'Sec-WebSocket-Protocol: ' + (proxyRes.headers['sec-websocket-protocol'] || ''),
      ''
    ].join('\r\n') + '\r\n';
    
    socket.write(responseHeaders);
    
    // Bidirectional pipe - forward any buffered data and stream the rest
    if (head && head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', (err) => {
    console.error('[kasm-proxy] WS Error:', err.message);
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(PORT, '100.111.98.27', () => {
  console.log(`KasmVNC proxy on :${PORT} (Amir:Silverhand) → :2088 (kasm_user:Silverhand)`);
});
