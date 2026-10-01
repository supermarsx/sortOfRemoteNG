/* Test-only Wry all-frame observer. Native filters IPC request.uri against
 * exact reviewed document origins and schema-validates every snapshot.
 * The hostname check is observation scoping, never network authorization.
 */
(() => {
  "use strict";
  if (
    window === window.top ||
    window.parent !== window.top ||
    !/^p[0-9a-f]{32}\.localhost$/.test(location.hostname)
  )
    return;
  // WebView2's top-level WebMessageReceived does not receive child-frame IPC.
  // Relay through the source/origin/current-document-validated test parent.
  const send = window.parent.postMessage.bind(window.parent);
  const started = performance.now();
  const errors = {
    scriptErrors: 0,
    cspViolations: 0,
    bootstrapErrors: 0,
    turnstileErrors: 0,
    resourceErrors: 0,
  };
  let samples = 0,
    timer = null,
    stopped = false;
  function increment(key) {
    errors[key] = Math.min(1000, errors[key] + 1);
  }
  function classify(message) {
    if (typeof message !== "string") return;
    const text = message.slice(0, 4096); // Transient; never included in IPC.
    if (
      text.includes("Invalid Cloudflare challenge route") ||
      text.includes("Invalid network route configuration") ||
      text.includes("Network route document mismatch")
    )
      increment("bootstrapErrors");
    if (text.includes("Could not find Turnstile valid script tag"))
      increment("turnstileErrors");
  }
  function onError(event) {
    if (event.target !== window && event.target instanceof Element) {
      increment("resourceErrors");
      return;
    }
    increment("scriptErrors");
    classify(event.message);
  }
  function onRejection(event) {
    increment("scriptErrors");
    const reason = event.reason;
    // Never stringify arbitrary objects that could contain account/token data.
    if (typeof reason === "string") classify(reason);
    else if (reason instanceof Error && typeof reason.message === "string")
      classify(reason.message);
  }
  function onCsp() {
    increment("cspViolations");
  }
  function visible(element) {
    if (!(element instanceof HTMLElement) || !element.getClientRects().length)
      return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0"
      )
        return false;
    }
    return true;
  }
  function count(selector) {
    let total = 0;
    for (const element of document.querySelectorAll(selector)) {
      if (visible(element)) total++;
      if (total === 100) break;
    }
    return total;
  }
  function snapshot() {
    const body = document.body;
    // Only bounded length and fixed phrase booleans leave this function.
    // No input values, storage, cookies, innerHTML, raw text, title or URLs.
    let text = "",
      textLength = 0;
    if (body) {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node,
        visited = 0;
      while ((node = walker.nextNode())) {
        if (++visited > 20000 || textLength >= 1000000) break;
        if (
          node.parentElement?.closest(
            "script,style,textarea,input,select,option,noscript,template",
          )
        )
          continue;
        const part = node.nodeValue || "";
        textLength += Math.min(part.length, 1000000 - textLength);
        if (text.length < 65536)
          text += part.slice(0, 65536 - text.length) + " ";
      }
    }
    const lower = text.toLowerCase();
    let challengeFrame = false;
    for (const frame of document.querySelectorAll("iframe[src]")) {
      if (!visible(frame)) continue;
      try {
        const url = new URL(frame.getAttribute("src"), document.baseURI);
        if (
          url.origin === "https://challenges.cloudflare.com" ||
          url.pathname.startsWith("/cdn-cgi/challenge-platform/") ||
          url.pathname.startsWith("/turnstile/") ||
          /recaptcha|hcaptcha/i.test(url.pathname)
        )
          challengeFrame = true;
      } catch {
        /* No URL/error text is reported. */
      }
      if (challengeFrame) break;
    }
    const turnstile =
      count(".cf-turnstile") > 0 ||
      !!document.querySelector('input[name="cf-turnstile-response"]');
    const root = document.documentElement;
    return {
      readyState: ["loading", "interactive", "complete"].includes(
        document.readyState,
      )
        ? document.readyState
        : "loading",
      emailFields: count(
        'input[type="email"], input#identifierId[name="identifier"], input[autocomplete="username"], input#loginUsername[name="loginUsername"]',
      ),
      passwordFields: count('input[type="password"]'),
      bodyElements: body
        ? Math.min(100000, body.getElementsByTagName("*").length)
        : 0,
      bodyTextLength: textLength,
      bodyVisible: visible(body),
      darkReady: !!root && root.hasAttribute("data-sorng-dark-ready"),
      darkPresented: !!root && root.hasAttribute("data-sorng-dark-presented"),
      challenge:
        challengeFrame ||
        turnstile ||
        typeof window._cf_chl_opt !== "undefined" ||
        !!document.querySelector(
          "#challenge-form, #challenge-running, #challenge-stage",
        ) ||
        count(
          'input[autocomplete="one-time-code"], input[name*="captcha" i]:not([type="hidden"]), input[name*="recovery" i], [data-challengetype*="captcha" i], #twoFactorLoginContainer, #twoFactorLoginContainerEmail, #twoFactorLoginContainerEmailNoCookie, #modal_forceCcaptcha',
        ) > 0,
      turnstile,
      insecureBrowser:
        lower.includes("this browser or app may not be secure") ||
        lower.includes("browser is not supported") ||
        lower.includes("unsupported browser") ||
        lower.includes("try using a different browser") ||
        lower.includes("couldn't sign you in") ||
        lower.includes("couldn’t sign you in"),
      accessDenied:
        /\baccess denied\b|\brequest blocked\b|\byou have been blocked\b/.test(
          lower,
        ),
      ...errors,
    };
  }
  function report() {
    samples++;
    try {
      const url = new URL(location.href);
      // Match the production readiness bridge without normalizing signed/raw query values.
      const query = url.search
        .slice(1)
        .split("&")
        .filter(
          (part) =>
            ![
              "__sorng_navigation_v1",
              "__sorng_generation_v1",
              "__sorng_google_hop_v1",
            ].includes(part.split("=")[0]),
        )
        .join("&");
      url.search = query ? `?${query}` : "";
      send(
        {
          type: "native_live_observation",
          url: url.href,
          snapshot: snapshot(),
        },
        "*",
      );
    } catch {
      stop();
    } // Never manufacture a zero-error success after a failed read.
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("securitypolicyviolation", onCsp);
    window.removeEventListener("pagehide", stop);
  }
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("securitypolicyviolation", onCsp);
  window.addEventListener("pagehide", stop, { once: true });
  report();
  if (!stopped)
    timer = setInterval(() => {
      if (performance.now() - started >= 60000 || samples >= 60) stop();
      else report();
    }, 1000);
})();
