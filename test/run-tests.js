/* Unit tests for Lostman's pure logic. Renderer and main are loaded into vm sandboxes
   with stubbed globals, so no Electron runtime is needed. Run with: npm test */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/* ================= renderer (app.js) ================= */

const appSrc = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8')
  .replace(/\ninit\(\);\s*$/, '\n');
const appCtx = {
  crypto: require('crypto').webcrypto ?? require('crypto'),
  console,
  window: { lostman: { saveStore: () => {} } },
  confirm: () => true,
  requestAnimationFrame: () => {},
  structuredClone,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  Date,
  JSON,
  Math,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  TextEncoder,
};
vm.createContext(appCtx);
vm.runInContext(appSrc, appCtx, { filename: 'app.js' });
const S = vm.runInContext('state', appCtx);

/* ---- cURL import ---- */
{
  const r = appCtx.parseCurl(`curl -X POST 'https://api.example.com/users?page=2' \\
    -H 'Content-Type: application/json' \\
    -H "Authorization: Bearer abc123" \\
    --data-raw '{"name":"Ali","tags":["a","b"]}'`);
  check('curl: method', r.method === 'POST');
  check('curl: url', r.url === 'https://api.example.com/users?page=2', r.url);
  check('curl: headers', r.headers.length === 2 && r.headers[1].value === 'Bearer abc123');
  check('curl: raw json body', r.bodyMode === 'raw' && r.rawType === 'json' && r.rawBody.includes('"Ali"'));
}
{
  const r = appCtx.parseCurl(`curl https://x.dev/login -u admin:secret -d 'user=a&pass=b'`);
  check('curl: implicit POST', r.method === 'POST');
  check('curl: basic auth', r.auth.type === 'basic' && r.auth.username === 'admin' && r.auth.password === 'secret');
  check('curl: urlencoded body', r.bodyMode === 'urlencoded' && r.formItems.length === 2 && r.formItems[0].key === 'user');
}
{
  const r = appCtx.parseCurl(`curl -F "file=@C:/tmp/pic.png" -F "note=hello" https://x.dev/upload`);
  check('curl: formdata + file', r.bodyMode === 'formdata' && r.formItems[0].type === 'file' && r.formItems[0].filePath === 'C:/tmp/pic.png');
  check('curl: -XDELETE combined', appCtx.parseCurl('curl -XDELETE https://x.dev/1 -k').method === 'DELETE');
}

/* ---- Postman import / export round-trip ---- */
const pmDoc = {
  info: { name: 'Demo API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'https://demo.dev' }],
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            header: [{ key: 'X-Trace', value: '1' }, { key: 'X-Off', value: '0', disabled: true }],
            url: { raw: '{{baseUrl}}/login?remember=1', query: [{ key: 'remember', value: '1' }, { key: 'debug', value: '1', disabled: true }] },
            body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'a' }, { key: 'pass', value: 'b' }] },
            auth: { type: 'basic', basic: [{ key: 'username', value: 'u1' }, { key: 'password', value: 'p1' }] },
          },
        },
      ],
    },
    { name: 'Ping', request: { method: 'GET', header: [], url: '{{baseUrl}}/ping', auth: { type: 'bearer', bearer: [{ key: 'token', value: 't0k' }] } } },
  ],
};
{
  const { col, env, count } = appCtx.importPostman(pmDoc);
  check('pm import: count + folder', count === 2 && col.folders.length === 1 && col.folders[0].requests.length === 1);
  const login = col.folders[0].requests[0].request;
  check('pm import: url', login.url === '{{baseUrl}}/login?remember=1', login.url);
  check('pm import: disabled rows kept', login.params.some((p) => p.key === 'debug' && p.enabled === false) && login.headers.some((h) => h.key === 'X-Off' && h.enabled === false));
  check('pm import: auth', login.auth.type === 'basic' && login.auth.password === 'p1' && col.requests[0].request.auth.token === 't0k');
  check('pm import: env vars', env && env.vars.length === 1 && env.vars[0].key === 'baseUrl');

  const exported = appCtx.exportPostman(col);
  check('pm export: schema + shape', exported.info.schema.includes('v2.1.0') && exported.item[0].item.length === 1);
  const expLogin = exported.item[0].item[0].request;
  check('pm export: url raw', expLogin.url.raw === '{{baseUrl}}/login?remember=1', expLogin.url.raw);
  check('pm export: query incl disabled', expLogin.url.query.length === 2 && expLogin.url.query[1].disabled === true);
  const rt = appCtx.importPostman(exported);
  check('pm round-trip stable', rt.count === 2 && rt.col.folders[0].requests[0].request.url === '{{baseUrl}}/login?remember=1');
}

