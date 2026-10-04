/* Shared Exchange ECP/OWA FBA. Distinct selectors retain destination scope. */
function exchangeFormsDestinationPath(ov) {
  if (
    ov &&
    ov.username === 'form[name="logonForm"] input#username[name="username"]' &&
    ov.password ===
      'form[name="logonForm"] input#password[name="password"][type="password"]' &&
    ov.submit === 'form[name="logonForm"] .signinbutton[role="button"]'
  )
    return "/ecp";
  if (
    ov &&
    ov.username ===
      'form[name="logonForm"][method="post" i] input#username[name="username"]' &&
    ov.password ===
      'form[name="logonForm"][method="post" i] input#password[name="password"][type="password"]' &&
    ov.submit ===
      'form[name="logonForm"][method="post" i] .signinbutton[role="button"]'
  )
    return "/owa";
  return null;
}

function exchangeEcpSelectors(ov) {
  return exchangeFormsDestinationPath(ov) !== null;
}

function exchangeEcpDestination(field, returnPath) {
  var value = field.value;
  if (!value || value.length > 8192 || /[\u0000-\u0020\u007f\s\\]/.test(value))
    throw new Error("unsafe-form-action");
  var rawPath = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  if (
    /%|\/\//.test(rawPath) ||
    rawPath.split("/").some(function (segment) {
      return segment === "." || segment === "..";
    })
  )
    throw new Error("unsafe-form-action");
  var url = new URL(value, document.baseURI);
  var path = url.pathname.toLowerCase();
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(path === returnPath || path.indexOf(returnPath + "/") === 0) ||
    (returnPath === "/owa" && /^\/owa\/auth(?:[/.]|$)/.test(path)) ||
    /%|\/\//.test(url.pathname)
  )
    throw new Error("unsafe-form-action");
  if (url.origin !== location.origin) {
    // A hidden field may still contain its original upstream HTTPS URL.
    // Ask the existing router to prove it maps to THIS proxy origin. Never
    // navigate, overwrite the field, or invent an additional trusted origin.
    if (
      url.protocol !== "https:" ||
      typeof window.__sorng_map_navigation !== "function"
    )
      throw new Error("unsafe-form-action");
    var mapped = new URL(window.__sorng_map_navigation(url.href));
    if (mapped.origin !== location.origin || mapped.pathname !== url.pathname)
      throw new Error("unsafe-form-action");
  }
  return value;
}

function exchangeEcpFingerprint(target) {
  if (!target.exchangeEcp) return null;
  var form = target.form;
  var submit = target.submit;
  var action = new URL(form.getAttribute("action"), document.baseURI);
  if (
    action.origin !== location.origin ||
    action.username ||
    action.password ||
    action.hash ||
    action.pathname.toLowerCase() !== "/owa/auth.owa" ||
    Array.from(action.searchParams).some(function (pair) {
      return (
        !/^__sorng_(generation|navigation)_v1$/.test(pair[0]) ||
        !/^[a-f0-9]{32}$/.test(pair[1])
      );
    })
  )
    throw new Error("unsafe-form-action");
  if (
    form.method.toLowerCase() !== "post" ||
    form.enctype.toLowerCase() !== "application/x-www-form-urlencoded"
  )
    throw new Error("unsafe-form-method");
  var base = document.querySelector("base[target]");
  var context =
    form.getAttribute("target") ?? (base && base.getAttribute("target")) ?? "";
  if (context && context.toLowerCase() !== "_self")
    throw new Error("unsafe-form-target");
  if (
    ["formaction", "formmethod", "formtarget", "form"].some(function (name) {
      return submit.hasAttribute(name);
    })
  )
    throw new Error("unsafe-form-target");
  var destinations = Array.from(form.elements).filter(function (element) {
    return (element.name || "").toLowerCase() === "destination";
  });
  var destination = destinations[0];
  if (
    destinations.length !== 1 ||
    destination !== target.exchangeEcp.destination ||
    destination.type !== "hidden" ||
    destination.disabled ||
    destination.name !== "destination"
  )
    throw new Error("unsafe-form-action");
  return [
    exchangeEcpDestination(destination, target.exchangeEcp.returnPath),
    context,
    form.enctype,
    submit.getAttribute("onclick"),
  ];
}

function exchangeEcpTarget(root, ov, user, pw) {
  if (!exchangeEcpSelectors(ov) || root !== document || !user || !pw.form)
    return null;
  // Both applications redirect here. The configured selectors constrain the
  // return destination; never automate expiry or federated login lookalikes.
  if (location.pathname.toLowerCase() !== "/owa/auth/logon.aspx") return null;
  var reasons = new URL(location.href).searchParams.getAll("reason");
  if (
    reasons.some(function (reason) {
      return reason !== "0";
    })
  )
    return null;
  var form = pw.form;
  var buttons = document.querySelectorAll(ov.submit);
  var button = buttons.length === 1 ? buttons[0] : null;
  if (
    document.querySelectorAll('form[name="logonForm"]').length !== 1 ||
    document.querySelectorAll(ov.username).length !== 1 ||
    document.querySelectorAll(ov.password).length !== 1 ||
    user.form !== form ||
    form.querySelector(
      'input[autocomplete="one-time-code"], input[autocomplete="new-password"]',
    ) ||
    !button ||
    !form.contains(button) ||
    !isVisible(button) ||
    (button.form && button.form !== form) ||
    !/^\s*(?:return\s+)?clkLgn\(\s*\)\s*;?\s*$/.test(
      button.getAttribute("onclick") || "",
    ) ||
    typeof button.onclick !== "function" ||
    typeof window.clkLgn !== "function" ||
    [user, pw, button].some(function (element) {
      return !!element.closest(
        '[inert], [aria-busy="true"], [aria-disabled="true"]',
      );
    })
  )
    return null;
  // Extra visible entry fields, CAPTCHA and visible server errors require
  // the user. In particular never treat passwordText as a second password.
  if (
    Array.from(
      form.querySelectorAll(
        "input, select, textarea, iframe, .g-recaptcha, .h-captcha, .signInError",
      ),
    ).some(function (element) {
      if (!isVisible(element) || element === user || element === pw)
        return false;
      if (
        element.tagName === "INPUT" &&
        /^(hidden|checkbox|radio|submit|button)$/.test(element.type)
      )
        return false;
      if (
        element.classList.contains("signInError") &&
        !element.textContent.trim()
      )
        return false;
      return true;
    })
  )
    return null;
  var target = {
    user: user,
    pw: pw,
    form: form,
    submit: button,
    exchangeEcp: {
      returnPath: exchangeFormsDestinationPath(ov),
      destination: form.querySelector('input[name="destination"]'),
      click: button.onclick,
      login: window.clkLgn,
    },
  };
  exchangeEcpFingerprint(target);
  return target;
}

function sameExchangeEcpHandler(target, found) {
  return (
    !target.exchangeEcp ||
    !!(
      found.exchangeEcp &&
      found.exchangeEcp.returnPath === target.exchangeEcp.returnPath &&
      found.exchangeEcp.destination === target.exchangeEcp.destination &&
      found.exchangeEcp.click === target.exchangeEcp.click &&
      found.exchangeEcp.login === target.exchangeEcp.login
    )
  );
}
