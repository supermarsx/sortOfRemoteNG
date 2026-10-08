/* Page-owned observation, not an authentication adapter or credential injector. */
(() => {
  "use strict";
  const config = JSON.parse(
    document.getElementById("fixture-config").textContent,
  );
  const output = document.getElementById("result");
  const form = document.getElementById("login");
  if (!form) {
    fetch("/report")
      .then((r) => r.json())
      .then((report) => {
        output.textContent = JSON.stringify(report, null, 2);
      });
    return;
  }
  const events = Object.create(null);
  for (const input of form.querySelectorAll("input[data-field]")) {
    const counts = (events[input.dataset.field] = {
      keydown: 0,
      keyup: 0,
      beforeinput: 0,
      input: 0,
      untrusted: 0,
      nonInsertText: 0,
      unfocused: 0,
    });
    for (const type of ["keydown", "keyup", "beforeinput", "input"]) {
      input.addEventListener(type, (event) => {
        // Count only. Never copy/log event.key, event.data, or field values.
        if (event.isTrusted) counts[type]++;
        else counts.untrusted++;
        if (
          (type === "beforeinput" || type === "input") &&
          event.inputType !== "insertText"
        )
          counts.nonInsertText++;
        if (document.activeElement !== input) counts.unfocused++;
      });
    }
  }
  let pending = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const values = Object.create(null);
    for (const input of form.querySelectorAll("input[data-field]"))
      values[input.dataset.field] = input.value;
    try {
      const response = await fetch("/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: config.stage,
          nonce: config.nonce,
          values,
          events,
          secureContext: isSecureContext,
          topLevel: window.top === window,
          tauriAbsent: typeof window.__TAURI_INTERNALS__ === "undefined",
          trustedSubmit: event.isTrusted,
        }),
      });
      if (!response.ok) throw new Error("fixture-rejected");
      const result = await response.json();
      output.textContent = JSON.stringify(result.report, null, 2);
      window.location.assign(result.nextPath);
    } catch {
      output.textContent =
        "Fixture rejected or transport failed. Restart the flow; no acceptance recorded.";
    } finally {
      for (const name of Object.keys(values)) values[name] = "";
    }
  });
})();
