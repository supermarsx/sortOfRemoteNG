function cloudflareInterstitial() {
  const markers = Array.from(
    document.querySelectorAll(
      "#challenge-form, #challenge-running, #challenge-stage, #cf-wrapper, .cf-browser-verification",
    ),
  );
  const marker = markers.some((element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
    }
    return true;
  });
  const text = (document.body?.textContent || "").slice(0, 20000);
  const title = document.title || "";
  const known =
    marker ||
    (markers.length === 0 &&
      ((/performing security verification|incompatible browser extension or network configuration/i.test(
        text,
      ) &&
        /cloudflare|challenges.cloudflare.com|ray id/i.test(text)) ||
        (/just a moment|attention required/i.test(title) &&
          /cloudflare|security verification|enable javascript and cookies/i.test(
            text,
          ))));
  if (!known) return null;
  return /incompatible browser extension or network configuration/i.test(text)
    ? "incompatible"
    : "waiting";
}

function holdCloudflareChallenge() {
  const doc = document,
    origin = location.origin;
  const began = Date.now();
  let challengeBegan = began;
  const retryKey = "sorng-cloudflare-reload.v1";
  let active = null,
    timer = null,
    stopped = false,
    reloaded = false,
    challengeSeen = false;
  const cancelHold = () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("pagehide", cancelHold);
    window.removeEventListener("unload", cancelHold);
    window.removeEventListener("load", poll);
  };
  window.addEventListener("pagehide", cancelHold, { once: true });
  window.addEventListener("unload", cancelHold, { once: true });
  // A full reload replaces this closure. A short, non-secret session marker
  // prevents the successor from repeating the same single reload.
  try {
    reloaded = Date.now() - Number(sessionStorage.getItem(retryKey)) < 120000;
  } catch (_) {
    reloaded = true;
  }
  if (cloudflareInterstitial()) {
    challengeSeen = true;
    notify("challenge-waiting");
  }
  window.addEventListener("load", poll, { once: true });
  function poll() {
    if (stopped || document !== doc || location.origin !== origin)
      return cancelHold();
    clearTimeout(timer);
    const challenge = cloudflareInterstitial();
    if (challenge && !challengeSeen) {
      challengeSeen = true;
      challengeBegan = Date.now();
      notify("challenge-waiting");
    }
    if (!challenge && doc.readyState === "loading") {
      if (Date.now() - began >= 60000) {
        cancelHold();
        notify("form-rejected");
        return;
      }
      timer = setTimeout(poll, 125);
      return;
    }
    if (!challenge) {
      clearTimeout(timer);
      window.removeEventListener("pagehide", cancelHold);
      window.removeEventListener("unload", cancelHold);
      window.removeEventListener("load", poll);
      try {
        sessionStorage.removeItem(retryKey);
      } catch (_) {}
      active = nativeLoginClient(notify, configuration, adapter, nativeTyping);
      return;
    }
    if (Date.now() - challengeBegan >= 120000) {
      cancelHold();
      notify("challenge-timeout");
      return;
    }
    if (
      challenge === "incompatible" &&
      !reloaded &&
      Date.now() - challengeBegan >= 5000
    ) {
      reloaded = true;
      try {
        sessionStorage.setItem(retryKey, String(Date.now()));
      } catch (_) {}
      notify("challenge-reloading");
      // The authenticated native observation performs the one-per-attempt reload.
      // Page script never owns the retry budget or the browser reload action.
    }
    timer = setTimeout(poll, 125);
  }
  timer = setTimeout(poll, 0);
  const deliverAfterChallenge = (...args) => (active ? active(...args) : false);
  Object.defineProperty(deliverAfterChallenge, "nativeTyping", {
    value: (...args) => active?.nativeTyping?.(...args) ?? false,
  });
  Object.defineProperty(deliverAfterChallenge, "declarativeReason", {
    get: () => active?.declarativeReason,
  });
  return deliverAfterChallenge;
}
