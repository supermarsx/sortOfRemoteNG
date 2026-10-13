// Private helper, installed only by the native renderer. This transports roles
// and receipts, never credential strings. Only CEF sends actual keyboard input.
//
// Escape from the user while a fill runs takes the field back: typing stops,
// the text typed into the focused field is erased (prototype setter, then
// input and change events, so a framework sees the empty value), and
// `onEscape` ends the whole attempt, whose client erases its other fields.
function createLoginKeyboard(signal, onEscape) {
  let active = null,
    lastField = null,
    // Fields completed in this attempt, until the client releases the keyboard.
    filled = [],
    // The one key the host may already have sent when Escape erased its field.
    stray = null;
  const acceptedEvents = new WeakSet();
  // The page's own `value` attribute before typing, never the typed text.
  const attributes = new WeakMap();
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  const now = Date.now.bind(Date);
  // Provider/form fingerprints may throw after a page changes its action or
  // controls. Treat that as a stale receipt, including during background waits.
  const guarded = (guard) => {
    try {
      return guard() === true;
    } catch (_) {
      return false;
    }
  };
  const send = (row, action, index = 0) =>
    signal(`type|${action}|${row.stage}|${row.field}|${index}`);
  function erase(element) {
    try {
      valueSetter.call(element, "");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (attributes.has(element)) {
        const before = attributes.get(element);
        if (element.getAttribute("value") !== before) {
          if (before === null) element.removeAttribute("value");
          else element.setAttribute("value", before);
        }
      }
    } catch (_) {
      /* A detached or replaced field holds nothing of ours to erase. */
    }
  }
  function escaped(event) {
    if (
      !onEscape ||
      event.key !== "Escape" ||
      !event.isTrusted ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return false;
    const row = active;
    if (row ? event.target !== row.element : !filled.includes(event.target))
      return false;
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === "function")
      event.stopImmediatePropagation();
    filled = [];
    if (row) {
      // Only text native typing entered so far; never a value someone changed.
      const ours =
        row.position > 0 &&
        row.element.value === row.text.slice(0, row.position);
      // A requested key may still be on its way from the host.
      if (row.armed) stray = { element: row.element, until: now() + 1500 };
      finish(false);
      if (ours) erase(row.element);
    }
    onEscape();
    return true;
  }
  function finish(ok) {
    const row = active;
    if (!row) return;
    active = null;
    clearTimeout(row.timer);
    clearTimeout(row.expiry);
    row.text = "";
    if (ok) {
      lastField = row.element;
      if (filled.length < 64) filled.push(row.element);
      row.resolve(true);
    } else {
      send(row, "cancel");
      row.reject(new Error("native-typing-cancelled"));
    }
  }
  function current(row) {
    return (
      active === row &&
      now() < row.until &&
      guarded(row.guard) &&
      location.href === row.url &&
      document.activeElement === row.element &&
      row.element.isConnected &&
      !row.element.disabled &&
      !row.element.readOnly &&
      row.element.value === row.text.slice(0, row.position) &&
      (row.element.selectionStart === null ||
        (row.element.selectionStart === row.position &&
          row.element.selectionEnd === row.position))
    );
  }
  // A key is entered once two facts hold, in either order: the host's receipt
  // that it sent the key (`probe N+1`) and the trusted DOM input event. The
  // later of the two calls this. No timer is on that path, so a hidden page's
  // throttled timers cannot slow typing; timers here only wait or fail closed.
  function advance(row) {
    clearTimeout(row.timer);
    if (!current(row)) {
      finish(false);
      return false;
    }
    if (row.position < row.text.length) {
      row.armed = true;
      send(row, "key", row.position);
    } else if (row.down) {
      // Leave the field only after its last key is released, so the next
      // field's focus cannot receive that keyup. The timer is a fallback.
      row.timer = setTimeout(() => {
        row.down = false;
        advance(row);
      }, 250);
    } else {
      finish(true);
    }
    return true;
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (escaped(event)) return;
      const row = active;
      if (!row) return;
      if (
        !row.armed ||
        !current(row) ||
        event.target !== row.element ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.key.length !== 1 &&
          !["Unidentified", "Process"].includes(event.key))
      ) {
        if (row.armed) event.preventDefault();
        finish(false);
        return;
      }
      row.down = true;
    },
    true,
  );
  document.addEventListener(
    "beforeinput",
    (event) => {
      if (stray && event.isTrusted && event.inputType === "insertText") {
        const held = stray;
        stray = null;
        if (event.target === held.element && now() < held.until) {
          event.preventDefault();
          return;
        }
      }
      const row = active;
      if (!row) return;
      if (
        !row.armed ||
        !event.isTrusted ||
        !current(row) ||
        event.target !== row.element ||
        event.inputType !== "insertText" ||
        !event.data ||
        row.text.slice(row.position, row.position + event.data.length) !==
          event.data
      ) {
        if (row.armed) event.preventDefault();
        finish(false);
      }
    },
    true,
  );
  document.addEventListener(
    "input",
    (event) => {
      const row = active;
      if (!row) return;
      const length = row.element.value.length;
      if (
        !row.armed ||
        !event.isTrusted ||
        event.target !== row.element ||
        !guarded(row.guard) ||
        event.inputType !== "insertText" ||
        length <= row.position ||
        length > row.position + 2 ||
        row.element.value !== row.text.slice(0, length)
      ) {
        finish(false);
        return;
      }
      acceptedEvents.add(event);
      row.position = length;
      row.armed = false;
      // The host's receipt for this key may have overtaken its DOM event.
      if (row.receipt === row.position) advance(row);
    },
    true,
  );
  document.addEventListener(
    "keyup",
    (event) => {
      const row = active;
      if (!row || !row.down || event.target !== row.element) return;
      row.down = false;
      if (
        !row.armed &&
        row.receipt === row.position &&
        row.position === row.text.length
      )
        advance(row);
    },
    true,
  );
  document.addEventListener("pointerdown", () => finish(false), true);
  document.addEventListener(
    "focusin",
    (event) => {
      if (active && event.target !== active.element) finish(false);
    },
    true,
  );
  window.addEventListener("pagehide", () => finish(false), { once: true });
  return {
    ownsEvent: (event) => acceptedEvents.has(event),
    // The client ends its attempt here, whether it submitted or stopped.
    cancel: () => {
      filled = [];
      finish(false);
    },
    write(element, text, guard, stage, field, until) {
      return new Promise((resolve, reject) => {
        if (
          active ||
          !element ||
          element.tagName !== "INPUT" ||
          element.value ||
          typeof text !== "string" ||
          !text ||
          text.length > 4096 ||
          /[\x00-\x1f\x7f]/.test(text) ||
          !guarded(guard) ||
          until <= now() ||
          ![document.body, element, lastField].includes(document.activeElement)
        ) {
          reject(new Error("native-typing-target"));
          return;
        }
        // `receipt` is the host's last `probe` index: -1 until the start is
        // granted, then the number of keys the host reports having sent.
        const row = {
          element,
          text,
          guard,
          stage,
          field,
          until,
          resolve,
          reject,
          position: 0,
          receipt: -1,
          armed: false,
          down: false,
          waiting: false,
          url: location.href,
          timer: null,
          expiry: null,
        };
        active = row;
        if (!attributes.has(element))
          attributes.set(element, element.getAttribute("value"));
        element.focus({ preventScroll: true });
        if (!current(row)) {
          finish(false);
          return;
        }
        row.expiry = setTimeout(
          () => finish(false),
          Math.max(0, until - now()),
        );
        send(row, "start");
      });
    },
    dispatch(command, index, _deadline, _submit, role) {
      const row = active;
      if (!row || role !== `type|${row.stage}|${row.field}`) return false;
      if (command === "wait") {
        // Only an ungranted start is repeated. The host holds a key request
        // itself, so a wait once typing has begun is a protocol violation.
        if (
          row.receipt !== -1 ||
          row.waiting ||
          !current(row) ||
          !Number.isInteger(index) ||
          index < 1 ||
          index > 1000
        ) {
          finish(false);
          return false;
        }
        row.waiting = true;
        row.timer = setTimeout(() => {
          row.waiting = false;
          if (!current(row)) {
            finish(false);
            return;
          }
          send(row, "start");
        }, index);
        return true;
      }
      // One receipt per request, in order: the start grant (0), then the
      // number of units sent. A surrogate pair is one key and counts two.
      if (
        command !== "probe" ||
        row.waiting ||
        !Number.isInteger(index) ||
        index <= row.receipt ||
        (row.armed
          ? index <= row.position || index > row.position + 2
          : index !== row.position)
      ) {
        finish(false);
        return false;
      }
      row.receipt = index;
      if (!row.armed) return advance(row);
      // The receipt overtook its DOM event. A key the engine never delivers
      // fails closed here and is never requested again.
      row.timer = setTimeout(() => finish(false), 1500);
      return true;
    },
  };
}
