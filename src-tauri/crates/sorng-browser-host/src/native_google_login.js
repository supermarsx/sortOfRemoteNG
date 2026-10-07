// Private factory; CEF owns the returned delivery callback. The reviewed client
// receives an explicit native transport and never executes its legacy fetch.
(function (notify) {
  "use strict";
  /* REVIEWED_DOM_HELPERS */
  const module = {exports:{},__sorngNativeGoogle:true};
  /* REVIEWED_GOOGLE_CLIENT */
  const createClient = module.exports;
  const doc = document;
  const origin = "https://accounts.google.com";
  if (location.origin !== origin || window.top !== window) return function(){return false;};
  const now = Date.now.bind(Date);
  let pending = null;
  let expires = 0;
  let stopped = false;
  let started = false;
  const delivered = new Set();
  function current() {
    return !stopped && window.top === window && document === doc && location.origin === origin;
  }
  function credentialGuard() { return current() && now() <= expires; }
  function safeButton(button) {
    if (!button || button.ownerDocument !== doc || !button.isConnected || button.disabled
      || button.closest('[inert],[aria-disabled="true"],[aria-busy="true"]')) return false;
    if (button.type !== "submit" || !button.form) return true;
    const form=button.form;
    const action=new URL(button.getAttribute("formaction") || form.action, doc.baseURI);
    const method=button.hasAttribute("formmethod") ? button.getAttribute("formmethod") : form.method;
    const target=button.hasAttribute("formtarget") ? button.getAttribute("formtarget") : form.target;
    return action.origin===origin && !action.username && !action.password && method.toLowerCase()==="post"
      && (!target || target.toLowerCase()==="_self");
  }
  const transport = {
    read(stage, signal) {
      return new Promise((resolve,reject)=> {
        if (!current() || pending || delivered.has(stage) || signal.aborted) return reject(new Error("grant"));
        pending={stage,resolve,reject};
        signal.addEventListener("abort",()=> {
          if (pending && pending.stage===stage) { const reject=pending.reject;pending=null;reject(new Error("cancelled")); }
        },{once:true});
        notify(stage);
      });
    },
    click(button) {
      if (!credentialGuard() || !safeButton(button)) throw new Error("changed");
      button.click();
    },
  };
  const client=createClient(transport);
  const helpers={
    isVisible(element) {
      return current() && element.ownerDocument===doc && element.isConnected && isVisible(element)
        && (element.tagName!=="BUTTON" || safeButton(element));
    },
    fillField(element,value,guard,postWriteGuard) {
      const checked=inner=>()=>credentialGuard() && element.ownerDocument===doc && element.isConnected && inner();
      return fillField(element,value,checked(guard),checked(postWriteGuard || guard));
    },
    report(result) { notify(result.ok ? "google-completed" : "google-rejected"); },
  };
  function start() {
    if (started || !current() || !doc.documentElement) return;
    started=true;
    // This marker only satisfies the reviewed client's continuation shape.
    // It grants nothing: the native host separately fences both stage releases.
    const continuation="0".repeat(32);
    if (/^\/(v3\/signin|signin\/v2|signin)\/challenge\/pwd$/.test(location.pathname))
      client.runPasswordWhenReady(continuation,helpers);
    else client.runWhenReady(continuation,helpers);
  }
  // Wait until CEF has stored its native document record before requesting.
  const startTimer=setInterval(()=> {start();if(started || stopped)clearInterval(startTimer);},250);
  doc.addEventListener("DOMContentLoaded",start,{once:true});
  window.addEventListener("pagehide",()=>{stopped=true;clearInterval(startTimer);client.cancel();},{once:true});
  return function(expectedOrigin,username,password,autoSubmit,deadline,stage) {
    if (!current() || expectedOrigin!==origin || !pending || pending.stage!==stage || delivered.has(stage)
      || !Number.isFinite(deadline) || now()>deadline) return false;
    if ((stage==="identifier" && (password!=="" || !username)) || (stage==="password" && (username!=="" || !password))) return false;
    const resolve=pending.resolve;
    pending=null;
    expires=deadline;
    delivered.add(stage);
    if (stage==="identifier") resolve({loginFlow:"google",username,continuation:"0".repeat(32),autoSubmit});
    else resolve({loginFlow:"google",password,autoSubmit});
    return true;
  };
})
