'use strict';

function createWebAdmin(options) {
  const {
    assets,
    auth,
    getAdminSetupRequired = () => false,
    getGeoStats,
    getState,
    getStreamConfigSnapshot,
    host,
    http,
    logger,
    onReloadStreams,
    onReplaceStreams,
    onRestart,
    port,
    resolveRequest,
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
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = normalizePath(requestUrl.pathname);
      if (pathname === null) return sendJson(res, 400, { error: 'Invalid path.' });
      const context = resolveRequest(req);
      const session = auth.authenticateRequest(req);

      if (req.method === 'GET' && pathname === '/admin.css') {
        return send(res, 200, assets.css, 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/altcha.css') {
        return send(res, 200, assets.altchaCss, 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/login.css') {
        return send(res, 200, assets.loginCss, 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/altcha.js') {
        return send(res, 200, assets.altchaJs, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/altcha-pbkdf2.js') {
        return send(res, 200, assets.altchaPbkdf2Worker, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/login.js') {
        return send(res, 200, assets.loginJs, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/admin.js') {
        return send(res, 200, assets.js, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/users.js') {
        return send(res, 200, assets.usersJs, 'application/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/favicon.ico') {
        return send(res, 200, assets.favicon, 'image/x-icon');
      }

      if (req.method === 'GET' && pathname === '/api/auth/status') {
        if (session) {
          return sendJson(res, 200, {
            authenticated: true,
            csrfToken: session.csrfToken,
            setupRequired: false,
            username: session.username,
          });
        }
        const loginCsrf = auth.createLoginCsrf(context.secure);
        return sendJson(res, 200, {
          authenticated: false,
          loginCsrfToken: loginCsrf.token,
          setupRequired: Boolean(getAdminSetupRequired()),
        }, { 'set-cookie': loginCsrf.cookie });
      }

      if (req.method === 'GET' && pathname === '/api/auth/challenge') {
        if (!isSameOrigin(req, context) || !auth.verifyLoginCsrf(req, req.headers['x-csrf-token'])) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        const result = await auth.createLoginChallenge({
          username: requestUrl.searchParams.get('username'),
          clientAddress: context.clientAddress,
        });
        return sendResult(res, result);
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        if (!isSameOrigin(req, context) || !auth.verifyLoginCsrf(req, req.headers['x-csrf-token'])) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        const body = await readJson(req, 40 * 1024);
        const result = await auth.login({
          altchaPayload: body.altcha,
          clientAddress: context.clientAddress,
          password: body.password,
          secure: context.secure,
          username: body.username,
        });
        return sendResult(res, result);
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        if (!session) return sendJson(res, 401, { error: 'Authentication required.' });
        if (!isAuthorizedMutation(req, context, session)) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        const cookie = auth.logout(session, context.secure);
        return sendJson(res, 200, { ok: true }, { 'set-cookie': cookie });
      }

      if (req.method === 'GET' && pathname === '/') {
        return send(
          res,
          200,
          session ? assets.html : assets.loginHtml,
          'text/html; charset=utf-8',
          { page: session ? 'admin' : 'login' },
        );
      }
      if (req.method === 'GET' && pathname === '/users') {
        if (!session) return redirect(res, '/');
        return send(res, 200, assets.usersHtml, 'text/html; charset=utf-8', {
          googleCharts: true,
          page: 'admin',
        });
      }

      if (!session) {
        return sendJson(res, 401, { error: 'Authentication required.', code: 'authentication_required' });
      }
      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, getState());
      }
      if (req.method === 'GET' && pathname === '/api/users/geo') {
        return sendJson(res, 200, getGeoStats());
      }
      if (req.method === 'PUT' && pathname === '/api/streams') {
        if (!isAuthorizedMutation(req, context, session)) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        const body = await readJson(req, 64 * 1024);
        const baseConfig = getStreamConfigSnapshot();
        const result = await onReplaceStreams(body);
        result.audit = auth.recordChange(session, {
          action: 'streams_updated',
          baseConfig,
          details: {
            changeScope: result.changeScope || 'unknown',
            streamCount: Array.isArray(result.streams) ? result.streams.length : 0,
          },
        });
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/streams/reload') {
        if (!isAuthorizedMutation(req, context, session)) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        const result = await onReloadStreams();
        return sendJson(res, 200, {
          ...result,
          message: `${result.streams.length} stream${result.streams.length === 1 ? '' : 's'} reloaded from disk.`,
        });
      }
      if (req.method === 'POST' && pathname === '/api/restart') {
        if (!isAuthorizedMutation(req, context, session)) {
          return sendJson(res, 403, { error: 'Admin request rejected.', code: 'csrf_invalid' });
        }
        sendJson(res, 202, { ok: true, message: 'Restart requested.' });
        setTimeout(onRestart, 150);
        return;
      }

      return sendJson(res, 404, { error: 'Not found.' });
    } catch (err) {
      const statusCode = Number(err && err.statusCode) || 500;
      if (logger) logger.warn('webadmin_request_failed', {
        error: err && err.message,
        method: req.method,
        path: safeLogPath(req.url),
        statusCode,
      });
      return sendJson(res, statusCode, {
        error: statusCode >= 500 ? 'The admin request could not be completed.' : String(err.message || 'Invalid request.'),
      });
    }
  }

  function isAuthorizedMutation(req, context, session) {
    return isSameOrigin(req, context)
      && auth.verifySessionCsrf(session, req.headers['x-csrf-token']);
  }

  function isSameOrigin(req, context) {
    const origin = String(req.headers.origin || '');
    if (!origin) return true;
    try {
      return new URL(origin).origin === context.origin;
    } catch {
      return false;
    }
  }

  function sendResult(res, result) {
    const headers = {};
    if (result.cookie) headers['set-cookie'] = result.cookie;
    if (result.retryAfter) headers['retry-after'] = String(result.retryAfter);
    return sendJson(res, result.statusCode, result.body, headers);
  }

  function redirect(res, location) {
    res.writeHead(302, {
      location,
      'cache-control': 'no-store',
      ...securityHeaders(),
    });
    res.end();
  }

  function send(res, statusCode, body, contentType, securityOptions, extraHeaders = {}) {
    res.writeHead(statusCode, {
      'content-type': contentType,
      'cache-control': 'no-store',
      ...securityHeaders(securityOptions),
      ...extraHeaders,
    });
    res.end(body);
  }

  function sendJson(res, statusCode, value, extraHeaders = {}) {
    send(res, statusCode, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8', {}, extraHeaders);
  }

  function securityHeaders(options = {}) {
    const sources = options.googleCharts
      ? "script-src 'self' https://www.gstatic.com https://www.google.com; style-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com; img-src 'self' data: https://www.gstatic.com https://www.google.com; connect-src 'self' https://www.gstatic.com https://www.google.com"
      : "script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'";
    return {
      'content-security-policy': `default-src 'self'; ${sources}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    };
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

function normalizePath(value) {
  try {
    return decodeURIComponent(String(value).split('?')[0]).replace(/\/+/g, '/');
  } catch {
    return null;
  }
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        const err = new Error('Request body is too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const err = new Error('Request body must be valid JSON.');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
  });
}

function safeLogPath(value) {
  try {
    return new URL(String(value || ''), 'http://localhost').pathname;
  } catch {
    return '';
  }
}

module.exports = {
  createWebAdmin,
};
