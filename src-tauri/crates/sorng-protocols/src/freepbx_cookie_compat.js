// Injected ONLY for the native reviewed FreePBX profile, before page libraries.
// FreePBX 16 script.legacy.js calls the retired jQuery-cookie removeCookie API;
// its bundled js-cookie 2.1.3 instead supplies Cookies.get/remove.
(function () {
  "use strict";
  var cleanup = [];
  var finished = false;
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
