// Native-owned constant template; substitutions are bundled source, never data.
(function () {
  "use strict";
  const nativeWindow = globalThis.window;
  const chrome = {};
  // The vendored API creates a chrome.runtime shim. Keep that entirely private
  // and do not inherit a page's DarkReader plugin or extension message bridge.
  const window = new Proxy(nativeWindow, {
    get(target, key) {
      if (key === "chrome") return chrome;
      if (key === "DarkReader") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  // The bundle can log stylesheet/resource errors containing page data.
  const console = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  const exports = {}, module = { exports };
  /* BUNDLED_DARKREADER */
  return function (notify) {
    return (/* NATIVE_APPEARANCE_CLIENT */)(module.exports, notify);
  };
})()
