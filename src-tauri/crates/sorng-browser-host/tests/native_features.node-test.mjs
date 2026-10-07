// Synthetic DOM execution only: no browser launch, credentials or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const factory = readFileSync(new URL('../src/native_login.js', import.meta.url), 'utf8')
  .replace('/* REVIEWED_DOM_HELPERS */', readFileSync(new URL('../../sorng-protocols/src/autologin/common/dom.js', import.meta.url), 'utf8'))
  .replace('/* REVIEWED_PORKBUN_ADAPTER */', readFileSync(new URL('../../sorng-protocols/src/autologin/apps/porkbun.js', import.meta.url), 'utf8'))
  .replace('/* REVIEWED_EXCHANGE_ADAPTER */', readFileSync(new URL('../../sorng-protocols/src/autologin/apps/exchange_ecp.js', import.meta.url), 'utf8'))
  .replace('/* REVIEWED_VODAFONE_ADAPTER */', readFileSync(new URL('../../sorng-protocols/src/autologin/apps/vodafone_smart_router.js', import.meta.url), 'utf8'));
const form = '<form method="post" action="/login"><input name="username" autocomplete="username"><input type="password" name="password"><button>Log in</button></form>';

test('explicit manual mode installs without observers, requests, or credential delivery', () => {
  const dom = new JSDOM(form, {url:'https://fixture.test/login', runScripts:'outside-only'});
  try {
    const {window} = dom;
    window.setInterval = () => {throw new Error('manual must not poll');};
    window.MutationObserver = class {constructor() {throw new Error('manual must not watch forms');}};
    const deliver = window.eval(factory)(() => {throw new Error('manual must not request credentials');}, 'manual');
    assert.equal(typeof deliver, 'function');
    assert.equal(deliver('https://fixture.test', 'synthetic-user', 'synthetic-password', true, Date.now()+1000), false);
    assert.equal(window.document.querySelector('[type=password]').value, '');
  } finally {dom.window.close();}
});

function fixture(html = form, url = 'https://fixture.test/login', adapter = 'generic-form', setup = () => {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url, runScripts:'outside-only', pretendToBeVisual:true});
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {get() {return this.parentElement;}});
  let timer;
  window.setInterval = callback => { timer = callback; return 1; };
  window.clearInterval = () => {};
  let requests = 0;
  const globals = Object.getOwnPropertyNames(window);
  const deliver = window.eval(factory)(() => { requests++; }, adapter);
  assert.deepEqual(Object.getOwnPropertyNames(window), globals, 'no page-visible native bridge');
  window.document.body.innerHTML = html;
  setup(window);
  let submits = 0;
  window.document.addEventListener('submit', event => { event.preventDefault(); submits++; });
  timer();
  return {
    dom, window, deliver, tick:()=>timer(),
    get requests() {return requests;}, get submits() {return submits;},
    send(origin='https://fixture.test', autoSubmit=true, expires=Date.now()+1000) {
      return deliver(origin, 'synthetic-user', 'synthetic-password', autoSubmit, expires);
    },
    close() {dom.window.close();},
  };
}

test('factory installs before the document; delayed form fills and submits exactly once', () => {
  const f = fixture('');
  try {
    assert.equal(f.requests, 0);
    f.window.document.body.innerHTML = form;
    f.tick();
    assert.equal(f.requests, 1);
    assert.equal(f.send(), true);
    assert.equal(f.window.document.querySelector('[type=password]').value, 'synthetic-password');
    assert.equal(f.submits, 1);
    assert.equal(f.send(), false);
    f.tick();
    assert.equal(f.requests, 1);
    assert.equal(f.submits, 1);
  } finally {f.close();}
});

test('disclosure consent does not imply submission consent', () => {
  const f=fixture();
  try {assert.equal(f.send('https://fixture.test',false),true); assert.equal(f.submits,0);} finally {f.close();}
});

for (const [label, html] of [
  ['cross-origin action',form.replace('/login','https://other.test/login')],
  ['GET form',form.replace('method="post"','method="get"')],
  ['child target',form.replace('method="post"','method="post" target="child"')],
  ['inherited child target','<base target="child">'+form],
  ['password creation control',form.replace('name="password"','name="password" autocomplete="new-password"')],
  ['cross-origin submit override',form.replace('<button>','<button formaction="https://other.test">')],
  ['GET submit override',form.replace('<button>','<button formmethod="get">')],
  ['child submit override',form.replace('<button>','<button formtarget="child">')],
  ['ambiguous password fields',form.replace('<button>','<input type="password"><button>')],
]) {
  test(`rejects ${label} before requesting credentials`,()=> {
    const f=fixture(html);
    try {assert.equal(f.requests,0); assert.equal(f.send(),false); assert.equal(f.submits,0);} finally {f.close();}
  });
}

test('origin and expired delivery cannot write credentials',()=> {
  for (const [origin, expires] of [['https://other.test',Date.now()+1000],['https://fixture.test',Date.now()-1000],['https://fixture.test',NaN],['https://fixture.test',Infinity]]) {
    const f=fixture();
    try {assert.equal(f.send(origin,true,expires),false); assert.equal(f.window.document.querySelector('[type=password]').value,'');} finally {f.close();}
  }
});

