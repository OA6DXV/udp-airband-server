'use strict';

function createWebAdmin(options) {
  const {
    assets,
    getState,
    host,
    http,
    logger,
    onReloadStreams,
    onReplaceStreams,
    onRestart,
    port,
    softwareVersion,
  } = options;

  const server = http.createServer(handleRequest);

  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  async function handleRequest(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = normalizePath(requestUrl.pathname);
    if (pathname === null) {
      sendJson(res, 400, { error: 'Invalid path.' });
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      send(res, 200, assets.html, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/admin.css') {
      send(res, 200, assets.css, 'text/css; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/admin.js') {
      send(res, 200, assets.js, 'application/javascript; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && pathname === '/favicon.ico') {
      send(res, 200, assets.favicon, 'image/x-icon');
      return;
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, getState());
      return;
    }
    if (req.method === 'PUT' && pathname === '/api/streams') {
      if (!isTrustedMutation(req)) {
        sendJson(res, 403, { error: 'Admin request rejected.' });
        return;
      }
      try {
        const body = await readJson(req, 64 * 1024);
        const result = await onReplaceStreams(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/streams/reload') {
      if (!isTrustedMutation(req)) {
        sendJson(res, 403, { error: 'Admin request rejected.' });
        return;
      }
      try {
        const result = await onReloadStreams();
        sendJson(res, 200, {
          ...result,
          message: `${result.streams.length} stream${result.streams.length === 1 ? '' : 's'} reloaded from disk.`,
        });
      } catch (err) {
        sendJson(res, err.statusCode || 500, { error: err.message });
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/restart') {
      if (!isTrustedMutation(req)) {
        sendJson(res, 403, { error: 'Admin request rejected.' });
        return;
      }
      sendJson(res, 202, { ok: true, message: 'Restart requested.' });
      setTimeout(onRestart, 150);
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  }

  function isTrustedMutation(req) {
    if (req.headers['x-admin-request'] !== '1') return false;
    const origin = String(req.headers.origin || '');
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const requestHost = String(req.headers.host || '').toLowerCase();
      return parsed.host.toLowerCase() === requestHost && parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function send(res, statusCode, body, contentType) {
    res.writeHead(statusCode, {
      'content-type': contentType,
      'cache-control': 'no-store',
      ...securityHeaders(),
    });
    res.end(body);
  }

  function sendJson(res, statusCode, value) {
    send(res, statusCode, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8');
  }

  function securityHeaders() {
    return {
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'cross-origin-opener-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
  }

  function normalizePath(value) {
    try {
      return decodeURIComponent(String(value).split('?')[0]).replace(/\/+/g, '/');
    } catch {
      return null;
    }
  }

  function readJson(req, maxBytes) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          const err = new Error('Request body is too large.');
          err.statusCode = 413;
          reject(err);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Request body must be valid JSON.'));
        }
      });
      req.on('error', reject);
    });
  }

  server.on('error', (err) => {
    if (logger) logger.error('webadmin_server_error', { error: err.message });
  });

  return {
    close,
    server,
    softwareVersion,
    start,
  };
}

module.exports = {
  createWebAdmin,
};
