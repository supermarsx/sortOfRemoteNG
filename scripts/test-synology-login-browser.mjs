// Real-engine acceptance for the DSM website auto-fill helper (t85). Installed
// Edge headless over CDP loads the synthetic DSM timelines from
// tests/fixtures/synology/dsmLoginTimeline.ts, wrapped in the production proxy
// script shapes, from a local node:http stand-in for the proxy with a counting
// one-shot credential endpoint. No app build, account, profile, package
// download or real upstream is used. Node 22.18+ (imports the TypeScript
// fixture with type stripping) and an installed Edge only.
//
//   node scripts/test-synology-login-browser.mjs [--only=name,...] [--concurrency=16] [--verbose] [--list]
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    only: { type: "string" },
    concurrency: { type: "string", default: "16" },
    verbose: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});
const repo = fileURLToPath(new URL("..", import.meta.url));
const executable = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!executable) {
  console.error(
    "This acceptance needs an existing installed Edge; no browser is downloaded.",
  );
  process.exit(2);
}
let fixture;
try {
  fixture = await import(
    pathToFileURL(
      path.join(repo, "tests/fixtures/synology/dsmLoginTimeline.ts"),
    ).href
  );
} catch (error) {
  console.error(
    `Unable to import the DSM timeline fixture (Node ${process.version} needs TypeScript type stripping, 22.18+): ${error.message}`,
  );
  process.exit(2);
}
const {
  DSM_LOGIN_TIMELINES,
  DSM_LOGIN_ASSET_PATHS,
  DSM_SYNTHETIC_ACCOUNT,
  dsmPageRuntimeSource,
} = fixture;
const protocols = "src-tauri/crates/sorng-protocols/src/";
const text = (file) => readFile(path.join(repo, file), "utf8");
const assets = {
  helper: await text(DSM_LOGIN_ASSET_PATHS.helper),
  client: await text(DSM_LOGIN_ASSET_PATHS.client),
  bridge: await text(DSM_LOGIN_ASSET_PATHS.bridge),
  automation: await text(DSM_LOGIN_ASSET_PATHS.automation),
  bitwarden: await text(protocols + "bitwarden_autologin_client.js"),
  darkMode: await text(protocols + "web_dark_mode_client.js"),
  network: await text(protocols + "web_network_client.js"),
};

// The page shapes below are hand-mirrored from the proxy. Fail loudly when the
// Rust side drifts instead of silently testing a stale arrangement.
const NAVIGATION_MARKER = "__sorng_navigation_v1";
const productionShapes = {
  "http.rs": [
    'format!("{}{}{}", nav_script, autologin_asset, autologin_script)',
    "proxy_response::inject_page_scripts(&body_str, &injected_scripts)",
    "final_body = proxy_response::inject_readiness(",
  ],
  "autologin_asset.rs": [
    '"<script>{}{}{}</script>",',
    "BITWARDEN_CLIENT_JS, SYNOLOGY_CLIENT_JS, AUTOLOGIN_CLIENT_JS",
  ],
  "themed_autologin.rs": [
    "try{{window.__sorng_autologin.fetchCredsAndRun(NONCE,SEL{flow_hint});return;}}catch(_){{report({{ok:false,reason:'autologin-client-failed'}});return;}}",
    `flow_hint = if synology { ", 'synology'" } else { "" },`,
    "if(document.readyState==='loading'){{document.addEventListener('DOMContentLoaded',go);}}else{{go();}}",
  ],
  "http_response.rs": [
    `const NAVIGATION_MARKER: &str = "${NAVIGATION_MARKER}";`,
    "{network_client}\nwindow.addEventListener('beforeunload',function(){{emit('proxy_navigation_start');}});\n{dark_mode_client}\n{automation_client}\nemit('proxy_document_start');\n{synology_progress_client}\nfunction ready(){{emit('proxy_dom_ready');}}",
  ],
  "http_network_client.rs": [
    "p.networkRouting = installWebNetworkClient({},function(detail){{try{{window.parent.postMessage(Object.assign({{}},detail,{{type:'sorng_web_network_blocked',version:1,sessionId:p.sessionId,documentSequence:p.documentSequence,navigationToken:p.navigationToken,documentToken:p.documentToken,url:u.href}}),'*');}}catch(_){{}}}}).capabilities;",
  ],
};
for (const [file, fragments] of Object.entries(productionShapes)) {
  const rust = (await text(protocols + file)).replace(/\r\n/g, "\n");
  for (const fragment of fragments)
    if (!rust.includes(fragment)) {
      console.error(
        `Production page script shape changed in ${protocols}${file}; update this mirror:\n  ${fragment}`,
      );
      process.exit(2);
    }
}

