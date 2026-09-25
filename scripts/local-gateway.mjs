import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.GATEWAY_PORT ?? 8080);
const webRoot = join(process.cwd(), 'apps/web/dist');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function proxy(request, response, targetUrl) {
  const next = new URL(targetUrl);
  const upstream = fetch(next, {
    method: request.method,
    headers: {
      ...request.headers,
      host: next.host
    },
    body: ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : request,
    duplex: 'half'
  });

  upstream
    .then(async (upstreamResponse) => {
      response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()));
      if (upstreamResponse.body) {
        for await (const chunk of upstreamResponse.body) {
          response.write(chunk);
        }
      }
      response.end();
    })
    .catch((error) => {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'gateway_bad_upstream', message: error.message }));
    });
}

function serveStatic(pathname, response) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const requested = join(webRoot, safePath === '/' ? 'index.html' : safePath);
  const filePath = statSync(requested, { throwIfNoEntry: false })?.isFile() ? requested : join(webRoot, 'index.html');
  response.writeHead(200, {
    'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    proxy(request, response, `http://127.0.0.1:3001/${url.pathname.slice('/api/'.length)}${url.search}`);
    return;
  }

  if (url.pathname === '/webhook') {
    proxy(request, response, `http://127.0.0.1:3002/webhook${url.search}`);
    return;
  }

  if (url.pathname === '/bot-health') {
    proxy(request, response, 'http://127.0.0.1:3002/health');
    return;
  }

  if (url.pathname === '/bot-me') {
    proxy(request, response, 'http://127.0.0.1:3002/me');
    return;
  }

  serveStatic(url.pathname, response);
}).listen(port, '0.0.0.0', () => {
  console.info(`local gateway listening on http://127.0.0.1:${port}`);
});
