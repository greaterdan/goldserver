import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';

import tokenCache from './tokenCache.js';
import {
  getJupiterPriceSnapshot,
  initializeJupiterPriceService,
} from './jupiterPriceService.js';

const normalizePath = (path: string | undefined, fallback: string) => {
  if (!path) return fallback;
  if (!path.startsWith('/')) return `/${path}`;
  return path;
};

const HOST = process.env.TOKEN_SERVER_HOST ?? '0.0.0.0';
const PORT = Number.parseInt(process.env.TOKEN_SERVER_PORT ?? '4020', 10);
const TOKEN_PATH = normalizePath(process.env.TOKEN_SERVER_PATH, '/token');
const JUPITER_PRICE_PATH = normalizePath(process.env.JUPITER_PRICE_PATH, '/jupiter-price');

initializeJupiterPriceService();

const server = http.createServer((req, res) => {
  if (!req.url || !req.method) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host ?? `localhost:${PORT}`}`);

  res.setHeader('Access-Control-Allow-Origin', process.env.TOKEN_SERVER_CORS ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === TOKEN_PATH) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);
    res.end(JSON.stringify(tokenCache.snapshot()));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === JUPITER_PRICE_PATH) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);
    res.end(JSON.stringify(getJupiterPriceSnapshot()));
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'ok',
        mint: tokenCache.snapshot().mint,
        lastUpdated: tokenCache.snapshot().lastUpdated,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
  tokenCache.register(socket);
});

server.on('upgrade', (request, socket, head) => {
  const { url } = request;
  if (!url) {
    socket.destroy();
    return;
  }

  const requestUrl = new URL(url, `http://${request.headers.host ?? `localhost:${PORT}`}`);

  if (requestUrl.pathname !== TOKEN_PATH) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Token server listening on http://${HOST}:${PORT}`);
});
