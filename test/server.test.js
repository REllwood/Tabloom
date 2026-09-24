import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

let server;
let origin;

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  origin = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u);
      if (match) resolve(match[0]);
    });
    server.once('exit', (code) => reject(new Error(`The server exited early with code ${code}.`)));
  });
});

after(() => server.kill());

// Raw requests, so paths reach the server exactly as written.
function send(method, path) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname, port, method, path, agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('the app shell is served with its security headers', async () => {
  const { status, headers, body } = await send('GET', '/');
  assert.equal(status, 200);
  assert.match(headers['content-type'], /^text\/html/);
  assert.match(headers['content-security-policy'], /connect-src 'none'/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cache-control'], 'no-store');
  assert.match(body, /<title>Tabloom<\/title>/);
});

test('every file the page loads is served', async () => {
  const pending = ['/'];
  const served = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (served.has(path)) continue;
    const { status, body } = await send('GET', path);
    assert.equal(status, 200, path);
    served.add(path);
    const references = path.endsWith('.js') ? /^import .* from '(\.[^']+)';$/gmu : /(?:src|href)="([^"#:]+)"/gu;
    for (const [, reference] of body.matchAll(references)) pending.push(new URL(reference, new URL(path, origin)).pathname);
  }
  assert.deepEqual([...served].sort(), ['/', '/src/app.js', '/src/core.js', '/src/sample.js', '/src/styles.css']);
});

test('files outside the public list are not served', async () => {
  for (const path of ['/server.mjs', '/package.json', '/fixtures/selected-tabs.json', '/src/../package.json', '/%2e%2e/package.json', '/test/core.test.js']) {
    assert.equal((await send('GET', path)).status, 404, path);
  }
  assert.equal((await send('GET', '/%E0%A4%A')).status, 400);
});

test('only GET and HEAD are allowed', async () => {
  const head = await send('HEAD', '/');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { status, headers } = await send(method, '/');
    assert.equal(status, 405, method);
    assert.equal(headers.allow, 'GET, HEAD');
  }
});