/* ---- OpenAPI / Swagger import ---- */
{
  const oaDoc = {
    openapi: '3.0.0',
    info: { title: 'Pet Store' },
    servers: [{ url: 'https://pets.dev/v1' }],
    components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } } } },
    paths: {
      '/pets/{petId}': {
        get: {
          tags: ['pets'],
          summary: 'Get a pet',
          parameters: [
            { name: 'petId', in: 'path', required: true },
            { name: 'verbose', in: 'query', required: false },
            { name: 'X-Req', in: 'header', required: true },
          ],
        },
        delete: { summary: 'Delete a pet' },
      },
      '/pets': { post: { tags: ['pets'], summary: 'Create a pet', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } },
    },
  };
  const { col, count } = appCtx.importOpenApi(oaDoc);
  check('oa import: count + folders', count === 3 && col.folders[0].name === 'pets' && col.folders[0].requests.length === 2);
  const getPet = col.folders[0].requests.find((r) => r.name === 'Get a pet').request;
  check('oa import: path var', getPet.url === 'https://pets.dev/v1/pets/{{petId}}', getPet.url);
  check('oa import: optional query disabled', getPet.params.some((p) => p.key === 'verbose' && p.enabled === false));
  const createPet = col.folders[0].requests.find((r) => r.name === 'Create a pet').request;
  const bodyObj = JSON.parse(createPet.rawBody);
  check('oa import: $ref skeleton', bodyObj.name === 'string' && bodyObj.age === 0 && Array.isArray(bodyObj.tags));

  const sw = {
    swagger: '2.0',
    info: { title: 'Old API' },
    host: 'old.dev',
    basePath: '/api',
    schemes: ['https'],
    paths: { '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ name: 'file', in: 'formData', type: 'file', required: true }, { name: 'label', in: 'formData', type: 'string' }] } } },
  };
  const sw2 = appCtx.importOpenApi(sw);
  check('sw2: base url + formdata', sw2.col.requests[0].request.url === 'https://old.dev/api/upload' && sw2.col.requests[0].request.formItems[0].type === 'file');
}

/* ---- code generation ---- */
{
  const payloads = [
    { method: 'GET', url: 'https://x.dev/a?b=1', headers: [{ key: 'Accept', value: 'application/json' }], bodyMode: 'none', rawBody: null, formItems: null },
    { method: 'POST', url: 'https://x.dev/a', headers: [{ key: 'Content-Type', value: 'application/json' }], bodyMode: 'raw', rawBody: '{"k":"v\'s"}', formItems: null },
    { method: 'POST', url: 'https://x.dev/f', headers: [], bodyMode: 'urlencoded', rawBody: null, formItems: [{ key: 'a', value: 'b c', type: 'text', filePath: '' }] },
    { method: 'PUT', url: 'https://x.dev/u', headers: [], bodyMode: 'formdata', rawBody: null, formItems: [{ key: 'f', value: '', type: 'file', filePath: 'C:/tmp/x.bin' }, { key: 't', value: 'v', type: 'text', filePath: '' }] },
  ];
  for (const lang of ['curl', 'fetch', 'axios', 'python', 'powershell', 'csharp', 'go']) {
    let ok = true;
    let err = '';
    for (const p of payloads) {
      try {
        const out = appCtx.genCode(lang, p);
        if (typeof out !== 'string' || out.length < 20 || !out.includes(p.url)) {
          ok = false;
          err = `bad output for ${p.method} ${p.bodyMode}`;
        }
      } catch (e) {
        ok = false;
        err = e.message;
      }
    }
    check(`codegen: ${lang}`, ok, err);
  }
}

