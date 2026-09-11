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
const profile = await mkdtemp(path.join(tmpdir(), "sorng-network-smoke-"));
const source = await readFile(
  new URL(
    "../src-tauri/crates/sorng-protocols/src/web_network_client.js",
    import.meta.url,
  ),
  "utf8",
);
const received = [];
const sockets = new Set();
let finish;
const result = new Promise((resolve) => {
  finish = resolve;
});
let origin;
const server = createServer(async (request, response) => {
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
    };
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html><html><head><title>Synthetic proxy fixture</title><script>window.onerror=function(message){fetch('/result',{method:'POST',body:JSON.stringify([{name:'page startup',ok:false,error:String(message)}])});};</script></head><body><script>
const originalFetch = window.fetch.bind(window);
${source}
const reports=[];
installWebNetworkClient(${JSON.stringify(config)}, function(report){reports.push(report);});
(async function(){
 const results=[];
 async function check(name,run){try{await Promise.race([run(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Case timed out')),5000))]);results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error)});}}
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
  });
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://p0123456789abcdef0123456789abcdef.localhost:${server.address().port}`;
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
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
  console.log(JSON.stringify({ results, received }, null, 2));
  assert.ok(
    results.every((item) => item.ok),
    "Browser Request/stream acceptance failed; never fall back to a direct request.",
  );
  assert.deepEqual(
    received
      .filter((item) => item.method !== "WEBSOCKET")
      .map(({ url, method, body }) => ({ url, method, body })),
    [
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
  assert.equal(path.dirname(profile), path.resolve(tmpdir()));
  assert.ok(path.basename(profile).startsWith("sorng-network-smoke-"));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}
