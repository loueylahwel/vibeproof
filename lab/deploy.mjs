// Simulated deployment for a lab app: serves the site, its JavaScript bundle,
// any files the host leaks, and imitations of the Supabase REST/storage API
// and the Firebase Realtime Database / Firestore REST API, all on one local port.
import http from 'node:http';
import { fakeJwt } from './lab.mjs';

const ANON = fakeJwt('anon');

const SECURE_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export async function startDeployment(spec) {
  let base = '';
  const extra = spec.headers === 'secure' ? SECURE_HEADERS : {};
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, ...extra });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    if (req.method !== 'GET') return send(res, 405, { error: 'lab deployment only answers GET' });

    if (p === '/') {
      return send(res, 200, '<!doctype html><html><head><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>', 'text/html');
    }
    if (p === '/assets/index.js') {
      return send(res, 200, spec.bundle({ base }) + (spec.sourceMap ? '\n//# sourceMappingURL=index.js.map' : ''), 'text/javascript');
    }
    if (p === '/assets/index.js.map' && spec.sourceMap) {
      return send(res, 200, { version: 3, sources: ['src/App.tsx', 'src/lib/api.ts'], mappings: 'AAAA' });
    }
    if (spec.files?.[p] !== undefined) return send(res, 200, spec.files[p], 'text/plain');

    const sb = spec.supabase;
    if (sb && p.startsWith('/rest/v1/')) {
      if (req.headers.apikey !== ANON) return send(res, 401, { message: 'Invalid API key' });
      const table = p.slice('/rest/v1/'.length);
      if (table === '') {
        if (!sb.schemaExposed) return send(res, 401, { message: 'schema not exposed' });
        const paths = Object.fromEntries([['/', {}], ...Object.keys(sb.tables).map((t) => [`/${t}`, {}])]);
        return send(res, 200, { swagger: '2.0', paths }, 'application/openapi+json');
      }
      const mode = sb.tables[table];
      if (mode === 'open') return send(res, 200, [{ id: 1, owner: 'u-1', secret_note: 'lab row value' }]);
      if (mode === 'empty') return send(res, 200, []);
      if (mode === 'denied') return send(res, 401, { message: 'permission denied' });
      return send(res, 404, { message: 'relation does not exist' });
    }
    if (sb && p.startsWith('/storage/v1/bucket/')) {
      const bucket = p.slice('/storage/v1/bucket/'.length);
      if (!(bucket in (sb.buckets ?? {}))) return send(res, 404, { message: 'Bucket not found' });
      return send(res, 200, { id: bucket, name: bucket, public: sb.buckets[bucket] });
    }

    const fb = spec.firebase;
    if (fb && p === '/rtdb/.json') {
      return fb.rtdb === 'open' ? send(res, 200, { users: true, sessions: true }) : send(res, 401, { error: 'Permission denied' });
    }
    if (fb && p.startsWith(`/v1/projects/${fb.projectId}/databases/(default)/documents/`)) {
      const col = p.split('/').pop();
      if (fb.collections[col] === 'open') {
        return send(res, 200, { documents: [{ name: `${col}/1`, fields: { owner: { stringValue: 'lab-user' }, weight: { integerValue: '80' } } }] });
      }
      return send(res, 403, { error: { code: 403, message: 'Missing or insufficient permissions.' } });
    }

    return send(res, 404, 'not found', 'text/plain');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}
