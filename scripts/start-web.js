const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const publicPort = Number(process.env.BARION_WEB_PORT || 8081);
const metroPort = Number(process.env.BARION_METRO_PORT || publicPort + 1);
const isolationHeaders = {
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-opener-policy': 'same-origin',
};

const proxy = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: metroPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `localhost:${metroPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        ...isolationHeaders,
      });
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'text/plain', ...isolationHeaders });
    }
    response.end('Barion is starting. Refresh in a moment.');
  });
  request.pipe(upstream);
});

proxy.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(metroPort, '127.0.0.1', () => {
    const headers = Object.entries({ ...request.headers, host: `localhost:${metroPort}` })
      .map(([name, value]) => `${name}: ${value}`)
      .join('\r\n');
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

const expoCli = require.resolve('expo/bin/cli');
const expo = spawn(
  process.execPath,
  [expoCli, 'start', '--port', String(metroPort), ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  proxy.close();
  expo.kill(signal);
}

expo.on('exit', (code) => {
  proxy.close(() => process.exit(code || 0));
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

proxy.listen(publicPort, '0.0.0.0', () => {
  console.log(`Barion web: http://127.0.0.1:${publicPort}`);
});
