// DOM-only fixture contract checks. These are not native TLS/storage evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('src/page.html');
const reviewedGoogle = read('../../src/native_google_login.js')
  .replace('/* REVIEWED_DOM_HELPERS */', () => read('../../../sorng-protocols/src/autologin/common/dom.js'))
  .replace('/* REVIEWED_GOOGLE_CLIENT */', () => read('../../../sorng-protocols/src/google_autologin_client.js'));
// Match the current renderer's form_client_source(), not a copied adapter.
const manifest = read('../../src/native_login_profiles.rs').split(');')[0];
const modules = [...manifest.matchAll(/include_str!\("([^"]+)"\)/g)]
  .map(([, path]) => read(`../../src/${path}`)).join('');
assert.ok(modules.length > 0);
const currentClient = read('../../src/native_login_client.js')
  .replace('/* REVIEWED_FORM_MODULES */', () => modules);
const origin = 'https://accounts.google.com';

function fixture(t, source, change = () => {}) {
  const dom = new JSDOM(page, {url: `${origin}/v3/signin/identifier`, runScripts: 'outside-only'});
  const w = dom.window;
  let clock = 1_000_000, nextId = 0;
  const jobs = new Map(), signals = [], proofs = [];
  const schedule = (callback, ms, interval) => {
    const id = ++nextId;
    jobs.set(id, {callback, at: clock + Math.max(1, ms || 0), interval});
    return id;
  };
  w.setTimeout = (callback, ms) => schedule(callback, ms, 0);
  w.setInterval = (callback, ms) => schedule(callback, ms, Math.max(1, ms || 0));
  w.clearTimeout = w.clearInterval = id => jobs.delete(id);
  w.Date.now = () => clock;
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w, 'crypto', {value: webcrypto});
  Object.defineProperty(w, 'isSecureContext', {value: true});
  // JSDOM has no layout; mirror the existing native-client harness's shim.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {get() {return this.parentElement;}});
  w.HTMLElement.prototype.getClientRects = function() {return this.isConnected ? [{width:100,height:20}] : [];};
  w.fetch = (url, options) => {
    assert.equal(url, '/proof', 'no provider or external network calls');
    assert.equal(options.method, 'POST');
    proofs.push(JSON.parse(options.body));
    // Stop before the fixture's infinite native revocation pulse loop.
    return new Promise(() => {});
  };
  change(w.document.querySelector('form'));
  w.eval(w.document.querySelector('script').textContent);
  const deliver = w.eval(source)(stage => signals.push(stage), {provider: 'google-account'}, 'google-account');
  t.after(() => {
    w.dispatchEvent(new w.Event('pagehide'));
    jobs.clear();
    w.close();
  });
  return {
    w, signals, proofs,
    send(stage) {
      return deliver(origin, stage === 'identifier' ? 'synthetic@example.test' : '',
        stage === 'password' ? 'synthetic-local-only' : '', true, clock + 2000, stage);
    },
    async advance(ms) {
      const end = clock + ms;
      for (let count = 0; count < 1000; count++) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due;
        clock = job.at;
        if (job.interval) job.at += job.interval;
        else jobs.delete(id);
        job.callback();
        // Flush DOM observers, promise continuations, and real WebCrypto.
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      clock = end;
      await new Promise(resolve => setTimeout(resolve, 1));
    },
  };
}

for (const [name, source, completed] of [
  ['reviewed Google helper', reviewedGoogle, 'google-completed'],
  ['current renderer bundle', currentClient, 'form-completed'],
]) {
  test(`TLS page completes both stages with ${name}`, async t => {
    const f = fixture(t, source);
    const form = f.w.document.querySelector('form');
    assert.equal(form.getAttribute('method'), 'post');
    assert.equal(form.getAttribute('action'), '/v3/signin/identifier');
    await f.advance(700);
    assert.deepEqual(f.signals, ['identifier']);
    assert.equal(f.send('identifier'), true);
    await f.advance(1200);
    assert.equal(f.w.location.pathname, '/v3/signin/challenge/pwd');
    assert.equal(f.w.document.querySelector('form'), form, 'stage replacement retains the safe form');
    assert.equal(form.method, 'post');
    assert.equal(form.action, `${origin}/v3/signin/identifier`);
    assert.deepEqual(f.signals, ['identifier', 'password']);
    assert.equal(f.send('password'), true);
    await f.advance(700);
    assert.deepEqual(f.signals, ['identifier', 'password', completed]);
    assert.equal(f.proofs.length, 1);
    assert.equal(f.proofs[0].login, true);
    assert.equal(f.proofs[0].origin, origin);
    assert.equal(f.send('password'), false, 'grants remain single-use');
  });
}

test('reviewed helper reproduces zero grants for the original default-GET form', async t => {
  const f = fixture(t, reviewedGoogle, form => form.removeAttribute('method'));
  await f.advance(1200);
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.proofs, []);
  assert.equal(f.send('identifier'), false);
});

for (const [name, source] of [['reviewed Google helper', reviewedGoogle], ['current renderer bundle', currentClient]]) {
  test(`${name} reproduces zero grants when the identifier type attribute is absent`, async t => {
    const f = fixture(t, source, form => form.querySelector('input').removeAttribute('type'));
    await f.advance(1200);
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.proofs, []);
    assert.equal(f.send('identifier'), false);
  });

  test(`${name} still rejects a cross-origin POST fixture`, async t => {
    const f = fixture(t, source, form => form.action = 'https://other.test/signin');
    await f.advance(1200);
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.proofs, []);
    assert.equal(f.send('identifier'), false);
  });
}
