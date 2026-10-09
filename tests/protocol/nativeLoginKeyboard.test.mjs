import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(resolve(base,"native_login_profiles.rs"),"utf8");
const modules = [...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g)]
  .map(([,path]) => readFileSync(resolve(base,path),"utf8")).join("");
const source = readFileSync(resolve(base,"native_login_client.js"),"utf8")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () => readFileSync(resolve(base,"native_login_typing.js"),"utf8"));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));

function fixture(t, manual = false, google = false, visibilityToggle = false) {
  const dom = new JSDOM(google
    ? '<form method="POST"><input id="identifierId" name="identifier" type="text" autocomplete="username"><input name="hiddenPassword" type="password" aria-hidden="true" tabindex="-1"><button name="action" id="identifierNext">Next</button></form>'
    : '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>',{
    url:google ? "https://accounts.google.com/v3/signin/identifier" : "https://device.test/login",runScripts:"outside-only",
  });
  const win = dom.window, doc = win.document;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  Object.defineProperty(win.HTMLElement.prototype,"offsetParent",{get(){ return this.parentElement; }});
  win.HTMLElement.prototype.getClientRects = function(){ return this.isConnected ? [{width:100,height:20}] : []; };
  Object.defineProperty(win.crypto,"subtle",{value:webcrypto.subtle});
  win.TextEncoder = TextEncoder;
  const listeners = new Map(), original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (["keydown","beforeinput","input"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type,[]);
      listeners.get(type).push(callback);
    }
    return original(type,callback,...args);
  };
  const values = { username:google ? "operator@example.test" : "operator", password:"pA55@word" };
  const signals = [], keys = [];
  let delivered, submits = 0;
  const until = Date.now()+15000;
  const options = {version:1,fillDelayMs:30,submitDelayMs:50,detectionTimeoutMs:8000,submit:true,fields:[]};
  let identifierValue;
  doc.addEventListener("submit",event=>{event.preventDefault();submits++;});
  if (google) doc.querySelector("button").onclick = event => {
    event.preventDefault();
    identifierValue = doc.getElementById("identifierId").value;
    assert.equal(doc.querySelector('[name="hiddenPassword"]').value, "");
    win.history.replaceState(null, "", "/v3/signin/challenge/pwd");
    doc.body.innerHTML = '<form method="POST"><input id="password" name="Passwd" type="password">' +
      (visibilityToggle ? '<input type="checkbox" id="show-password" aria-labelledby="show-password-label"><label id="show-password-label" for="show-password">Show password</label>' : '') +
      '<button id="passwordNext">Next</button></form>';
  };
  function key(field, index) {
    const input = doc.getElementById(google && field === "username" ? "identifierId" : field), unit = values[field][index];
    const event = {target:input,isTrusted:true,key:unit,data:unit,inputType:"insertText",preventDefault(){this.prevented=true;}};
    for (const type of ["keydown","beforeinput"]) for(const fn of listeners.get(type)||[]) fn(event);
    if (event.prevented) return;
    // Only the model driver writes; the production path calls send_key_event.
    input.value += unit;
    input.setSelectionRange(input.value.length,input.value.length);
    for(const fn of listeners.get("input")||[]) fn(event);
    keys.push([field,index]);
  }
  const notify = event => {
    signals.push(event);
    setTimeout(()=>{
      if(event.startsWith("type|")) {
        if(manual) return;
        const [,action,stage,field,n] = event.split("|"), index=Number(n), role=`type|${stage}|${field}`;
        if(action === "start") delivered.nativeTyping("probe",0,until,false,role);
        if(action === "key") { key(field,index); delivered.nativeTyping("probe",index+1,until,false,role); }
      } else if(google && ["identifier","password"].includes(event)) {
        delivered("https://accounts.google.com",event==="identifier"?values.username:"",event==="password"?values.password:"",true,until,event);
      } else if(["form-prepare","form","form-submit"].includes(event)) {
        delivered("https://device.test",event==="form"?values.username:"",event==="form"?values.password:"",true,until,{...options,fields:[]},event);
      }
    },0);
  };
  delivered = win.eval(source)(notify,google ? {provider:"google-account"} : {selectors:{username:"#username",password:"#password",submit:"#login"}},google ? "google-account" : "modular-form",true);
  return {doc,win,signals,keys,values,until,delivered,submits:()=>submits,identifierValue:()=>identifierValue};
}

for (const visibilityToggle of [false, true]) {
test(`Google implicit Next buttons work with production native-keyboard mode across SPA stages (visibility toggle: ${visibilityToggle})`, async t => {
  const f=fixture(t,false,true,visibilityToggle);
  for(let i=0;i<160&&f.submits()===0;i++) await delay(50);
  assert.equal(f.submits(),1,JSON.stringify(f.signals));
  assert.equal(f.identifierValue(),f.values.username);
  assert.equal(f.doc.getElementById("password").value,f.values.password);
  assert.equal(f.keys.length,f.values.username.length+f.values.password.length);
  assert.equal(f.signals.filter(s=>s==="identifier").length,1);
  assert.equal(f.signals.filter(s=>s==="password").length,1);
  assert.equal(f.signals.at(-1),"form-completed");
  assert.equal(f.signals.some(s=>s.includes(f.values.password)),false);
  if (visibilityToggle) assert.equal(f.doc.getElementById("show-password").checked, false);
});
}

test("native production form uses paced keyboard receipts for both username and password", async t => {
  const f=fixture(t);
  for(let i=0;i<100&&f.submits()===0;i++) await delay(50);
  assert.equal(f.submits(),1,JSON.stringify(f.signals));
  assert.equal(f.doc.getElementById("username").value,f.values.username);
  assert.equal(f.doc.getElementById("password").value,f.values.password);
  assert.equal(f.keys.length,f.values.username.length+f.values.password.length);
  assert.ok(f.signals.includes("form-submit"));
  assert.equal(f.signals.some(s=>s.includes(f.values.password)),false);
});

test("native credential typing cannot overwrite manual edits while awaiting keyboard grant", async t => {
  const f=fixture(t,true);
  for(let i=0;i<40&&!f.signals.some(s=>s.startsWith("type|start"));i++) await delay(50);
  const input=f.doc.getElementById("username");
  input.value="manual-user";
  f.delivered.nativeTyping("probe",0,f.until,false,"type|form|username");
  await delay(100);
  assert.equal(f.doc.getElementById("username").value,"manual-user");
  assert.equal(f.doc.getElementById("password").value,"");
  assert.equal(f.submits(),0);
  assert.equal(f.signals.some(s=>s.startsWith("type|key")),false);
});