const TERMINAL = new Set([
  "submitted",
  "timeout",
  "stopped",
  "cancelled",
  "signed_in",
  "rejected",
]);
const BINDING = "__sorngAcceptanceRecord";
const LOAD_HOLD_MS = 3000; // the slow wallpaper holds `load` on every page
const MARGIN_MS = 20000; // real-engine slack past each timeline's runMs
const SETTLE_AFTER_TERMINAL_MS = 1500; // late requests or statuses still count
const START_TIMEOUT_MS = 20000;
const CLOCK_SLACK_MS = 5;
const WALLPAPER_PATH = "/webman/resources/images/login-wallpaper.png";
const WALLPAPER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);
// Real layout: sized controls, a fixed desktop, keyframe and transition
// animations on every panel swap. Captcha markup keeps user-agent defaults.
const DSM_STYLE = `html,body{margin:0;min-height:100%;font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#1d2433}
body{min-height:100vh;background:linear-gradient(135deg,#0b3d6e,#0a7fc2)}
.login-wallpaper{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35;pointer-events:none}
.dsm-boot-splash{position:fixed;inset:0;display:grid;place-items:center;color:#fff;font-size:18px;animation:dsm-pulse .9s ease-in-out infinite alternate}
#sds-login-vue{position:relative;width:360px;max-width:calc(100vw - 32px);margin:12vh auto 0;padding:28px;border-radius:14px;background:rgba(255,255,255,.94);box-shadow:0 20px 60px rgba(0,0,0,.35);animation:dsm-rise .6s cubic-bezier(.2,.8,.2,1) both}
.login-tabs-content-wrapper{animation:dsm-slide .45s cubic-bezier(.2,.8,.2,1) both;transition:opacity .3s}
.login-tabs-content-wrapper.is-busy{opacity:.7}
.login-tabs-content-wrapper input:not([hidden]):not([type=checkbox]):not([name=captcha]){display:block;box-sizing:border-box;width:100%;height:40px;margin-top:8px;padding:0 12px;border:1px solid #c7cfdb;border-radius:8px;font:inherit;transition:border-color .2s,box-shadow .2s}
.login-tabs-content-wrapper input:focus{border-color:#0086e5;box-shadow:0 0 0 3px rgba(0,134,229,.25);outline:0}
.login-btn{margin-top:16px;height:40px;line-height:40px;border-radius:8px;text-align:center;background:#0086e5;color:#fff;cursor:pointer;user-select:none;transition:opacity .3s,transform .3s}
.login-btn.spin{opacity:.55;transform:scale(.98)}
.login-error-msg{margin-top:10px;color:#c62828}
.sds-desktop{position:fixed;inset:0;background:#20344f;animation:dsm-fade .5s both}
.sds-taskbar{position:absolute;left:0;right:0;top:0;height:40px;padding:0 12px;line-height:40px;color:#fff;background:rgba(0,0,0,.4)}
@keyframes dsm-pulse{from{opacity:.4}to{opacity:1}}
@keyframes dsm-rise{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
@keyframes dsm-slide{from{opacity:0;transform:translateX(48px)}to{opacity:1;transform:none}}
@keyframes dsm-fade{from{opacity:0}to{opacity:1}}`;

const hex32 = () => randomBytes(16).toString("hex");
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
const byName = (name) => {
  const timeline = DSM_LOGIN_TIMELINES.find((item) => item.name === name);
  if (!timeline) throw new Error(`Fixture timeline ${name} is missing`);
  return timeline;
};
const accountStep = { type: "account" };

// Scenarios: every fixture timeline a real document can reproduce, plus
// QuickConnect/path variants and harness-only request timing cases.
const skipped = [];
const scenarios = [];
for (const timeline of DSM_LOGIN_TIMELINES) {
  if (
    timeline.readyState === "loading" ||
    timeline.steps.some(({ step }) => step.type === "readyState")
  ) {
    skipped.push({
      name: timeline.name,
      why: "scripts readyState while the document streams; production starts the helper at DOMContentLoaded",
    });
    continue;
  }
  scenarios.push({
    ...timeline,
    source: timeline.jsdomOnly ? "fixture (real engine)" : "fixture",
    // An interactive-only timeline keeps the wallpaper pending for the run.
    holdLoadMs: timeline.readyState === "interactive" ? Infinity : LOAD_HOLD_MS,
    network: timeline.name.startsWith("quickconnect-")
      ? "quickconnect"
      : "direct",
  });
}
scenarios.push(
  {
    ...byName("post-submit-otp-hand-off"),
    name: "post-submit-otp-hand-off@quickconnect",
    summary: "OTP hand-off after the password on a QuickConnect session",
    source: "variant",
    network: "quickconnect",
  },
  {
    ...byName("vue-router-slash-normalisation"),
    name: "vue-router-slash-normalisation@webman",
    summary: "hash normalisation on the /webman/index.cgi start path",
    source: "variant",
    path: "/webman/index.cgi",
  },
  {
    name: "quickconnect-slow-password-then-otp",
    summary:
      "QuickConnect relay: the password panel takes 20s after Next, then DSM asks for the OTP code",
    source: "harness",
    network: "quickconnect",
    path: "/#/signin",
    initial: [accountStep],
    steps: [],
    behavior: {
      next: { delayMs: 20000, outcome: "password" },
      signIn: { delayMs: 1200, outcome: "otp" },
    },
    runMs: 30000,
    expected: byName("post-submit-otp-hand-off").expected,
  },
  {
    name: "account-rerender-during-username-fetch",
    summary:
      "the account panel re-renders with identical markup while the username request is in flight",
    source: "harness",
    path: "/#/signin",
    initial: [accountStep],
    steps: [{ at: 1200, step: { type: "rerenderAccount" } }],
    grant: { usernameDelayMs: 2500 },
    behavior: {},
    runMs: 10000,
    inFlight: [{ stage: "username", label: "step-0" }],
    expected: byName("slow-password-panel").expected,
  },
  {
    name: "password-rerender-during-password-fetch",
    summary:
      "the password panel re-renders while the password request is in flight",
    source: "harness",
    path: "/#/signin",
    initial: [accountStep],
    steps: [],
    reactions: [
      { hash: "#/signin/password", afterMs: 1500, step: { type: "password" } },
    ],
    grant: { passwordDelayMs: 3000 },
    behavior: {},
    runMs: 12000,
    inFlight: [{ stage: "password", label: "reaction-0" }],
    expected: byName("slow-password-panel").expected,
  },
  {
    name: "credentials-unavailable-403",
    summary: "the credential endpoint refuses the username grant with 403",
    source: "harness",
    path: "/#/signin",
    initial: [accountStep],
    steps: [],
    behavior: {},
    grantMode: "refuse",
    runMs: 3000,
    // No fixture timeline covers a refused grant; plan §2.1 names this reason.
    expected: {
      phase: "stopped",
      reason: "credentials-unavailable",
      usernameRequests: 1,
      passwordRequests: 0,
      signInClicks: 0,
      refused: 1,
    },
  },
);
for (const scenario of scenarios) {
  Object.assign(scenario, {
    holdLoadMs: scenario.holdLoadMs ?? LOAD_HOLD_MS,
    path: scenario.path ?? "/",
    reactions: scenario.reactions ?? [],
    grant: scenario.grant ?? {},
    key: hex32(),
    sessionIdentity: randomUUID(),
    sequence: 7,
    navigationToken: hex32(),
    readinessNonce: hex32(),
    continuationNonce: hex32(),
    account: { ...DSM_SYNTHETIC_ACCOUNT },
    documentRequests: 0,
    grants: [],
    held: new Set(),
    helperEvents: [],
    bridge: [],
    messages: [],
    pageErrors: [],
    trustedInputs: [],
    typing: Promise.resolve(),
    failures: [],
  });
}
const only = options.only?.split(",").filter(Boolean);
const selected = only
  ? scenarios.filter((scenario) =>
      only.some((name) => scenario.name.includes(name)),
    )
  : scenarios;