test('same-origin child forms are never searched',()=> {
  const f=fixture('<iframe></iframe>');
  try {
    f.window.document.querySelector('iframe').contentDocument.body.innerHTML=form;
    f.tick();
    assert.equal(f.requests,0);
    assert.equal(f.send(),false);
  } finally {f.close();}
});

test('field moved into a child document during username input does not receive password',()=> {
  const f=fixture(form+'<iframe></iframe>');
  try {
    const doc=f.window.document;
    const pw=doc.querySelector('[type=password]');
    doc.querySelector('[name=username]').addEventListener('input',()=>doc.querySelector('iframe').contentDocument.body.appendChild(pw));
    assert.equal(f.send(),false);
    assert.equal(pw.value,'');
    assert.equal(f.submits,0);
  } finally {f.close();}
});

test('changed action, replaced fields and pagehide invalidate captured form',()=> {
  for (const change of [
    f=>{f.window.document.querySelector('form').action='https://other.test';},
    f=>{const el=f.window.document.querySelector('[type=password]');el.replaceWith(el.cloneNode());},
    f=>f.window.dispatchEvent(new f.window.Event('pagehide')),
  ]) {
    const f=fixture();
    try {change(f);assert.equal(f.send(),false);assert.equal(f.submits,0);} finally {f.close();}
  }
});

test('MFA and CAPTCHA controls stay human while password fill remains active',()=> {
  for (const challenge of ['<input autocomplete="one-time-code">','<input name="captcha">']) {
    const f=fixture(form+challenge);
    try {assert.equal(f.send(),true);assert.equal(f.submits,0);assert.equal(f.window.document.querySelector('body > input').value,'');} finally {f.close();}
  }
});

test('credential text is data, not executable script source',()=> {
  const f=fixture();
  try {
    const text='\");globalThis.leaked=true;//\\n<script>';
    assert.equal(f.deliver('https://fixture.test',text,text,false,Date.now()+1000),true);
    assert.equal(f.window.document.querySelector('[type=password]').value,text.replace(/[\r\n]/g,''));
    assert.equal(f.window.leaked,undefined);
  } finally {f.close();}
});

test('HTTP documents never request credentials',()=> {
  const f=fixture(form,'http://fixture.test/login');
  try {assert.equal(f.requests,0);assert.equal(f.send(),false);} finally {f.close();}
});

const porkbun = '<div id="accountLoginContainer"><form id="loginForm" method="post" action="/blank" target="lame_login_iframe" data-pbrf>'
  + '<input id="loginUsername" name="loginUsername" autocomplete="username">'
  + '<input id="loginPassword" name="loginPassword" type="password"></form>'
  + '<div id="accountLoginButtonContainer"><button id="accountLoginButton" onclick="logInExec();">Log in</button></div></div>';

test('reviewed Porkbun adapter uses its real button without posting to the dummy iframe',()=> {
  const f=fixture(porkbun,'https://porkbun.com/account/login','porkbun');
  try {
    let clicks=0;
    f.window.logIn=()=>{};
    f.window.logInExec=()=>{clicks++;};
    f.window.document.querySelector('button').onclick=f.window.logInExec;
    f.tick();
    assert.equal(f.requests,1);
    assert.equal(f.send('https://porkbun.com'),true);
    assert.equal(clicks,1);
    assert.equal(f.submits,0);
    assert.equal(f.window.document.querySelector('[type=password]').value,'synthetic-password');
    assert.equal(f.send('https://porkbun.com'),false);
  } finally {f.close();}
});

test('Porkbun changed handlers and unreviewed action fail closed',()=> {
  for (const change of [f=>{f.window.logIn=()=>{};},f=>{f.window.document.querySelector('form').action='/other';}]) {
    const f=fixture(porkbun,'https://porkbun.com/account/login','porkbun');
    try {
      f.window.logIn=()=>{};
      f.window.logInExec=()=>{};
      f.window.document.querySelector('button').onclick=f.window.logInExec;
      f.tick();
      assert.equal(f.requests,1);
      change(f);
      assert.equal(f.send('https://porkbun.com'),false);
      assert.equal(f.window.document.querySelector('[type=password]').value,'');
    } finally {f.close();}
  }
});

test('unsupported selected applications never discover or fill the generic form',()=> {
  for (const selected of ['unsupported','google-account','cpanel','custom','']) {
    const f=fixture(form,'https://fixture.test/login',selected);
    try {assert.equal(f.requests,0);assert.equal(f.send(),false);assert.equal(f.window.document.querySelector('[type=password]').value,'');} finally {f.close();}
  }
});

test('selected Porkbun never falls back to a generic form at another origin or path',()=> {
  for (const url of ['https://fixture.test/login','https://porkbun.com/other']) {
    const f=fixture(form,url,'porkbun');
    try {assert.equal(f.requests,0);assert.equal(f.send(new URL(url).origin),false);} finally {f.close();}
  }
});

