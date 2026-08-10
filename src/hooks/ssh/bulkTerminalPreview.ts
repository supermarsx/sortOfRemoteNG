export const MAX_BULK_TERMINAL_PREVIEW_BYTES = 64 * 1024;

const OMITTED_PREFIX = "[Earlier terminal output omitted]\n";

/* eslint-disable no-control-regex -- terminal sanitization intentionally matches ANSI C0/C1 bytes. */
const stripTerminalControls = (value: string): string =>
  value
    // OSC strings (title, clipboard, hyperlinks), terminated by BEL/ST or EOF.
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\|$)/g, "")
    .replace(/\u009d[\s\S]*?(?:\u0007|\u009c|$)/g, "")
    // DCS/SOS/PM/APC strings, terminated by ST or EOF.
    .replace(/\u001b[PX^_][\s\S]*?(?:\u001b\\|$)/g, "")
    .replace(/[\u0090\u0098\u009e\u009f][\s\S]*?(?:\u009c|$)/g, "")
    // CSI sequences in seven-bit and C1 forms.
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    // Character-set selection and remaining two-byte escape sequences.
    .replace(/\u001b[()][0-2A-Z]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .replace(/\r\n?/g, "\n")
    // Preserve horizontal tab and newline; remove every other C0/C1 control.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
/* eslint-enable no-control-regex */

const utf8Tail = (value: string, maxBytes: number): string => {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  if (encoded.length <= maxBytes) return value;

  const prefixBytes = encoder.encode(OMITTED_PREFIX);
  const tailBudget = Math.max(0, maxBytes - prefixBytes.length);
  const tailBytes = encoded.slice(encoded.length - tailBudget);
  // A byte-tail may begin inside a multibyte scalar. TextDecoder replaces only
  // that incomplete leading scalar; dropping the marker keeps the snapshot
  // valid UTF-8 and inside the exact byte budget.
  let tail = new TextDecoder().decode(tailBytes).replace(/^\uFFFD/, "");
  while (encoder.encode(tail).length > tailBudget && tail.length > 0) {
    const firstCodePoint = tail.codePointAt(0);
    tail = tail.slice(
      firstCodePoint !== undefined && firstCodePoint > 0xffff ? 2 : 1,
    );
  }
  return `${OMITTED_PREFIX}${tail}`;
};

export const formatBulkTerminalPreview = (value: string): string =>
  utf8Tail(stripTerminalControls(value), MAX_BULK_TERMINAL_PREVIEW_BYTES);