if (options.list || selected.length === 0) {
  for (const scenario of scenarios)
    console.log(`${scenario.name.padEnd(58)} ${scenario.summary}`);
  for (const item of skipped)
    console.log(`${item.name.padEnd(58)} skipped: ${item.why}`);
  process.exit(options.list ? 0 : 2);
}

// Page-side "DSM application" shipped as source text: applies the fixture
// timeline with real timers from DOMContentLoaded, which is when the production
// bootstrap starts the helper, and reports harness data to the host frame.
function dsmApplication(config) {
  "use strict";
  var host = window.parent;
  var start = null;
  var applied = [];
  var readyStates = [];
  function post(message) {
    host.postMessage(message, config.hostOrigin);
  }
  function since() {
    return start === null ? null : Math.round(performance.now() - start);
  }
  window.addEventListener("error", function (event) {
    post({ type: "acceptance-page-error", message: String(event.message) });
  });
  window.addEventListener("unhandledrejection", function (event) {
    post({ type: "acceptance-page-error", message: String(event.reason) });
  });
  document.addEventListener("readystatechange", function () {
    readyStates.push({ state: document.readyState, at: since() });
  });
  document.addEventListener("sorng_synology_login_progress", function (event) {
    post({
      type: "acceptance-helper-event",
      at: since(),
      detail: event.detail,
    });
  });
  var page = createDsmPage(window, {
    account: config.account,
    // Real user typing comes from CDP input at these viewport coordinates.
    trustedInput: function (field, text) {
      var box = field.getBoundingClientRect();
      post({
        type: "acceptance-trusted-input",
        text: text,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
    },
  });
  // The production network client refuses a script-set foreign form target
  // (its setAttribute hook throws origin-not-approved). One that still reaches
  // the helper comes from parsed HTML, which that client leaves to CSP.
  function parsedFormAttribute(step) {
    var form = document.querySelector(
      "form#dsm-pass-fieldset, form#dsm-user-fieldset",
    );
    if (!form) return;
    var holder = document.createElement("div");
    holder.innerHTML = form.outerHTML.replace(
      /^<form\b/i,
      "<form " +
        step.name +
        '="' +
        String(step.value).replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
        '"',
    );
    form.replaceWith(holder.firstElementChild);
  }
  function apply(step, label) {
    try {
      if (step.type === "formAttribute") parsedFormAttribute(step);
      else page.apply(step);
      applied.push({ label: label, type: step.type, at: since() });
    } catch (error) {
      post({
        type: "acceptance-step-error",
        label: label,
        step: step.type,
        message: String(error),
      });
    }
  }
  function schedule(index) {
    for (; index < config.steps.length; index++) {
      var wait = start + config.steps[index].at - performance.now();
      if (wait > 0) {
        var next = index;
        setTimeout(function () {
          schedule(next);
        }, wait);
        return;
      }
      apply(config.steps[index].step, "step-" + index);
    }
  }
  function react(reaction, index) {
    var timer = setInterval(function () {
      if (location.hash !== reaction.hash) return;
      clearInterval(timer);
      setTimeout(function () {
        apply(reaction.step, "reaction-" + index);
      }, reaction.afterMs);
    }, 20);
  }
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      start = performance.now();
      post({
        type: "acceptance-start",
        epoch: performance.timeOrigin + start,
        visibility: document.visibilityState,
      });
      schedule(0);
      config.reactions.forEach(react);
    },
    { once: true },
  );
  window.addEventListener("message", function (event) {
    if (event.source !== host || event.origin !== config.hostOrigin) return;
    if (!event.data || event.data.type !== "acceptance-collect") return;
    var helper = window.__sorng_synology_login;
    post({
      type: "acceptance-collected",
      counts: page.counts,
      applied: applied,
      readyStates: readyStates,
      status: helper ? helper.getStatus() : null,
      trace: helper && helper.getTrace ? helper.getTrace() : null,
      autologinLast: window.__autologin_last || null,
      passwordHeld: Array.prototype.some.call(
        document.querySelectorAll("input"),
        function (input) {
          return input.value === config.account.password;
        },
      ),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
    });
  });
  page.install(config.behavior);
  config.initial.forEach(function (step) {
    apply(step, "initial");
  });
}