/* ---- cookies ---- */
{
  const c = appCtx.parseSetCookie('sid=abc123; Path=/api; Max-Age=3600; Secure; HttpOnly', 'https://app.example.com/api/login');
  check('cookie: parse', c && c.name === 'sid' && c.path === '/api' && c.secure && c.httpOnly && c.hostOnly);
  check('cookie: foreign domain rejected', appCtx.parseSetCookie('t=1; Domain=evil.com', 'https://app.example.com/') === null);

  S.cookies = [];
  appCtx.storeCookiesFromResponse(
    { ok: true, headers: [['set-cookie', 'sid=abc; Path=/'], ['set-cookie', 'theme=dark; Domain=example.com; Path=/']] },
    'https://app.example.com/login'
  );
  check('cookie: stored + matched', S.cookies.length === 2 && appCtx.cookiesFor('https://app.example.com/users') === 'sid=abc; theme=dark');
  check('cookie: parent domain only', appCtx.cookiesFor('https://other.example.com/x') === 'theme=dark');
  appCtx.storeCookiesFromResponse({ ok: true, headers: [['set-cookie', 'sid=; Path=/; Max-Age=0']] }, 'https://app.example.com/logout');
  check('cookie: expiry deletes', S.cookies.length === 1);
}

/* ---- variables, chaining ---- */
{
  S.globals = [{ key: 'base', value: 'https://global.dev', enabled: true }, { key: 'g1', value: 'G', enabled: true }];
  S.environments = [{ id: 'e1', name: 'Dev', vars: [{ key: 'base', value: 'https://dev.dev', enabled: true }] }];
  S.activeEnvId = 'e1';
  check('vars: env overrides globals', appCtx.varMap(null).base === 'https://dev.dev' && appCtx.varMap(null).g1 === 'G');
  check('vars: extra wins', appCtx.varMap({ base: 'X' }).base === 'X');

  appCtx.setChain('Login', {
    ok: true,
    status: 201,
    headers: [['Content-Type', 'application/json'], ['X-Req-Id', 'r-9']],
    bodyText: '{"token":"tok_42","user":{"id":7,"roles":["admin","dev"]}}',
  });
  check('chain: body path', appCtx.applyEnv('Bearer {{res.Login.body.token}}') === 'Bearer tok_42');
  check('chain: nested array', appCtx.applyEnv('{{res.Login.body.user.roles.1}}') === 'dev');
  check('chain: status + header', appCtx.applyEnv('{{res.Login.status}}') === '201' && appCtx.applyEnv('{{res.Login.headers.x-req-id}}') === 'r-9');
  check('chain: last alias', appCtx.applyEnv('{{res.last.body.user.id}}') === '7');
  check('chain: unknown untouched', appCtx.applyEnv('{{res.Nope.body.x}}') === '{{res.Nope.body.x}}');
}

/* ---- CSV / .env / diff ---- */
{
  const rows = appCtx.parseCSV('name,city\n"Ali ""H""","Beirut, LB"\nSam,Paris\n');
  check('csv: quoting', rows.length === 2 && rows[0].name === 'Ali "H"' && rows[0].city === 'Beirut, LB');
  const envs = appCtx.parseDotEnv('# c\nexport API_KEY="secret 1"\nDB_URL=postgres://x\nBAD LINE\n');
  check('dotenv: parse', envs.length === 2 && envs[0].value === 'secret 1');
  const d = appCtx.diffLines('a\nb\nc\nd', 'a\nb\nX\nd');
  check('diff: trim + ops', d.prefix.length === 2 && d.suffix.length === 1 && JSON.stringify(d.ops) === JSON.stringify([['-', 'c'], ['+', 'X']]));
}

/* ---- scripts sandbox ---- */
{
  const res = {
    ok: true,
    status: 200,
    statusText: 'OK',
    timeMs: 42,
    size: 10,
    headers: [['content-type', 'application/json']],
    bodyText: '{"token":"t1","count":3}',
  };
  const results = appCtx.runTests(
    `pm.test("status ok", () => expect(pm.response.code).toBe(200));
     pm.test("fails", () => expect(pm.response.json().count).toBeGreaterThan(5));`,
    res,
    null
  );
  check('tests: pass/fail', results.length === 2 && results[0].ok && !results[1].ok);
  check('tests: script error captured', appCtx.runTests('syntax error(', res, null)[0].ok === false);

  const payload = { method: 'GET', url: 'https://x.dev/a', headers: [], bodyMode: 'none', rawBody: null };
  const pre = appCtx.runPreScript('pm.request.headers.set("X-One", "2"); pm.request.method = "post";', payload, null);
  check('pre-script mutates payload', pre.ok && payload.headers[0].value === '2' && payload.method === 'POST');
}

