// Injected ONLY for the native reviewed FreePBX profile, before page libraries.
// FreePBX 16 script.legacy.js calls the retired jQuery-cookie removeCookie API;
// its bundled js-cookie 2.1.3 instead supplies Cookies.get/remove.
// The same legacy bundle requests an authenticated navbar preference on the
// signed-out login page. Prevent that optional request before transport rather
// than consuming a 401 or changing the global logout/error handling.
(function () {
  "use strict";
  var cleanup = [];
  var finished = false;
  var navbarJquery = null;
  function installNavbarGuard(jq) {
    if (navbarJquery === jq || typeof jq.ajaxPrefilter !== "function") return;
    navbarJquery = jq;
    var live = true;
    window.addEventListener(
      "pagehide",
      function () {
        live = false;
      },
      { once: true },
    );
    jq.ajaxPrefilter(function (options, original, request) {
      if (
        !live ||
        options.type !== "POST" ||
        options.dataType !== "json" ||
        (options.data !== undefined && options.data !== "")
      )
        return;
      var target;
      try {
        target = new URL(options.url, document.baseURI);
      } catch (_) {
        return;
      }
      // No click=true mutations, other commands, credentials, extra queries,
      // or foreign authorities. Unknown layouts retain the application's flow.
      if (
        !/\/admin\/$/.test(location.pathname) ||
        target.origin !== location.origin ||
        target.username ||
        target.password ||
        target.hash ||
        target.pathname !== location.pathname + "ajax.php" ||
        target.search !== "?command=navbarToogle"
      )
        return;
      if (
        document.querySelectorAll("a#login_admin.login_item").length !== 1 ||
        document.querySelectorAll("#login_form").length !== 1
      )
        return;
      var login = document.querySelector('#login_form form[id="loginform"]');
      if (
        !login ||
        !login.querySelector('input[name="username"][type="text"]') ||
        !login.querySelector('input[name="password"][type="password"]')
      )
        return;
      // jQuery prefilters run before transport/global AJAX bookkeeping. Abort
      // leaves a rejected jqXHR (status 0), never a fake success or hidden 401.
      request.abort("freepbx-navbar-requires-login");
    });
  }
  function stop() {
    finished = true;
    cleanup.splice(0).forEach(function (restore) {
      restore();
    });
    window.removeEventListener("pagehide", stop);
  }
  function install() {
    if (finished) return;
    var jq = window.jQuery;
    var cookies = window.Cookies;
    if (!jq || !jq.fn || typeof jq.fn.jquery !== "string") return;
    installNavbarGuard(jq);
    if (typeof jq.removeCookie !== "undefined") {
      stop();
      return;
    }
    if (
      !cookies ||
      typeof cookies.get !== "function" ||
      typeof cookies.remove !== "function"
    )
      return;
    if (!Object.isExtensible(jq)) {
      stop();
      return;
    }
    jq.removeCookie = function (key, options) {
      if (typeof cookies.get(key) === "undefined") return false;
      cookies.remove(key, options);
      return typeof cookies.get(key) === "undefined";
    };
    stop();
  }
  function watch(name) {
    if (finished) return;
    var descriptor = Object.getOwnPropertyDescriptor(window, name);
    // Do not replace somebody else's accessors or locked globals.
    if (
      descriptor &&
      (!descriptor.configurable ||
        !descriptor.writable ||
        descriptor.get ||
        descriptor.set)
    )
      return;
    var value = window[name];
    function get() {
      return value;
    }
    function set(next) {
      value = next;
      install();
    }
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor ? descriptor.enumerable : true,
      get: get,
      set: set,
    });
    cleanup.push(function () {
      if (Object.getOwnPropertyDescriptor(window, name)?.get !== get) return;
      if (!descriptor && value === undefined) {
        delete window[name];
        return;
      }
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : true,
        writable: true,
        value: value,
      });
    });
  }
  install();
  watch("jQuery");
  watch("Cookies");
  if (!finished) window.addEventListener("pagehide", stop, { once: true });
})();