// Host-side stand-in for the app's web view: a sandboxed cross-origin frame
// whose messages are forwarded to Node over a CDP binding.
function hostWebView(config) {
  "use strict";
  var frame = document.querySelector("iframe");
  var waiting = [];
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow || event.origin !== config.origin)
      return;
    var data = event.data;
    if (data && data.type === "acceptance-collected") {
      waiting.splice(0).forEach(function (resolve) {
        resolve(data);
      });
      return;
    }
    if (data && data.type === "acceptance-trusted-input") {
      var box = frame.getBoundingClientRect();
      data = {
        type: data.type,
        text: data.text,
        x: box.left + data.x,
        y: box.top + data.y,
      };
    }
    window[config.binding](JSON.stringify({ epoch: Date.now(), data: data }));
  });
  window.acceptanceCollect = function () {
    return new Promise(function (resolve) {
      waiting.push(resolve);
      frame.contentWindow.postMessage(
        { type: "acceptance-collect" },
        config.origin,
      );
    });
  };
}

let port;
const hostOrigin = () => `http://app.localhost:${port}`;
const proxyOrigin = (scenario) => `http://p${scenario.key}.localhost:${port}`;
const frameUrl = (scenario) => {
  const [pathname, ...hash] = scenario.path.split("#");
  return `${proxyOrigin(scenario)}${pathname}?${NAVIGATION_MARKER}=${scenario.navigationToken}${hash.length ? "#" + hash.join("#") : ""}`;
};

function networkConfig(scenario) {
  const proxy = proxyOrigin(scenario);
  const config = {
    version: 1,
    sessionId: scenario.sessionIdentity,
    documentSequence: scenario.sequence,
    sourceOrigin:
      scenario.network === "quickconnect"
        ? "https://192-168-50-100.example-nas.direct.quickconnect.to:5001"
        : "https://192.168.50.100:5001",
    proxyOrigin: proxy,
    mappings: [],
    // Font manifest omitted: the synthetic page loads no Synology fonts.
    fontAssets: [],
  };
  if (scenario.network === "quickconnect")
    config.synologyQuickConnect = {
      version: 1,
      navigationOrigins: [
        "http://example-nas.quickconnect.to",
        "https://example-nas.quickconnect.to",
        "https://global.quickconnect.to",
        "https://www.quickconnect.to",
      ],
      redirectEndpoint: proxy + "/__sortofremoteng_quickconnect_redirect_v1",
      rpc: {
        upstreamUrl: "https://global.quickconnect.to/Serv.php",
        proxyUrl: proxy + "/__sortofremoteng_quickconnect_control_v1",
      },
      discovered: {
        version: 1,
        alias: "example-nas",
        proxyUrl: proxy + "/__sortofremoteng_quickconnect_discovered_v1",
      },
      directNavigation: { version: 1, alias: "example-nas" },
      regionalNavigation: { version: 1, alias: "example-nas" },
    };
  return config;
}

// Mirrors http.rs: page scripts (navigation reporter, reviewed client asset,
// bootstrap) before </body>, then inject_readiness at the early head position.
function dsmDocument(scenario) {
  const application = `${dsmPageRuntimeSource()}\n(${dsmApplication.toString()})(${scriptJson(
    {
      hostOrigin: hostOrigin(),
      account: scenario.account,
      behavior: scenario.behavior,
      initial: scenario.initial,
      steps: scenario.steps,
      reactions: scenario.reactions,
    },
  )});`;
  if (/<\/script|<!--/i.test(application))
    throw new Error("The synthetic DSM application cannot be inlined");
  const upstream = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synology DiskStation</title><style>${DSM_STYLE}</style></head><body><img class="login-wallpaper" alt="" src="${WALLPAPER_PATH}"><script>${application}</script></body></html>`;
  const navScript =
    "<script>try{window.parent.postMessage({type:'proxy_navigate',url:location.href},'*')}catch(e){}</script>";
  const asset = `<script>${assets.bitwarden}${assets.helper}${assets.client}</script>`;
  const bootstrap = `<script>(function(){
'use strict';
var NONCE=${JSON.stringify(scenario.readinessNonce)};
var SEL=null;
function report(r){try{window.parent.postMessage({type:'proxy_autologin_result',result:r},'*');}catch(_){} window.__autologin_last=r;}
function go(){
  if(window.__sorng_autologin&&typeof window.__sorng_autologin.fetchCredsAndRun==='function'){
    try{window.__sorng_autologin.fetchCredsAndRun(NONCE,SEL, 'synology');return;}catch(_){report({ok:false,reason:'autologin-client-failed'});return;}
  }
  report({ok:false,reason:'autologin-client-unavailable'});
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',go);}else{go();}
})();</script>`;
  const identity = scriptJson({
    version: 1,
    sessionId: scenario.sessionIdentity,
    navigationToken: scenario.navigationToken,
    documentToken: hex32(),
    documentSequence: scenario.sequence,
  });
  const readiness = `<script>(function(){'use strict';var p=${identity};
var u=new URL(location.href),q=u.search.slice(1).split('&').filter(function(v){return v.split('=')[0]!=='${NAVIGATION_MARKER}';}).join('&');
u.search=q?'?'+q:'';try{history.replaceState(history.state,'',u.href);}catch(_){}
function emit(type){p.type=type;p.url=u.href;try{window.parent.postMessage(p,'*');}catch(_){}}
${assets.network}
p.networkRouting = installWebNetworkClient(${scriptJson(networkConfig(scenario))},function(detail){try{window.parent.postMessage(Object.assign({},detail,{type:'sorng_web_network_blocked',version:1,sessionId:p.sessionId,documentSequence:p.documentSequence,navigationToken:p.navigationToken,documentToken:p.documentToken,url:u.href}),'*');}catch(_){}}).capabilities;
window.addEventListener('beforeunload',function(){emit('proxy_navigation_start');});
${assets.darkMode}
${assets.automation}
emit('proxy_document_start');
${assets.bridge}
function ready(){emit('proxy_dom_ready');}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ready,{once:true});}else{ready();}
})();</script>`;
  const bodyEnd = upstream.lastIndexOf("</body>");
  const html =
    upstream.slice(0, bodyEnd) +
    navScript +
    asset +
    bootstrap +
    upstream.slice(bodyEnd);
  const head = html.indexOf("<head>") + "<head>".length;
  return html.slice(0, head) + readiness + html.slice(head);
}

function hostDocument(scenario) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Web view</title><style>html,body{margin:0;height:100%;background:#111}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe sandbox="allow-same-origin allow-scripts allow-forms" src="${frameUrl(scenario)}"></iframe><script>(${hostWebView.toString()})(${scriptJson({ origin: proxyOrigin(scenario), binding: BINDING })});</script></body></html>`;
}