function exchangeForm(destination = '/owa/') {
  return '<form name="logonForm" method="post" action="/owa/auth.owa">'
    + `<input type="hidden" name="destination" value="${destination}">`
    + '<input id="username" name="username"><input id="password" name="password" type="password">'
    + '<div class="signinbutton" role="button" onclick="clkLgn();">Sign in</div></form>';
}
function setupExchange(window) {
  window.nativeFixtureClicks = 0;
  window.clkLgn = () => {window.nativeFixtureClicks++;};
  window.document.querySelector('.signinbutton').onclick = window.clkLgn;
  Object.defineProperty(window, '__sorng_map_navigation', {get() {throw new Error('no legacy mapping access');}});
}
for (const [adapter, destination] of [['exchange-ecp','/ecp/'], ['exchange-owa','/owa/shared@example.test/']]) {
  test(`${adapter} uses the reviewed real-origin handler and leaves destination intact`, () => {
    const f = fixture(exchangeForm(destination), 'https://fixture.test/owa/auth/logon.aspx', adapter, setupExchange);
    try {
      assert.equal(f.requests, 1);
      assert.equal(f.send(), true);
      assert.equal(f.window.nativeFixtureClicks, 1);
      assert.equal(f.window.document.querySelector('[name=destination]').value, destination);
      assert.equal(f.window.document.querySelector('[type=password]').value, 'synthetic-password');
      assert.equal(f.send(), false);
    } finally {f.close();}
  });
  test(`${adapter} keeps submit consent distinct and rejects handler replacement`, () => {
    for (const changed of [false, true]) {
      const f = fixture(exchangeForm(destination), 'https://fixture.test/owa/auth/logon.aspx', adapter, setupExchange);
      try {
        if (changed) f.window.clkLgn = () => {};
        assert.equal(f.send('https://fixture.test', false), !changed);
        assert.equal(f.window.nativeFixtureClicks, 0);
        assert.equal(f.window.document.querySelector('[type=password]').value, changed ? '' : 'synthetic-password');
      } finally {f.close();}
    }
  });
}
for (const [label, html, url] of [
  ['foreign destination', exchangeForm('https://other.test/owa/'), 'https://fixture.test/owa/auth/logon.aspx'],
  ['wrong selected destination', exchangeForm('/ecp/'), 'https://fixture.test/owa/auth/logon.aspx'],
  ['legacy routing query', exchangeForm().replace('/owa/auth.owa', '/owa/auth.owa?__sorng_generation_v1=00000000000000000000000000000000'), 'https://fixture.test/owa/auth/logon.aspx'],
  ['password expiry', exchangeForm(), 'https://fixture.test/owa/auth/logon.aspx?reason=2'],
  ['duplicate destination', exchangeForm().replace('</form>', '<input type="hidden" name="destination" value="/owa/"></form>'), 'https://fixture.test/owa/auth/logon.aspx'],
  ['GET method', exchangeForm().replace('method="post"','method="get"'), 'https://fixture.test/owa/auth/logon.aspx'],
  ['cleartext', exchangeForm(), 'http://fixture.test/owa/auth/logon.aspx'],
  ['MFA control', exchangeForm().replace('</form>', '<input autocomplete="one-time-code"></form>'), 'https://fixture.test/owa/auth/logon.aspx'],
]) {
  test(`native Exchange rejects ${label} before credential request`, () => {
    const f = fixture(html, url, 'exchange-owa', setupExchange);
    try {assert.equal(f.requests, 0); assert.equal(f.send(), false);} finally {f.close();}
  });
}

const vodafone = '<div id="mainbody"><div id="logindiv"><input id="username" type="text">'
  + '<input id="userpwd" type="password"><input id="loginbtn" name="login" type="button" onclick="SubmitForm();"></div></div>';
function setupVodafone(window) {
  window.nativeFixtureClicks = 0;
  window.SubmitForm = () => {window.nativeFixtureClicks++;};
  window.document.querySelector('#loginbtn').onclick = window.SubmitForm;
}
test('native Vodafone uses reviewed form-less handler, not an invented POST', () => {
  const f = fixture(vodafone, 'https://fixture.test/', 'vodafone-smart-router-3', setupVodafone);
  try {
    assert.equal(f.requests, 1);
    assert.equal(f.send(), true);
    assert.equal(f.window.nativeFixtureClicks, 1);
    assert.equal(f.submits, 0);
    assert.equal(f.window.document.querySelector('#userpwd').value, 'synthetic-password');
  } finally {f.close();}
});
test('native Vodafone rejects duplicates, changed handlers, and HTTP', () => {
  for (const [html, url, change] of [
    [vodafone + '<input id="username">', 'https://fixture.test/', false],
    [vodafone, 'http://fixture.test/', false],
    [vodafone, 'https://fixture.test/', true],
  ]) {
    const f = fixture(html, url, 'vodafone-smart-router-3', setupVodafone);
    try {
      if (change) f.window.SubmitForm = () => {};
      else assert.equal(f.requests, 0);
      assert.equal(f.send(new URL(url).origin), false);
      assert.equal(f.window.document.querySelector('#userpwd').value, '');
    } finally {f.close();}
  }
});
