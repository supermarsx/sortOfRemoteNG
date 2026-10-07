import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const source=readFileSync(new URL('../src/native_google_login.js',import.meta.url),'utf8')
  .replace('/* REVIEWED_DOM_HELPERS */',readFileSync(new URL('../../sorng-protocols/src/autologin/common/dom.js',import.meta.url),'utf8'))
  .replace('/* REVIEWED_GOOGLE_CLIENT */',readFileSync(new URL('../../sorng-protocols/src/google_autologin_client.js',import.meta.url),'utf8'));
const identifier='<input id="identifierId" name="identifier" type="email"><div id="identifierNext"><button type="button">Next</button></div>';
const password='<input name="Passwd" type="password"><div id="passwordNext"><button type="button">Next</button></div>';

function fixture(path='/v3/signin/identifier',html=identifier,origin='https://accounts.google.com') {
  const dom=new JSDOM('<!doctype html><body></body>',{url:origin+path,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
  w.HTMLElement.prototype.getClientRects=function(){return this.style.display==='none'?[]:[{width:20,height:20}];};
  const timers=new Map();let nextTimer=0;
  w.setInterval=fn=>{const id=++nextTimer;timers.set(id,fn);return id;};
  w.clearInterval=id=>timers.delete(id);
  w.fetch=()=>{throw new Error('Native adapter must never use fetch');};
  const events=[];
  const globals=Object.getOwnPropertyNames(w);
  const deliver=w.eval(source)(stage=>events.push(stage));
  assert.deepEqual(Object.getOwnPropertyNames(w),globals);
  assert.equal(w.__sorng_google_login,undefined);
  w.document.body.innerHTML=html;
  const tick=async()=> {for(const fn of [...timers.values()])fn();await new Promise(resolve=>setImmediate(resolve));};
  return {dom,w,deliver,events,tick,close(){dom.window.close();},
    send(stage,auto=true,deadline=Date.now()+2000){return deliver('https://accounts.google.com',stage==='identifier'?'synthetic@example.test':'',stage==='password'?'synthetic-secret':'',auto,deadline,stage);},
    password(){w.history.replaceState({},'', '/v3/signin/challenge/pwd');w.document.body.innerHTML=password;},
  };
}

test('native Google flows from email Next to password Next with separate requests and no fetch/global bridge',async()=> {
  const f=fixture();
  try {
    let emailClicks=0,passwordClicks=0;
    f.w.document.querySelector('button').onclick=()=>{emailClicks++;f.password();f.w.document.querySelector('button').onclick=()=>passwordClicks++;};
    await f.tick();
    assert.deepEqual(f.events,['identifier']);
    assert.equal(f.send('identifier'),true);
    await f.tick();
    assert.equal(emailClicks,1);
    assert.deepEqual(f.events,['identifier','password']);
    assert.equal(f.w.document.querySelector('input').value,'');
    assert.equal(f.send('password'),true);
    await f.tick();
    assert.equal(f.w.document.querySelector('input').value,'synthetic-secret');
    assert.equal(passwordClicks,1);
    assert.deepEqual(f.events,['identifier','password','google-completed']);
    assert.equal(f.send('password'),false);
    await f.tick();assert.equal(passwordClicks,1);
  } finally {f.close();}
});

test('identifier delivery rejects a password and wrong-stage or expired replies',async()=> {
  const f=fixture();
  try {
    await f.tick();
    assert.equal(f.deliver('https://accounts.google.com','user','secret',true,Date.now()+2000,'identifier'),false);
    assert.equal(f.send('password'),false);
    assert.equal(f.send('identifier',true,Date.now()-1),false);
    assert.equal(f.w.document.querySelector('input').value,'');
  } finally {f.close();}
});

test('fill-only identifier consent does not click Next or request password',async()=> {
  const f=fixture();let clicks=0;
  try {
    f.w.document.querySelector('button').onclick=()=>clicks++;
    await f.tick();assert.equal(f.send('identifier',false),true);await f.tick();
    assert.equal(f.w.document.querySelector('input').value,'synthetic@example.test');
    assert.equal(clicks,0);assert.deepEqual(f.events,['identifier','google-completed']);
  } finally {f.close();}
});

test('new password document requests only password; native host must validate prior identifier grant',async()=> {
  const f=fixture('/v3/signin/challenge/pwd',password);let clicks=0;
  try {
    f.w.document.querySelector('button').onclick=()=>clicks++;
    await f.tick();assert.deepEqual(f.events,['password']);
    assert.equal(f.send('password'),true);await f.tick();assert.equal(clicks,1);
  } finally {f.close();}
});

for(const [name,path,html,origin] of [
  ['another origin','/v3/signin/identifier',identifier,'https://google.example.test'],
  ['MFA','/v3/signin/challenge/totp',password],
  ['recovery','/v3/signin/recovery',identifier],
  ['CAPTCHA','/v3/signin/identifier',identifier+'<input name="captcha">'],
  ['unsafe submit action','/v3/signin/identifier','<form action="https://other.test" method="post">'+identifier.replace('type="button"','type="submit"')+'</form>'],
  ['GET submit form','/v3/signin/identifier','<form method="get">'+identifier.replace('type="button"','type="submit"')+'</form>'],
  ['ambiguous fields','/v3/signin/identifier',identifier+identifier],
]) {
  test(`native Google does not request credentials for ${name}`,async()=> {
    const f=fixture(path,html,origin);
    try {await f.tick();assert.deepEqual(f.events,[]);}finally{f.close();}
  });
}

test('navigation or iframe relocation during filling stops submission',async()=> {
  for(const change of ['pagehide','frame','button']) {
    const f=fixture();let clicks=0;
    try {
      const field=f.w.document.querySelector('input');
      const button=f.w.document.querySelector('button');button.onclick=()=>clicks++;
      field.addEventListener('focus',()=> {
        if(change==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
        if(change==='button')button.replaceWith(button.cloneNode(true));
        if(change==='frame'){const frame=f.w.document.createElement('iframe');f.w.document.body.append(frame);frame.contentDocument.body.append(field);}
      },{once:true});
      await f.tick();f.send('identifier');await f.tick();
      assert.equal(field.value,'');assert.equal(clicks,0);assert.ok(f.events.includes('google-rejected'));
    } finally {f.close();}
  }
});

test('password replacement and render gaps use the one issued grant without retrying',async()=> {
  const f=fixture('/v3/signin/challenge/pwd',password);
  try {
    await f.tick();
    const old=f.w.document.querySelector('input');f.w.document.body.innerHTML='';
    assert.equal(f.send('password'),true);await f.tick();
    assert.equal(old.value,'');
    f.w.document.body.innerHTML=password;let clicks=0;f.w.document.querySelector('button').onclick=()=>clicks++;
    await f.tick();assert.equal(clicks,1);assert.equal(f.w.document.querySelector('input').value,'synthetic-secret');
    assert.equal(f.events.filter(value=>value==='password').length,1);
  } finally {f.close();}
});

test('legacy browser with an ordinary module global still installs its reviewed API',()=> {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://legacy.test',runScripts:'outside-only'});
  try {
    dom.window.module={exports:{}};
    dom.window.eval(readFileSync(new URL('../../sorng-protocols/src/google_autologin_client.js',import.meta.url),'utf8'));
    assert.equal(typeof dom.window.__sorng_google_login.runWhenReady,'function');
    assert.equal(typeof dom.window.module.exports,'object');
    dom.window.__sorng_google_login.cancel();
  } finally {dom.window.close();}
});