// One-shot stand-in for /__sortofremoteng_autologin (themed_autologin.rs):
// one username grant for the page nonce, then one password grant for its
// continuation, otherwise the production 403.
function credentialEndpoint(scenario, url, request, response) {
  const passwordStage = url.searchParams.get("phase") === "password";
  const nonce = url.searchParams.get("nonce");
  const entry = {
    stage: passwordStage ? "password" : "username",
    epoch: Date.now(),
    replyEpoch: null,
    status: 0,
    method: request.method,
    site: request.headers["sec-fetch-site"],
    mode: request.headers["sec-fetch-mode"],
    dest: request.headers["sec-fetch-dest"],
    extra: [...url.searchParams.keys()].filter(
      (name) => name !== "nonce" && name !== "phase",
    ),
  };
  scenario.grants.push(entry);
  const refuse = () => {
    entry.status = 403;
    entry.replyEpoch = Date.now();
    response
      .writeHead(403, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end("saved Synology login expired or its document changed");
  };
  let body;
  if (scenario.grantMode === "refuse" || request.method !== "GET")
    return refuse();
  if (
    !passwordStage &&
    nonce === scenario.readinessNonce &&
    !scenario.usernameSpent
  ) {
    scenario.usernameSpent = true;
    body = {
      loginFlow: "synology",
      username: scenario.account.username,
      continuation: scenario.continuationNonce,
    };
  } else if (
    passwordStage &&
    nonce === scenario.continuationNonce &&
    scenario.usernameSpent &&
    !scenario.passwordSpent
  ) {
    scenario.passwordSpent = true;
    body = { loginFlow: "synology", password: scenario.account.password };
  } else return refuse();
  const timer = setTimeout(
    () => {
      entry.status = 200;
      entry.replyEpoch = Date.now();
      response
        .writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end(JSON.stringify(body));
    },
    (passwordStage
      ? scenario.grant.passwordDelayMs
      : scenario.grant.usernameDelayMs) ?? 0,
  );
  response.once("close", () => {
    if (entry.replyEpoch !== null) return;
    clearTimeout(timer);
    entry.aborted = true;
  });
}

const byKey = new Map(scenarios.map((scenario) => [scenario.key, scenario]));
const sockets = new Set();
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const host = String(request.headers.host ?? "").replace(/:\d+$/, "");
  if (host === "app.localhost") {
    const scenario = byKey.get(url.pathname.slice("/web-view/".length));
    if (scenario && url.pathname.startsWith("/web-view/")) {
      response
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end(hostDocument(scenario));
      return;
    }
    response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404).end();
    return;
  }
  const scenario = byKey.get(/^p([0-9a-f]{32})\.localhost$/.exec(host)?.[1]);
  if (!scenario) {
    response.writeHead(404).end();
    return;
  }
  if (url.pathname === "/__sortofremoteng_autologin")
    return credentialEndpoint(scenario, url, request, response);
  if (url.pathname === WALLPAPER_PATH) {
    const send = () => {
      scenario.held.delete(response);
      response
        .writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
        })
        .end(WALLPAPER);
    };
    scenario.held.add(response);
    if (Number.isFinite(scenario.holdLoadMs)) {
      const timer = setTimeout(send, scenario.holdLoadMs);
      response.once("close", () => clearTimeout(timer));
    }
    return;
  }
  const dest = request.headers["sec-fetch-dest"];
  if (request.method === "GET" && (dest === "iframe" || dest === "document")) {
    scenario.documentRequests++;
    response
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(dsmDocument(scenario));
    return;
  }
  response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404).end();
});
// Nothing may leave loopback for Synology or QuickConnect hosts.
let directBytes = 0;
const tripwire = createServer((_request, response) =>
  response.writeHead(403).end(),
);
for (const listener of [server, tripwire])
  listener.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (listener === tripwire)
      socket.on("data", (chunk) => {
        directBytes += chunk.length;
        socket.destroy();
      });
  });

class DevTools {
  #socket;
  #next = 0;
  #pending = new Map();
  #listeners = new Set();
  static async connect(url) {
    const devtools = new DevTools();
    devtools.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      devtools.#socket.addEventListener("open", resolve, { once: true });
      devtools.#socket.addEventListener(
        "error",
        () => reject(new Error("DevTools connection failed")),
        { once: true },
      );
    });
    devtools.#socket.addEventListener("message", (event) =>
      devtools.#receive(JSON.parse(String(event.data))),
    );
    devtools.#socket.addEventListener("close", () => {
      for (const call of devtools.#pending.values())
        call.reject(new Error("DevTools connection closed"));
      devtools.#pending.clear();
    });
    return devtools;
  }
  #receive(message) {
    if (message.id === undefined) {
      for (const listener of this.#listeners)
        listener(message.method, message.params, message.sessionId);
      return;
    }
    const call = this.#pending.get(message.id);
    if (!call) return;
    this.#pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error)
      call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }
  send(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(listener) {
    this.#listeners.add(listener);
  }
  close() {
    this.#socket.close();
  }
}

