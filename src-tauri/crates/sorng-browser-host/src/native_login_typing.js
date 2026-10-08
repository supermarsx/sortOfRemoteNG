// Private helper, installed only by the native renderer. This transports roles
// and receipts, never credential strings. Only CEF sends actual keyboard input.
function createLoginKeyboard(signal) {
  let active = null, lastField = null;
  const acceptedEvents = new WeakSet();
  const now = Date.now.bind(Date);
  const send = (row, action, index = 0) => signal(`type|${action}|${row.stage}|${row.field}|${index}`);
  function finish(ok) {
    const row = active;
    if (!row) return;
    active = null;
    clearTimeout(row.timer);
    clearTimeout(row.expiry);
    row.text = "";
    if (ok) { lastField = row.element; row.resolve(true); }
    else { send(row, "cancel"); row.reject(new Error("native-typing-cancelled")); }
  }
  function current(row) {
    return active === row && now() < row.until && row.guard() &&
      location.href === row.url && document.activeElement === row.element &&
      row.element.isConnected && !row.element.disabled && !row.element.readOnly &&
      row.element.value === row.text.slice(0, row.position) &&
      (row.element.selectionStart === null || (row.element.selectionStart === row.position && row.element.selectionEnd === row.position));
  }
  document.addEventListener("keydown", event => {
    const row = active;
    if (!row) return;
    if (!row.armed || !current(row) || event.target !== row.element || event.ctrlKey || event.altKey || event.metaKey ||
        (event.key.length !== 1 && !["Unidentified", "Process"].includes(event.key))) {
      if (row.armed) event.preventDefault();
      finish(false);
    }
  }, true);
  document.addEventListener("beforeinput", event => {
    const row = active;
    if (!row) return;
    if (!row.armed || !event.isTrusted || !current(row) || event.target !== row.element ||
        event.inputType !== "insertText" || !event.data ||
        row.text.slice(row.position, row.position + event.data.length) !== event.data) {
      if (row.armed) event.preventDefault();
      finish(false);
    }
  }, true);
  document.addEventListener("input", event => {
    const row = active;
    if (!row) return;
    const length = row.element.value.length;
    if (!row.armed || !event.isTrusted || event.target !== row.element || !row.guard() ||
        event.inputType !== "insertText" || length <= row.position || length > row.position + 2 ||
        row.element.value !== row.text.slice(0, length)) { finish(false); return; }
    acceptedEvents.add(event);
    row.position = length;
    row.armed = false;
  }, true);
  document.addEventListener("pointerdown", () => finish(false), true);
  document.addEventListener("focusin", event => {
    if (active && event.target !== active.element) finish(false);
  }, true);
  window.addEventListener("pagehide", () => finish(false), { once:true });
  return {
    ownsEvent: event => acceptedEvents.has(event),
    cancel: () => finish(false),
    write(element, text, guard, stage, field, until) {
      return new Promise((resolve, reject) => {
        if (active || !element || element.tagName !== "INPUT" || element.value ||
            typeof text !== "string" || !text || text.length > 4096 || /[\x00-\x1f\x7f]/.test(text) ||
            !guard() || until <= now() ||
            ![document.body, element, lastField].includes(document.activeElement)) {
          reject(new Error("native-typing-target")); return;
        }
        const row = { element, text, guard, stage, field, until, resolve, reject,
          position:0, armed:false, waiting:false, url:location.href, timer:null, expiry:null };
        active = row;
        element.focus({preventScroll:true});
        if (!current(row)) { finish(false); return; }
        row.expiry = setTimeout(() => finish(false), Math.max(0, until - now()));
        send(row, "start");
      });
    },
    dispatch(command, index, _deadline, _submit, role) {
      const row = active;
      if (!row || role !== `type|${row.stage}|${row.field}`) return false;
      if (command === "wait") {
        if (row.armed || row.position || row.waiting || !current(row) || !Number.isInteger(index) || index < 1 || index > 1000) { finish(false); return false; }
        row.waiting = true;
        row.timer = setTimeout(() => {
          row.waiting = false;
          if (!current(row)) { finish(false); return; }
          send(row, "start");
        }, index);
        return true;
      }
      if (command !== "probe" || row.waiting || !Number.isInteger(index) || index < 0 || index > row.text.length) { finish(false); return false; }
      row.waiting = true;
      const limit = Math.min(row.until, now() + 1500);
      const probe = () => {
        if (active !== row) return;
        if (row.armed && row.position < index && now() < limit) { row.timer = setTimeout(probe, 20); return; }
        row.waiting = false;
        if (row.armed || row.position !== index || !current(row)) { finish(false); return; }
        if (index === row.text.length) { finish(true); return; }
        row.armed = true;
        send(row, "key", index);
      };
      row.timer = setTimeout(probe, 30);
      return true;
    },
  };
}
