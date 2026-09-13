// Synthetic installed-browser acceptance; no app process, account, profile,
// package download, or real upstream is used. Node 22+ and installed Edge only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const executable = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert.ok(
  executable,
  "This acceptance needs an existing installed Edge; no browser is downloaded.",
);
const source = await readFile(
  new URL(
    "../src-tauri/crates/sorng-protocols/src/web_network_client.js",
    import.meta.url,
  ),
  "utf8",
);
// Installed, public package fixture only: no font download or user file.
const fontBytes = await readFile(
  new URL(
    "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
    import.meta.url,
  ),
);
const fontUrl = "https://synostatic.synology.com/font/inter/inter-w400-1.woff2";
const fontPath =
  "/__sortofremoteng_assets_v1/synology-inter/inter-w400-1.woff2";
const controlPath = "/__sortofremoteng_quickconnect_control_v1";
const discoveredPath = "/__sortofremoteng_quickconnect_discovered_v1";
const regionalControl = "https://dec.quickconnect.to/Serv.php";
const directProbe =
  "https://192-168-50-100.example-nas.direct.quickconnect.to:5002/webman/pingpong.cgi?action=cors&quickconnect=true";
const unlearnedProbe =
  "https://unlearned.example-nas.direct.quickconnect.to:5001/webman/pingpong.cgi?action=cors&quickconnect=true";
const discoveredUrl = (destination) =>
  discoveredPath + "?destination=" + encodeURIComponent(destination);