const interrupt = new AbortController();
process.once("SIGINT", () => interrupt.abort());
async function until(predicate, timeoutMs) {
  const end = Date.now() + Math.max(0, timeoutMs);
  while (!predicate() && Date.now() < end) {
    if (interrupt.signal.aborted) throw new Error("interrupted");
    await delay(100);
  }
  return predicate();
}

const sessions = new Map();
function record(devtools, scenario, { epoch, data }) {
  switch (data?.type) {
    case "acceptance-start":
      scenario.startEpoch = data.epoch;
      scenario.visibility = data.visibility;
      return;
    case "acceptance-helper-event":
      scenario.helperEvents.push({ at: data.at, epoch, detail: data.detail });
      if (TERMINAL.has(data.detail?.phase) && !scenario.terminalEpoch)
        scenario.terminalEpoch = epoch;
      return;
    case "acceptance-page-error":
      scenario.pageErrors.push(data.message);
      return;
    case "acceptance-step-error":
      scenario.failures.push(
        `timeline ${data.label} (${data.step}) threw: ${data.message}`,
      );
      return;
    case "acceptance-trusted-input":
      scenario.typing = scenario.typing
        .then(() => typeAsUser(devtools, scenario, data))
        .catch((error) =>
          scenario.failures.push(`trusted input: ${error.message}`),
        );
      return;
    case "proxy_synology_login_progress":
      scenario.bridge.push(data);
      return;
    default:
      scenario.messages.push(data);
  }
}

// A trusted click into the field, then trusted key presses, like a user.
async function typeAsUser(devtools, scenario, { x, y, text }) {
  const session = scenario.sessionId;
  await devtools.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x, y },
    session,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await devtools.send(
      "Input.dispatchMouseEvent",
      { type, x, y, button: "left", clickCount: 1 },
      session,
    );
  for (const character of text) {
    const key = {
      key: character,
      code: `Key${character.toUpperCase()}`,
      windowsVirtualKeyCode: character.toUpperCase().charCodeAt(0),
    };
    await devtools.send(
      "Input.dispatchKeyEvent",
      { type: "keyDown", text: character, unmodifiedText: character, ...key },
      session,
    );
    await devtools.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", ...key },
      session,
    );
  }
  scenario.trustedInputs.push(text.length);
}

