// VNC WebSocket proxy — handles KasmVNC auth so the browser doesn't need to
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const PORT = 2090;
const KASM_HOST = '100.111.98.27';
const KASM_PORT = 2088;
const AUTH = 'Basic ' + Buffer.from('kasm_user:Silverhand').toString('base64');

const server = http.createServer();

server.on('upgrade', (req, socket, head) => {
  // Forward WebSocket upgrade to KasmVNC with auth
  const fwdHeaders = {
    'Host': KASM_HOST + ':' + KASM_PORT,
    'Authorization': AUTH,
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '',
    'Sec-WebSocket-Version': req.headers['sec-websocket-version'] || '13',
    'Sec-WebSocket-Extensions': req.headers['sec-websocket-extensions'] || '',
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
  };

  console.log('[vnc-proxy] Upgrade req path:', req.url, 'headers:', JSON.stringify({
    host: req.headers['host'],
    key: req.headers['sec-websocket-key'] ? 'present' : 'missing',
    version: req.headers['sec-websocket-version']
  }));

  const proxyReq = https.request({
    hostname: KASM_HOST, port: KASM_PORT,
    path: '/websockify',
    method: 'GET',
    headers: fwdHeaders,
    rejectUnauthorized: false,
    timeout: 8000
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket) => {
    console.log('[vnc-proxy] Got upgrade from KasmVNC!');
    // Send upgrade response to client
    const acceptKey = proxyRes.headers['sec-websocket-accept'] || '';
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey + '\r\n' +
      '\r\n');
    // Pipe data bidirectionally, including any buffered head
    if (head && head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('response', (res) => {
    console.log('[vnc-proxy] Got HTTP response instead of upgrade:', res.statusCode);
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => console.log('[vnc-proxy] Response body:', body.substring(0, 200)));
    socket.destroy();
  });

  proxyReq.on('error', (err) => {
    console.error('[vnc-proxy] Error:', err.message);
    socket.destroy();
  });

  proxyReq.on('timeout', () => {
    console.error('[vnc-proxy] Request timeout');
    proxyReq.destroy();
    socket.destroy();
  });

  proxyReq.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('VNC proxy on :' + PORT + ' → wss://' + KASM_HOST + ':' + KASM_PORT);
});