const controlBody = JSON.stringify(
  ["mainapp_https", "mainapp_http"].map((id) => ({
    version: 1,
    command: "get_server_info",
    stop_when_error: false,
    stop_when_success: false,
    id,
    serverID: "example-nas",
    is_gofile: false,
    path: "",
  })),
);
const profile = await mkdtemp(path.join(tmpdir(), "sorng-network-smoke-"));
let fontRequests = 0;
let directBytes = 0;
const tripwire = createServer((_request, response) =>
  response.writeHead(403).end(),
);
tripwire.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("data", (chunk) => {
    directBytes += chunk.length;
    socket.destroy();
  });
  socket.on("close", () => sockets.delete(socket));
});
const received = [];
const sockets = new Set();
let finish;
const result = new Promise((resolve) => {
  finish = resolve;
});
let origin;
let globalFrameOrigin;
const server = createServer(async (request, response) => {
  if (request.url === "/global-frame") {
    const config = {
      version: 1,
      sessionId: "global-frame-fixture",
      documentSequence: 11,
      sourceOrigin: "https://global.quickconnect.to",
      proxyOrigin: globalFrameOrigin,
      mappings: [],
      synologyQuickConnect: {
        version: 1,
        navigationOrigins: [
          "https://global.quickconnect.to",
          "https://www.quickconnect.to",
        ],
        redirectEndpoint:
          globalFrameOrigin + "/__sortofremoteng_quickconnect_redirect_v1",
        rpc: {
          upstreamUrl: "https://global.quickconnect.to/Serv.php",
          proxyUrl: globalFrameOrigin + controlPath,
        },
        discovered: {
          version: 1,
          alias: "example-nas",
          proxyUrl: globalFrameOrigin + discoveredPath,
        },
        directNavigation: { version: 1, alias: "example-nas" },
      },
    };
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'none'",
    });
    response.end(`<!doctype html><script>${source}
installWebNetworkClient(${JSON.stringify(config)},function(){});
(async function(){try{
 const body=${JSON.stringify(controlBody)};
 const first=await fetch('/Serv.php',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
 if(!first.ok||await first.text()!==body)throw Error('Relative control changed');
 const second=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',location.origin+'/Serv.php');xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');xhr.onload=()=>xhr.status===200?resolve(xhr.responseText):reject(Error('Rewritten control status'));xhr.onerror=()=>reject(Error('Rewritten control failed'));xhr.send(body);});
 if(second!==body)throw Error('Rewritten control changed');
 const follow=await fetch(${JSON.stringify(regionalControl)},{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
 if(!follow.ok||await follow.text()!==body)throw Error('Follow-up response changed');
 parent.postMessage({type:'global-frame-fixture',ok:true},${JSON.stringify(origin)});
}catch(_){parent.postMessage({type:'global-frame-fixture',ok:false},${JSON.stringify(origin)});}})();</script>`);
    return;
  }
  if (request.url === fontPath) {
    fontRequests++;
    response
      .writeHead(200, {
        "Content-Type": "font/woff2",
        "Cache-Control": "no-store",
      })
      .end(fontBytes);
    return;
  }
  if (request.url === "/rewritten-font.css") {
    response
      .writeHead(200, { "Content-Type": "text/css" })
      .end(
        `@font-face{font-family:StaticFixture;src:url("${origin + fontPath}") format("woff2")}`,
      );
    return;
  }
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/") {
    const config = {
      version: 1,
      sessionId: "browser-fixture",
      documentSequence: 7,
      sourceOrigin: "https://source.example",
      proxyOrigin: origin,
      mappings: [],
      fontAssets: [{ upstreamUrl: fontUrl, proxyUrl: origin + fontPath }],
      synologyQuickConnect: {
        version: 1,
        navigationOrigins: [
          "http://example-nas.quickconnect.to",
          "https://example-nas.quickconnect.to",
          "https://global.quickconnect.to",
          "https://www.quickconnect.to",
        ],
        redirectEndpoint: origin + "/__sortofremoteng_quickconnect_redirect_v1",
        rpc: {
          upstreamUrl: "https://global.quickconnect.to/Serv.php",
          proxyUrl: origin + controlPath,
        },
        discovered: {
          version: 1,
          alias: "example-nas",
          proxyUrl: origin + discoveredPath,
        },
        directNavigation: { version: 1, alias: "example-nas" },
      },
    };
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "font-src 'self'; connect-src 'self' ws:; worker-src 'none'",
    });
    response.end(`<!doctype html><html><head><title>Synthetic proxy fixture</title><link rel="stylesheet" href="/rewritten-font.css"><script>window.onerror=function(message){fetch('/result',{method:'POST',body:JSON.stringify([{name:'page startup',ok:false,error:String(message)}])});};</script></head><body><script>
const originalFetch = window.fetch.bind(window);
// Test-host seam only: model the application's cross-origin frame mount,
// not a website permission to create an unapproved child navigation.
const hostFrameSrc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src').set;
const OriginalFontFace=window.FontFace;
// Never call a native peer. Replace only its constructor entry points with a
// counting tripwire, retaining actual host property flags for the mask proof.
let constructedPeers=0;
const rtcNames=['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection'];
const nativeRtcDescriptors=rtcNames.map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(window,name)}));
if(!nativeRtcDescriptors.some(item=>item.name==='RTCPeerConnection'&&item.descriptor))throw Error('Expected the installed browser RTC host descriptor');
for(const name of rtcNames){
 const descriptor=Object.getOwnPropertyDescriptor(window,name);
 if(descriptor&&!descriptor.configurable&&!descriptor.writable)throw Error('Immutable RTC host cannot run this synthetic tripwire');
 Object.defineProperty(window,name,{...descriptor,configurable:descriptor?.configurable??true,writable:descriptor?.writable??true,value:function(){constructedPeers++;throw Error('RTC constructor tripwire');}});
}
${source}
const reports=[];
const installedNetwork=installWebNetworkClient(${JSON.stringify(config)}, function(report){reports.push(report);});
(async function(){
 const results=[];
 if(!Object.isFrozen(installedNetwork.capabilities)||installedNetwork.capabilities.version!==3||!installedNetwork.capabilities.quickConnectNavigation||!installedNetwork.capabilities.quickConnectDiscovery||!installedNetwork.capabilities.quickConnectDiscovered||!installedNetwork.capabilities.quickConnectDirectNavigation)throw Error('Routing module acknowledgement missing');
 async function check(name,run){try{await Promise.race([run(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Case timed out')),5000))]);results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error)});}}
 await check('sandboxed global portal routes relative and rewritten discovery before follow-up',()=>new Promise((resolve,reject)=>{
   const frame=document.createElement('iframe');frame.sandbox='allow-same-origin allow-scripts allow-forms';
   function result(event){if(event.source!==frame.contentWindow||event.origin!==${JSON.stringify(globalFrameOrigin)}||event.data?.type!=='global-frame-fixture')return;window.removeEventListener('message',result);frame.remove();event.data.ok?resolve():reject(Error('Embedded discovery failed'));}
   window.addEventListener('message',result);hostFrameSrc.call(frame,${JSON.stringify(globalFrameOrigin + "/global-frame")});document.body.append(frame);
 }));
 await check('RTC optional discovery sees unavailable APIs without constructing peers',async()=>{
   for(const name of rtcNames){if(window[name]||typeof window[name]==='function'||name in window)throw Error('RTC capability still advertised');}
   const addresses=[];const Peer=window.webkitRTCPeerConnection||window.mozRTCPeerConnection;
   if(Peer)new Peer({iceServers:[]});
   const local=addresses.length===1?addresses[0]:'';
   const preferHttpsWan=local===''&&true;
   if(local!==''||!preferHttpsWan||constructedPeers!==0)throw Error('Optional discovery did not preserve HTTPS path');
   if(reports.some(r=>r.reason==='unsupported-network-context'))throw Error('Mask invented a blocked request');
   if(preferHttpsWan){const response=await fetch('https://source.example/rtc-https-fallback');if(!response.ok)throw Error('HTTPS fallback fetch failed');}
 });
 await check('FontFace uses exact routed font and document.fonts',async()=>{
   const face=new FontFace('FontFaceFixture','url("${fontUrl}") format("woff2")',{weight:'400'});
   document.fonts.add(face); await face.load();
   const loaded=await document.fonts.load('16px FontFaceFixture','Fixture');
   if(face.status!=='loaded'||loaded.length!==1)throw Error('FontFace did not load');
 });
 await check('QuickConnect anchor parser keeps original authority until click',async()=>{
   const before=reports.length;
   const anchor=document.createElement('a');anchor.href='https://www.quickconnect.to/portal/';
   if(anchor.hostname!=='www.quickconnect.to'||anchor.protocol!=='https:')throw Error('Anchor parser changed');
   document.body.append(anchor);anchor.addEventListener('click',event=>event.preventDefault());anchor.click();
   const routed=new URL(anchor.href);
   if(routed.origin!==location.origin||routed.pathname!=='/__sortofremoteng_quickconnect_redirect_v1'||routed.searchParams.get('destination')!=='https://www.quickconnect.to/portal/')throw Error('Receipt route mismatch');
   if(reports.length!==before)throw Error('Permitted reference reported as network request');
 });
 await check('QuickConnect HTTPS NAS alias uses the same receipt route',async()=>{
   const anchor=document.createElement('a');anchor.href='https://example-nas.quickconnect.to/';
   document.body.append(anchor);anchor.addEventListener('click',event=>event.preventDefault());anchor.click();
   const routed=new URL(anchor.href);
   if(routed.origin!==location.origin||routed.pathname!=='/__sortofremoteng_quickconnect_redirect_v1'||routed.searchParams.get('destination')!=='https://example-nas.quickconnect.to/')throw Error('HTTPS alias receipt route mismatch');
 });
 await check('QuickConnect fetch POST uses protected route and document header',async()=>{
   const body=${JSON.stringify(controlBody)};
   const response=await fetch('https://global.quickconnect.to/Serv.php',{method:'POST',body,credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
   if(await response.text()!==body)throw Error('Discovery body changed');
 });
 await check('QuickConnect XHR POST uses protected route and document header',async()=>{
   const body=${JSON.stringify(controlBody)};
   const response=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','https://global.quickconnect.to/Serv.php',true);xhr.withCredentials=true;xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');xhr.onload=()=>xhr.status===200?resolve(xhr.responseText):reject(Error('Discovery status'));xhr.onerror=()=>reject(Error('Discovery network'));xhr.send(body);});
   if(response!==body)throw Error('Discovery XHR body changed');
 });
 await check('regional discovery POST stays on the protected candidate route',async()=>{
   const body=${JSON.stringify(controlBody)};
   const response=await fetch('${regionalControl}',{method:'POST',body,credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
   if(!response.ok||await response.text()!==body)throw Error('Regional response changed');
 });
 await check('same-NAS GET probe preserves real XHR response and browser headers',async()=>{
   const response=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET',${JSON.stringify(directProbe)},true);xhr.responseType='json';xhr.onload=()=>xhr.status===200?resolve(xhr.response):reject(Error('Probe status'));xhr.onerror=()=>reject(Error('Probe network'));xhr.send();});
   if(response.marker!=='loopback-probe')throw Error('Probe response fabricated or changed');
 });
 await check('unlearned same-NAS probe denial is not fabricated into success',async()=>{
   const response=await fetch(${JSON.stringify(unlearnedProbe)});
   if(response.status!==403||await response.text()!=='fixture-unlearned')throw Error('Unlearned response changed');
 });
 await check('same-NAS direct HTTPS navigation uses receipt, not discovery grant',async()=>{
   const destination='https://192-168-50-100.example-nas.direct.quickconnect.to:5002/webman/';
   const anchor=document.createElement('a');anchor.href=destination;
   if(anchor.hostname!=='192-168-50-100.example-nas.direct.quickconnect.to'||anchor.port!=='5002')throw Error('Direct anchor parser changed');
   document.body.append(anchor);anchor.addEventListener('click',event=>event.preventDefault());anchor.click();
   const routed=new URL(anchor.href);
   if(routed.origin!==location.origin||routed.pathname!=='/__sortofremoteng_quickconnect_redirect_v1'||routed.searchParams.get('destination')!==destination)throw Error('Direct receipt route mismatch');
 });
 await check('dynamic CSS font routes before load',async()=>{
   const style=document.createElement('style');document.head.append(style);
   style.sheet.insertRule('@font-face{font-family:DynamicFixture;src:url("${fontUrl}") format("woff2")}');
   const loaded=await document.fonts.load('16px DynamicFixture','Fixture');
   if(loaded.length!==1||loaded[0].status!=='loaded')throw Error('Dynamic font did not load');
 });
 await check('font rule src property routes before load',async()=>{
   const style=document.createElement('style');document.head.append(style);
   style.sheet.insertRule('@font-face{font-family:PropertyFixture;}');
   style.sheet.cssRules[0].style.src='url("${fontUrl}") format("woff2")';
   const loaded=await document.fonts.load('16px PropertyFixture','Fixture');
   if(loaded.length!==1||loaded[0].status!=='loaded')throw Error('Font src property did not load');
 });
 await check('fetch font ArrayBuffer stays on the exact local route',async()=>{
   const response=await fetch('${fontUrl}');
   const face=new FontFace('FetchedFixture',await response.arrayBuffer());
   await face.load();if(face.status!=='loaded')throw Error('Fetched font did not decode');
 });
 await check('XHR font ArrayBuffer stays on the exact local route',async()=>{
   const bytes=await new Promise((resolve,reject)=>{
     const xhr=new XMLHttpRequest();xhr.open('GET','${fontUrl}');xhr.responseType='arraybuffer';
     xhr.onload=()=>xhr.status===200?resolve(xhr.response):reject(Error('XHR status'));
     xhr.onerror=()=>reject(Error('XHR font failed'));xhr.send();
   });
   const face=new FontFace('XhrFixture',bytes);await face.load();
   if(face.status!=='loaded')throw Error('XHR font did not decode');
 });
 await check('pre-rewritten static CSS font loads locally',async()=>{
   const loaded=await document.fonts.load('16px StaticFixture','Fixture');
   if(loaded.length!==1||loaded[0].status!=='loaded')throw Error('Static font did not load');
 });
 await check('unrouted native font stays CSP blocked',async()=>{
   const face=new OriginalFontFace('BlockedFixture','url("https://synostatic.synology.com/font/inter/unknown.woff2")');
   let rejected=false;try{await face.load();}catch(_){rejected=true;}
   if(!rejected)throw Error('Foreign font escaped CSP');
   await new Promise(resolve=>setTimeout(resolve,50));
   if(!reports.some(r=>r.kind==='font'&&r.reason==='policy-blocked-resource'))throw Error('Missing font restriction notice');
 });
 await check('string-backed Request POST',async()=>{
   const response=await fetch(new Request('https://source.example/string',{method:'POST',body:'string-body',headers:{'X-Fixture':'string'}}));
   if(await response.text()!=='string-body')throw Error('Body mismatch');
 });
 await check('stream-backed Request POST',async()=>{
   const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('stream-body'));c.close();}});
   const response=await fetch(new Request('https://source.example/stream',{method:'POST',body,duplex:'half'}));
   if(await response.text()!=='stream-body')throw Error('Body mismatch');
 });
 await check('Request init override',async()=>{
   const request=new Request('https://source.example/override',{method:'POST',body:'old-body'});
   const response=await fetch(request,{method:'PUT',body:'override-body',headers:{'X-Fixture':'override'}});
   if(await response.text()!=='override-body')throw Error('Override mismatch');
 });
 await check('raw WebSocket query transport',()=>new Promise((resolve,reject)=>{
   const ws=new WebSocket('wss://source.example/socket?token=a%2fb%20c+d~&&k=1&k=2&empty=');
   ws.onopen=()=>{ws.close();resolve();};ws.onerror=()=>reject(Error('Socket failed'));
 }));
 await check('16 MiB bound cancels without sending',async()=>{
   let cancelled=false;
   const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(16*1024*1024+1));},cancel(){cancelled=true;}});
   let rejected=false;
   try{await fetch(new Request('https://source.example/oversize',{method:'POST',body,duplex:'half'}));}catch(_){rejected=true;}
   if(!rejected||!cancelled||!reports.some(r=>r.reason==='request-body-too-large'))throw Error('Request limit was not enforced');
 });
 await check('abort cancels pending body without sending',async()=>{
   let cancelled=false;
   const signal=new AbortController();
   const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
   const pending=fetch(new Request('https://source.example/aborted',{method:'POST',body,duplex:'half',signal:signal.signal}));
   signal.abort();let rejected=false;try{await pending;}catch(_){rejected=true;}
   if(!rejected||!cancelled)throw Error('Abort did not cancel body');
 });
 await check('RTC masking persists through pagehide and cached return',async()=>{
   window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   for(const name of rtcNames){if(window[name]||name in window)throw Error('RTC restored on cached return');}
   if(constructedPeers!==0)throw Error('RTC native tripwire invoked');
 });
 await originalFetch('/result',{method:'POST',body:JSON.stringify(results)});
 document.body.textContent=JSON.stringify(results);
})();
</script></body></html>`);
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (request.url === "/result") {
    response.writeHead(200).end("ok");
    finish(JSON.parse(body));
    return;
  }
  received.push({
    url: request.url,
    method: request.method,
    body,
    fixture: request.headers["x-fixture"],
    ...(request.url === controlPath ||
    request.url.startsWith(discoveredPath + "?")
      ? {
          document: request.headers["x-sorng-quickconnect-document"],
          origin: request.headers.origin ?? null,
          fetchSite: request.headers["sec-fetch-site"],
          fetchMode: request.headers["sec-fetch-mode"],
          fetchDest: request.headers["sec-fetch-dest"],
        }
      : {}),
  });
  // Synthetic responses prove browser transport only. Native registry/grant
  // validation is exercised independently by the Rust loopback suite.
  if (request.url === discoveredUrl(unlearnedProbe)) {
    response.writeHead(403).end("fixture-unlearned");
    return;
  }
  if (request.url === discoveredUrl(directProbe)) {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ marker: "loopback-probe" }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" }).end(body);
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
server.on("upgrade", (request, socket) => {
  received.push({ url: request.url, method: "WEBSOCKET" });
  const accept = createHash("sha1")
    .update(
      String(request.headers["sec-websocket-key"]) +
        "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.on("data", () => socket.end(Buffer.from([0x88, 0x00])));
});
let browser;
let exit;
let timer;
try {
  await new Promise((resolve) => tripwire.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://p0123456789abcdef0123456789abcdef.localhost:${server.address().port}`;
  globalFrameOrigin = `http://p1123456789abcdef0123456789abcdef.localhost:${server.address().port}`;
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--host-resolver-rules=MAP synostatic.synology.com 127.0.0.1:${tripwire.address().port}, MAP *.quickconnect.to 127.0.0.1:${tripwire.address().port}`,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      origin + "/",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  // Drain diagnostics; browser stderr is not an acceptance receipt.
  browser.stderr.resume();
  exit = new Promise((resolve) => {
    browser.once("exit", resolve);
    browser.once("error", (error) =>
      finish([{ name: "launch", ok: false, error: error.message }]),
    );
  });
  const results = await Promise.race([
    result,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Synthetic browser acceptance timed out")),
        30000,
      );
    }),
  ]);
  console.log(
    JSON.stringify({ results, received, fontRequests, directBytes }, null, 2),
  );
  assert.ok(
    fontRequests >= 1,
    "Actual font bytes must be served by the local route",
  );
  assert.equal(
    directBytes,
    0,
    "No direct CDN or QuickConnect tripwire traffic is permitted",
  );
  assert.deepEqual(
    received
      .filter((item) => item.url === controlPath)
      .map((item) => item.document),
    ["11", "11", "7", "7"],
  );
  assert.ok(
    results.every((item) => item.ok),
    "Browser Request/stream acceptance failed; never fall back to a direct request.",
  );
  const dynamic = received.filter((item) =>
    item.url.startsWith(discoveredPath + "?"),
  );
  assert.equal(dynamic.length, 4);
  for (const item of dynamic) {
    assert.ok(item.document === "7" || item.document === "11");
    assert.equal(item.fetchSite, "same-origin");
    assert.equal(item.fetchMode, "cors");
    assert.equal(item.fetchDest, "empty");
    assert.equal(
      item.origin,
      item.method === "GET"
        ? null
        : item.document === "11"
          ? globalFrameOrigin
          : origin,
    );
  }
  for (const item of received.filter((item) => item.document === "11")) {
    assert.equal(item.origin, globalFrameOrigin);
    assert.equal(item.fetchSite, "same-origin");
    assert.equal(item.fetchMode, "cors");
    assert.equal(item.fetchDest, "empty");
  }
  assert.deepEqual(
    received
      .filter((item) => item.method !== "WEBSOCKET")
      .map(({ url, method, body }) => ({ url, method, body })),
    [
      { url: controlPath, method: "POST", body: controlBody },
      { url: controlPath, method: "POST", body: controlBody },
      {
        url: discoveredUrl(regionalControl),
        method: "POST",
        body: controlBody,
      },
      { url: "/rtc-https-fallback", method: "GET", body: "" },
      { url: controlPath, method: "POST", body: controlBody },
      { url: controlPath, method: "POST", body: controlBody },
      {
        url: discoveredUrl(regionalControl),
        method: "POST",
        body: controlBody,
      },
      { url: discoveredUrl(directProbe), method: "GET", body: "" },
      { url: discoveredUrl(unlearnedProbe), method: "GET", body: "" },
      { url: "/string", method: "POST", body: "string-body" },
      { url: "/stream", method: "POST", body: "stream-body" },
      { url: "/override", method: "PUT", body: "override-body" },
    ],
  );
  assert.equal(
    received.find((item) => item.method === "WEBSOCKET")?.url,
    "/socket?token=a%2fb%20c+d~&&k=1&k=2&empty=&__sorng_ws_document_v1=7",
  );
} finally {
  clearTimeout(timer);
  if (browser?.pid && browser.exitCode === null) {
    const stop = spawn(
      "taskkill.exe",
      ["/PID", String(browser.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    await new Promise((resolve) => stop.once("exit", resolve));
    await exit;
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => tripwire.close(resolve));
  assert.equal(path.dirname(profile), path.resolve(tmpdir()));
  assert.ok(path.basename(profile).startsWith("sorng-network-smoke-"));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}