async function runScenario(devtools, scenario) {
  const began = Date.now();
  let targetId;
  try {
    ({ targetId } = await devtools.send("Target.createTarget", {
      url: "about:blank",
    }));
    const { sessionId } = await devtools.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    scenario.sessionId = sessionId;
    sessions.set(sessionId, scenario);
    await devtools.send("Runtime.enable", {}, sessionId);
    await devtools.send("Runtime.addBinding", { name: BINDING }, sessionId);
    await devtools.send("Page.enable", {}, sessionId);
    await devtools.send("Inspector.enable", {}, sessionId);
    await devtools.send(
      "Emulation.setFocusEmulationEnabled",
      { enabled: true },
      sessionId,
    );
    const navigation = await devtools.send(
      "Page.navigate",
      { url: `${hostOrigin()}/web-view/${scenario.key}` },
      sessionId,
    );
    if (navigation.errorText)
      throw new Error(`web view navigation failed: ${navigation.errorText}`);
    if (!(await until(() => scenario.startEpoch, START_TIMEOUT_MS)))
      throw new Error("the DSM document never reached DOMContentLoaded");
    const slack =
      MARGIN_MS +
      (Number.isFinite(scenario.holdLoadMs) ? scenario.holdLoadMs : 0);
    await until(
      () => scenario.terminalEpoch,
      scenario.startEpoch + scenario.runMs + slack - Date.now(),
    );
    await delay(SETTLE_AFTER_TERMINAL_MS);
    await scenario.typing;
    const collected = await devtools.send(
      "Runtime.evaluate",
      {
        expression: "window.acceptanceCollect().then(JSON.stringify)",
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      10000,
    );
    scenario.collected = JSON.parse(collected.result.value);
  } catch (error) {
    scenario.failures.push(error.message);
  } finally {
    scenario.wallMs = Date.now() - began;
    if (targetId)
      await devtools.send("Target.closeTarget", { targetId }).catch(() => {});
    for (const response of scenario.held) response.destroy();
  }
  verify(scenario);
  const outcome = scenario.helperEvents.find((event) =>
    TERMINAL.has(event.detail.phase),
  )?.detail;
  console.log(
    `${scenario.failures.length ? "FAIL" : "pass"} ${scenario.name} -> ${outcome ? `${outcome.phase}/${outcome.reason}` : "no terminal status"} (${(scenario.wallMs / 1000).toFixed(1)} s)`,
  );
}

function verify(scenario) {
  const { expected, collected, helperEvents: events } = scenario;
  const fail = (message) => scenario.failures.push(message);
  const check = (label, actual, wanted) => {
    if (actual !== wanted)
      fail(
        `${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
      );
  };
  const key = (value) => `${value?.phase}/${value?.reason}`;
  const terminals = events.filter((event) => TERMINAL.has(event.detail.phase));
  const terminal = terminals[0]?.detail;
  if (!terminal) fail(`no terminal status; last ${key(events.at(-1)?.detail)}`);
  else {
    check("terminal status", key(terminal), key(expected));
    if (terminals.length !== 1 || events.at(-1) !== terminals[0])
      fail("the helper published after its terminal status");
    if (expected.handoff !== undefined)
      check("trace.handoff", terminal.trace?.handoff ?? null, expected.handoff);
    if (
      terminal.phase === "signed_in" &&
      terminal.reason !== "no-sign-in-page" &&
      !events.some((event) => event.detail.phase === "verifying_sign_in")
    )
      fail("signed_in was reported before any Sign in click");
  }
  const grants = (stage) =>
    scenario.grants.filter((grant) => grant.stage === stage);
  check(
    "username requests",
    grants("username").length,
    expected.usernameRequests,
  );
  check(
    "password requests",
    grants("password").length,
    expected.passwordRequests,
  );
  check(
    "refused credential requests",
    scenario.grants.filter((grant) => grant.status === 403).length,
    expected.refused ?? 0,
  );
  for (const grant of scenario.grants)
    if (
      grant.method !== "GET" ||
      grant.site !== "same-origin" ||
      grant.mode !== "cors" ||
      grant.dest !== "empty" ||
      grant.extra.length
    )
      fail(`unexpected credential request shape ${JSON.stringify(grant)}`);
  check("document requests", scenario.documentRequests, 1);
  if (collected) {
    check("Sign in clicks", collected.counts.signIn, expected.signInClicks);
    if (expected.nextClicks !== undefined)
      check("Next clicks", collected.counts.next, expected.nextClicks);
    if (expected.usernameInputs !== undefined)
      check(
        "username input events",
        collected.counts.usernameInputs,
        expected.usernameInputs,
      );
    if (collected.counts.signIn)
      check(
        "Sign in clicks with the password filled",
        collected.counts.signInWithPassword,
        collected.counts.signIn,
      );
    else if (collected.passwordHeld)
      fail("an unsent password stayed in a field after the helper stopped");
    if (terminal) check("getStatus()", key(collected.status), key(terminal));
    if (
      scenario.holdLoadMs === Infinity &&
      collected.readyStates.some((item) => item.state === "complete")
    )
      fail("the slow wallpaper did not hold the load event");
  } else fail("page state was not collected");
  const reasons = new Set(events.map((event) => event.detail.reason));
  for (const reason of expected.traceReasons ?? [])
    if (!reasons.has(reason)) fail(`the helper never reported ${reason}`);

  // The bridge must deliver every helper status in order, ending terminal.
  const delivered = scenario.bridge.map(key);
  if (terminal)
    check("bridge terminal status", delivered.at(-1), key(terminal));
  if (expected.handoff)
    check(
      "bridge trace.handoff",
      scenario.bridge.at(-1)?.trace?.handoff ?? null,
      expected.handoff,
    );
  if (!delivered.some((item) => item.endsWith("/observation-limited"))) {
    let cursor = 0;
    for (const event of events) {
      const found = delivered.indexOf(key(event.detail), cursor);
      if (found < 0) {
        fail(`the bridge dropped ${key(event.detail)}`);
        break;
      }
      cursor = found + 1;
    }
  }
  for (const message of scenario.bridge)
    if (
      message.sessionId !== scenario.sessionIdentity ||
      message.documentSequence !== scenario.sequence
    )
      fail("a bridge message carried the wrong document identity");

  // No secret anywhere the page reports; closed values only in status/trace.
  const everything = JSON.stringify([
    events,
    scenario.bridge,
    scenario.messages,
    scenario.pageErrors,
    collected?.status,
    collected?.trace,
    collected?.autologinLast,
  ]);
  for (const [label, secret] of [
    ["username", scenario.account.username],
    ["password", scenario.account.password],
    ["readiness nonce", scenario.readinessNonce],
    ["continuation nonce", scenario.continuationNonce],
  ])
    if (everything.includes(secret))
      fail(`the ${label} appeared in page output`);
  const closed = JSON.stringify([
    events.map((event) => event.detail),
    scenario.bridge.map(({ phase, reason, trace }) => ({
      phase,
      reason,
      trace,
    })),
    collected?.trace,
  ]);
  if (/localhost|:\/\/|#\/|sds-|syno-id|fieldset|synthetic/i.test(closed))
    fail("a helper status or trace carried a URL, id or page value");

  // Timing receipts: no credential before DSM rendered the account panel, and
  // re-renders really landed while the named request was in flight.
  const firstUsername = grants("username")[0];
  if (
    firstUsername &&
    collected &&
    !scenario.initial.some((step) => step.type === "account")
  ) {
    const rendered = collected.applied.find((item) => item.type === "account");
    if (
      !rendered ||
      firstUsername.epoch < scenario.startEpoch + rendered.at - CLOCK_SLACK_MS
    )
      fail("the username was requested before DSM rendered the account panel");
  }
  for (const { stage, label } of scenario.inFlight ?? []) {
    const request = grants(stage)[0];
    const step = collected?.applied.find((item) => item.label === label);
    const at = step && scenario.startEpoch + step.at;
    if (
      !request ||
      !step ||
      at < request.epoch - CLOCK_SLACK_MS ||
      at > request.replyEpoch + CLOCK_SLACK_MS
    )
      fail(`${label} did not land while the ${stage} request was in flight`);
  }
  if (
    scenario.initial
      .concat(scenario.steps.map(({ step }) => step))
      .some((step) => step.type === "userType") &&
    !scenario.trustedInputs.length
  )
    fail("no trusted input was delivered");
  if (scenario.pageErrors.length)
    fail(`page errors: ${scenario.pageErrors.join(" | ")}`);
  for (const message of scenario.messages)
    if (message?.type === "sorng_web_network_blocked")
      fail(`the network client blocked ${message.reason ?? "a request"}`);
}

function report(version, seconds) {
  const rows = selected.map((scenario, index) => {
    const terminal = scenario.helperEvents.find((event) =>
      TERMINAL.has(event.detail.phase),
    )?.detail;
    const grants = (stage) =>
      scenario.grants.filter((grant) => grant.stage === stage).length;
    return [
      String(index + 1),
      scenario.name,
      `${scenario.expected.phase}/${scenario.expected.reason}`,
      terminal ? `${terminal.phase}/${terminal.reason}` : "-",
      `${grants("username")}/${grants("password")}`,
      String(scenario.collected?.counts.signIn ?? "-"),
      terminal?.trace?.steps?.length
        ? (terminal.trace.steps.at(-1).t / 1000).toFixed(1)
        : "-",
      scenario.failures.length ? "FAIL" : "PASS",
    ];
  });
  const header = [
    "#",
    "scenario",
    "expected",
    "actual",
    "user/pass",
    "sign-in",
    "end s",
    "result",
  ];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (row) =>
    row.map((cell, column) => cell.padEnd(widths[column])).join("  ");
  console.log(
    `\nSynology DSM website auto-fill, real engine (${version}, ${selected.length} scenarios, concurrency ${concurrency})\n`,
  );
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  rows.forEach((row) => console.log(line(row)));
  for (const item of skipped) console.log(`skipped ${item.name}: ${item.why}`);
  for (const scenario of selected) {
    if (!scenario.failures.length && !options.verbose) continue;
    console.log(`\n${scenario.name}: ${scenario.summary}`);
    for (const failure of scenario.failures) console.log(`  x ${failure}`);
    for (const event of scenario.helperEvents)
      console.log(
        `    ${String(event.at ?? "-").padStart(6)} ms  ${event.detail.phase}/${event.detail.reason}`,
      );
    for (const grant of scenario.grants)
      console.log(
        `    ${String(Math.round(grant.epoch - scenario.startEpoch)).padStart(6)} ms  ${grant.stage} request -> ${grant.status || (grant.aborted ? "aborted" : "pending")}`,
      );
  }
  const failed = selected.filter((scenario) => scenario.failures.length).length;
  console.log(
    `\n${selected.length - failed} passed, ${failed} failed, ${skipped.length} skipped in ${seconds.toFixed(1)} s`,
  );
  return failed;
}

const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 16);
const profile = await mkdtemp(path.join(tmpdir(), "sorng-synology-login-"));
// Edge also writes importer/diagnostic files to TEMP; keep them in the profile.
const browserTemp = path.join(profile, "temp");
await mkdir(browserTemp);
let browser;
let exited;
let devtools;
let failed = 1;
const began = Date.now();
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => tripwire.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  const stderr = [];
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--mute-audio",
      // The app's web view is a visible, unthrottled frame; so are these tabs.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      `--host-resolver-rules=MAP synostatic.synology.com 127.0.0.1:${tripwire.address().port}, MAP *.quickconnect.to 127.0.0.1:${tripwire.address().port}`,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, TEMP: browserTemp, TMP: browserTemp },
    },
  );
  browser.stderr.on("data", (chunk) => {
    stderr.push(chunk);
    if (stderr.length > 64) stderr.shift();
  });
  exited = new Promise((resolve) => {
    browser.once("exit", resolve);
    browser.once("error", resolve);
  });
  let endpoint;
  for (let waited = 0; !endpoint && waited < START_TIMEOUT_MS; waited += 100) {
    if (browser.exitCode !== null)
      throw new Error(
        `Edge exited during startup (code ${browser.exitCode}): ${Buffer.concat(stderr).toString("utf8").slice(-2000)}`,
      );
    const lines = await readFile(
      path.join(profile, "DevToolsActivePort"),
      "utf8",
    )
      .then((value) => value.split(/\r?\n/))
      .catch(() => []);
    if (lines[1]) endpoint = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
    else await delay(100);
  }
  if (!endpoint)
    throw new Error(
      `Edge headless did not publish a DevTools endpoint: ${Buffer.concat(stderr).toString("utf8").slice(-2000)}`,
    );
  devtools = await DevTools.connect(endpoint);
  const { product } = await devtools.send("Browser.getVersion");
  devtools.on((method, params, sessionId) => {
    const scenario = sessions.get(sessionId);
    if (!scenario) return;
    if (method === "Runtime.bindingCalled" && params.name === BINDING)
      record(devtools, scenario, JSON.parse(params.payload));
    else if (method === "Inspector.targetCrashed")
      scenario.failures.push("the renderer crashed");
    else if (method === "Runtime.exceptionThrown")
      scenario.pageErrors.push(
        `web view: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`,
      );
  });
  console.log(
    `${product}: running ${selected.length} scenarios, up to ${concurrency} tabs at a time`,
  );
  // Longest first, so short timelines fill the remaining tabs.
  const queue = [...selected].sort((a, b) => b.runMs - a.runMs);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await runScenario(devtools, queue.shift());
    }),
  );
  failed = report(product, (Date.now() - began) / 1000);
  if (directBytes) {
    console.log(
      `x ${directBytes} bytes reached the Synology/QuickConnect tripwire`,
    );
    failed++;
  }
} catch (error) {
  console.error(`Acceptance could not run: ${error.message}`);
  failed = Math.max(failed, 1);
} finally {
  if (devtools) {
    await devtools.send("Browser.close", {}, undefined, 5000).catch(() => {});
    devtools.close();
  }
  if (browser?.pid) {
    const stopped = await Promise.race([exited, delay(5000, false)]);
    if (stopped === false && browser.exitCode === null) {
      const stop = spawn(
        "taskkill.exe",
        ["/PID", String(browser.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      await new Promise((resolve) => stop.once("exit", resolve));
      await exited;
    }
  }
  for (const scenario of scenarios)
    for (const response of scenario.held) response.destroy();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => tripwire.close(resolve));
  if (
    path.dirname(profile) === path.resolve(tmpdir()) &&
    path.basename(profile).startsWith("sorng-synology-login-")
  )
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
}
process.exitCode = failed ? 1 : 0;