/* ---- fuzzy palette ---- */
{
  check('fuzzy: match', appCtx.fuzzyScore('guser', 'GET Users / Get user by id') >= 0);
  check('fuzzy: no match', appCtx.fuzzyScore('zzz', 'GET Users') === -1);
  const a = appCtx.fuzzyScore('login', 'Auth / Login');
  const b = appCtx.fuzzyScore('login', 'Legacy odd gin thing');
  check('fuzzy: contiguous scores higher', a > b);
}

/* ================= main process (main.js) ================= */

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const electronStub = {
  app: { setName: () => {}, whenReady: () => ({ then: () => {} }), on: () => {}, isPackaged: true, getPath: () => '.' },
  BrowserWindow: class { static fromWebContents() { return null; } static getAllWindows() { return []; } },
  Menu: { setApplicationMenu: () => {} },
  ipcMain: { handle: () => {} },
  dialog: {},
  session: { defaultSession: { resolveProxy: async () => 'DIRECT' } },
};
const mainCtx = {
  require: (name) => (name === 'electron' ? electronStub : require(name)),
  console,
  Buffer,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  Date,
  JSON,
  Math,
  Promise,
  process,
};
vm.createContext(mainCtx);
vm.runInContext(mainSrc, mainCtx, { filename: 'main.js' });

/* ---- Digest (RFC 2617 vector) ---- */
{
  const ch = mainCtx.parseDigestChallenge(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"'
  );
  const auth = mainCtx.buildDigestAuth(ch, 'GET', new URL('http://www.nowhere.org/dir/index.html'), 'Mufasa', 'Circle Of Life', '0a4f113b');
  const m = auth.match(/response="([a-f0-9]+)"/);
  check('digest: RFC 2617 response hash', m && m[1] === '6629fae49393a05397450978507c4ef1', m && m[1]);
  check('digest: attributes', auth.includes('qop=auth') && auth.includes('nc=00000001') && auth.includes('opaque='));
}

/* ---- AWS SigV4 shape ---- */
{
  const headers = { accept: '*/*', 'content-type': 'application/json' };
  mainCtx.signAwsV4(
    { method: 'GET', url: 'https://api.example.amazonaws.com/items?b=2&a=1', auth: { accessKey: 'AKIDEXAMPLE', secretKey: 'SECRET', region: 'us-east-1', service: 'execute-api' } },
    headers,
    null
  );
  check('sigv4: amz headers', /^\d{8}T\d{6}Z$/.test(headers['x-amz-date']) && /^[a-f0-9]{64}$/.test(headers['x-amz-content-sha256']));
  check(
    'sigv4: authorization',
    headers.authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/') &&
      headers.authorization.includes('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date') &&
      /Signature=[a-f0-9]{64}$/.test(headers.authorization)
  );
}

/* ---- proxy helpers ---- */
{
  const p = mainCtx.parseProxyUrl('http://user:p%40ss@proxy.corp:3128');
  check('proxy: parse with auth', p && p.host === 'proxy.corp' && p.port === 3128 && p.auth && p.auth.startsWith('Basic '));
  check('proxy: parse bare host', mainCtx.parseProxyUrl('127.0.0.1:8888').port === 8888);
  check('proxy: bypass match', mainCtx.hostInBypass('api.internal.dev', 'localhost, .internal.dev') === true);
  check('proxy: bypass no match', mainCtx.hostInBypass('api.example.com', 'localhost, .internal.dev') === false);
  check('proxy: bypass wildcard', mainCtx.hostInBypass('anything.dev', '*') === true);
}

/* ---- client cert matching ---- */
{
  const certs = [{ host: '*.example.com', type: 'pfx', pfxPath: 'x.pfx' }, { host: 'api.other.dev', type: 'pem' }];
  check('cert: wildcard match', mainCtx.certFor('api.example.com', certs) === certs[0]);
  check('cert: exact match', mainCtx.certFor('api.other.dev', certs) === certs[1]);
  check('cert: no match', mainCtx.certFor('nope.dev', certs) === null);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASSED');
process.exit(failures ? 1 : 0);
