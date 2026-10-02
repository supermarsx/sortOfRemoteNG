/* Opt-in native CSP regression probe, separate from normal live readiness runs.
 * Captures the native constructor BEFORE the page shim: successful containment
 * must not depend on the JS wrapper. Only fixed booleans leave the worker.
 * .invalid destinations cannot refer to a real service or account.
 */
(() => {
  if (
    window === top ||
    parent !== top ||
    !/^p[0-9a-f]{32}\.localhost$/.test(location.hostname)
  )
    return;
  const NativeWorker = window.Worker;
  const terminate = NativeWorker.prototype.terminate;
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  const status = {
    workerCheckComplete: false,
    workerComputation: false,
    workerFetchBlocked: false,
    workerSocketBlocked: false,
    workerScriptBlocked: false,
  };
  Object.defineProperty(window, "__sorng_worker_check", { value: status });
  let worker, objectUrl, timer;
  function stop() {
    clearTimeout(timer);
    if (worker) Reflect.apply(terminate, worker, []);
    if (objectUrl) revoke(objectUrl);
  }
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      // Exact CSP events distinguish enforcement from DNS/network failure.
      const code = `
      const status = {workerComputation: 6 * 7 === 42, workerFetchBlocked: false, workerSocketBlocked: false, workerScriptBlocked: false};
      self.addEventListener('securitypolicyviolation', function(event) {
        let host;
        try { host = new URL(event.blockedURI).hostname; } catch (_) { return; }
        if (event.effectiveDirective === 'connect-src' && host === 'fetch.worker-probe.invalid') status.workerFetchBlocked = true;
        if (event.effectiveDirective === 'connect-src' && host === 'socket.worker-probe.invalid') status.workerSocketBlocked = true;
        if (['script-src', 'script-src-elem'].includes(event.effectiveDirective) && host === 'script.worker-probe.invalid') status.workerScriptBlocked = true;
        self.postMessage(status);
      });
      self.postMessage(status);
      fetch('https://fetch.worker-probe.invalid/test', {credentials:'omit'}).catch(function() {});
      try { new WebSocket('wss://socket.worker-probe.invalid/test'); } catch (_) {}
      try { importScripts('https://script.worker-probe.invalid/test.js'); } catch (_) {}
    `;
      try {
        objectUrl = create(new Blob([code], { type: "text/javascript" }));
        worker = new NativeWorker(objectUrl);
        worker.onmessage = ({ data }) => {
          for (const key of Object.keys(status)) {
            if (key !== "workerCheckComplete" && data?.[key] === true)
              status[key] = true;
          }
          if (
            status.workerComputation &&
            status.workerFetchBlocked &&
            status.workerSocketBlocked &&
            status.workerScriptBlocked
          ) {
            status.workerCheckComplete = true;
            stop();
          }
        };
        worker.onerror = () => {
          status.workerCheckComplete = true;
          stop();
        };
        timer = setTimeout(() => {
          status.workerCheckComplete = true;
          stop();
        }, 5000);
      } catch (_) {
        status.workerCheckComplete = true;
        stop();
      }
    },
    { once: true },
  );
  window.addEventListener("pagehide", stop, { once: true });
})();
