// CEF evaluates this factory at context creation; its returned closure is held
// only by native code. No credentials, callbacks or state are put on window.
(function (notify, adapter) {
  "use strict";
  // Explicit manual mode still installs a renderer closure for the pinned
  // dark-mode handshake, but never discovers forms or accepts delivery.
  if (adapter === "manual") return function () { return false; };
  /* REVIEWED_DOM_HELPERS */
  /* REVIEWED_PORKBUN_ADAPTER */
  /* REVIEWED_EXCHANGE_ADAPTER */
  /* REVIEWED_VODAFONE_ADAPTER */
  const origin = location.origin;
  const doc = document;
  const now = Date.now.bind(Date);
  const originalSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  let captured = null;
  let requested = false;
  let delivered = false;
  let stopped = false;

  function target() {
    if (window.top !== window || location.protocol !== "https:" || location.origin !== origin) return null;
    if (adapter === "vodafone-smart-router-3") {
      const reviewed = vodafoneRouterTarget(doc, {
        username: '#mainbody #logindiv input#username[type="text"]:enabled:not([readonly])',
        password: '#mainbody #logindiv input#userpwd[type="password"]:enabled:not([readonly])',
        submit: '#mainbody #logindiv input#loginbtn[type="button"][name="login"]:enabled',
      });
      if (!reviewed) return null;
      reviewed.fingerprint = JSON.stringify([doc.baseURI, reviewed.user.name, reviewed.pw.name, reviewed.submit.getAttribute("onclick")]);
      return reviewed;
    }
    if (adapter === "exchange-ecp" || adapter === "exchange-owa") {
      const prefix = adapter === "exchange-owa" ? 'form[name="logonForm"][method="post" i]' : 'form[name="logonForm"]';
      const selectors = {
        username: prefix + ' input#username[name="username"]',
        password: prefix + ' input#password[name="password"][type="password"]',
        submit: prefix + ' .signinbutton[role="button"]',
      };
      const user = doc.querySelector(selectors.username), pw = doc.querySelector(selectors.password);
      if (!user || !pw || !isVisible(user) || !isVisible(pw) || !pw.form) return null;
      const destination = pw.form.querySelector('input[name="destination"]');
      if (!destination) return null;
      // Reject before invoking the shared validator: its legacy proxy mapping
      // branch is unreachable here. Native cookies/URLs are never rewritten.
      const destinationUrl = new URL(destination.value, doc.baseURI);
      const action = new URL(pw.form.getAttribute("action"), doc.baseURI);
      if (destinationUrl.origin !== origin || action.origin !== origin || action.search) return null;
      const reviewed = exchangeEcpTarget(doc, selectors, user, pw);
      if (!reviewed) return null;
      reviewed.fingerprint = JSON.stringify([doc.baseURI, action.href, user.type, user.autocomplete, pw.autocomplete,
        exchangeEcpFingerprint(reviewed)]);
      return reviewed;
    }
    if (adapter === "porkbun") {
      if ((location.hostname !== "porkbun.com" && location.hostname !== "www.porkbun.com") || location.pathname !== "/account/login") return null;
      const selectors = {
        username: 'form#loginForm input#loginUsername[name="loginUsername"][autocomplete="username"]',
        password: 'form#loginForm input#loginPassword[name="loginPassword"][type="password"]',
        submit: '#accountLoginButtonContainer button#accountLoginButton',
      };
      const user = doc.querySelector(selectors.username);
      const pw = doc.querySelector(selectors.password);
      if (!user || !pw || !isVisible(user) || !isVisible(pw)) return null;
      const reviewed = porkbunTarget(doc, selectors, user, pw);
      if (!reviewed) return null;
      reviewed.fingerprint = JSON.stringify([doc.baseURI, reviewed.form.getAttribute("action"), user.id, user.name, user.type, pw.id, pw.name, pw.type]);
      return reviewed;
    }
    if (adapter !== "generic-form") return null;
    const passwords = Array.from(doc.querySelectorAll('input[type="password"]')).filter(isVisible);
    if (passwords.length !== 1) return null;
    const pw = passwords[0];
    if (pw.autocomplete === "new-password") return null;
    const form = pw.form;
    if (!form || form.ownerDocument !== doc || !form.isConnected || form.method.toLowerCase() !== "post") return null;
    if (form.target && form.target.toLowerCase() !== "_self") return null;
    const users = Array.from(form.querySelectorAll('input[type="text"],input[type="email"],input:not([type])'))
      .filter(el => el.form === form && isVisible(el) && matchesHint(el));
    if (users.length !== 1) return null;
    const user = users[0];
    const buttons = Array.from(form.querySelectorAll('button[type="submit"],button:not([type]),input[type="submit"]'))
      .filter(el => el.form === form && isVisible(el));
    if (buttons.length !== 1) return null;
    const submit = buttons[0];
    const action = new URL(submit.getAttribute("formaction") || form.action, doc.baseURI);
    const method = submit.hasAttribute("formmethod") ? submit.getAttribute("formmethod") : form.method;
    const destination = submit.hasAttribute("formtarget") ? submit.getAttribute("formtarget")
      : (form.getAttribute("target") ?? doc.querySelector('base[target]')?.getAttribute("target") ?? "");
    if (action.origin !== origin || action.username || action.password || method.toLowerCase() !== "post"
        || (destination && destination.toLowerCase() !== "_self")) return null;
    if ([user,pw,submit].some(el => el.ownerDocument !== doc || !el.isConnected || el.closest('[inert],[aria-disabled="true"],[aria-busy="true"]'))) return null;
    const fingerprint = JSON.stringify([action.href,method,destination,doc.baseURI,
      user.id,user.name,user.type,user.autocomplete,pw.id,pw.name,pw.type,pw.autocomplete,
      form.getAttribute("action"),submit.getAttribute("formaction")]);
    return {user,pw,form,submit,fingerprint};
  }
  function unchanged() {
    const next = target();
    return next && captured && next.user === captured.user && next.pw === captured.pw
      && next.form === captured.form && next.submit === captured.submit && next.fingerprint === captured.fingerprint
      && sameExchangeEcpHandler(captured, next) && sameVodafoneRouterHandler(captured, next)
      && (!captured.porkbun || (next.porkbun && next.porkbun.click === captured.porkbun.click
        && next.porkbun.exec === captured.porkbun.exec && next.porkbun.login === captured.porkbun.login));
  }
  function scan() {
    if (requested || stopped) return;
    try {
      captured = target();
      if (!captured) return;
      requested = true;
      observer.disconnect();
      notify();
    } catch (_) { stopped = true; observer.disconnect(); }
  }
  const observer = new MutationObserver(scan);
  observer.observe(doc, {childList:true,subtree:true,attributes:true});
  doc.addEventListener("DOMContentLoaded", scan, {once:true});
  // Mutations and layout/visibility changes need not coincide. A bounded timer
  // keeps delayed forms active without retaining credentials during discovery.
  let ticks = 0;
  const timer = setInterval(() => {
    if (requested || stopped || ++ticks > 240) { clearInterval(timer); observer.disconnect(); return; }
    scan();
  }, 250);
  window.addEventListener("pagehide", () => { stopped=true; observer.disconnect(); clearInterval(timer); }, {once:true});
  return function (expectedOrigin, username, password, autoSubmit, expires) {
    if (delivered || stopped || !requested || expectedOrigin !== origin || !Number.isFinite(expires) || now() > expires) return false;
    delivered = true;
    clearInterval(timer);
    const guard = () => !stopped && now() <= expires && unchanged()
      && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set === originalSetter;
    try {
      if (!guard() || !fillField(captured.user, username, guard) || !fillField(captured.pw, password, guard) || !guard()) return false;
      // Never solve CAPTCHA, populate OTP, choose recovery or bypass MFA.
      const manual = doc.querySelector('input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="captcha" i]');
      if (autoSubmit && !manual) captured.submit.click();
      return true;
    } catch (_) { return false; }
  };
})
