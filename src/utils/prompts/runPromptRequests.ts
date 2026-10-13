/**
 * Builders that turn what a call site knows into a `PromptRequest`, and the
 * bounds on what the dialog shows of untrusted text.
 *
 * All wording of the run prompts lives in this file, so call sites share no
 * text and a later translation touches one place.
 *
 * Script text, pasted text, and session, host, script and file names are
 * untrusted. A builder puts a payload into `preview.text` unchanged, because
 * that is what will be sent; it puts a name into a title only on one line,
 * without control or direction characters, and bounded.
 */
import type { PromptRequest, PromptTarget } from "./promptQueue";

// ─── Bounds ─────────────────────────────────────────────────────

export const PROMPT_LIMITS = {
  /** A preview is shown in full up to this many characters. */
  previewCharacters: 20_000,
  previewLines: 1_000,
  /** Rows listed under "Runs on". */
  targets: 500,
  title: 300,
  message: 600,
  /** A target's name or detail, and a region's label. */
  name: 120,
  /** A name quoted inside a title. */
  nameInTitle: 80,
  /** A button label or a fact chip. */
  label: 60,
  facts: 8,
  /** A remote path is shown whole up to this length, then without its middle. */
  path: 600,
} as const;

const ELLIPSIS = "…";

// Characters that draw nothing or reorder what is around them, as one class
// body for both patterns below: the format category (direction marks,
// embeddings, overrides and isolates, zero-width characters, the soft hyphen,
// the byte order mark, tags, annotation anchors), the line and paragraph
// separators, the variation selectors, the tag block and the fillers that
// draw as a blank. The ranges restate parts of the category so that an engine
// with older Unicode data marks the same characters. The selectors come
// straight after the category: written after another character, a selector
// would read as part of that character.
const INVISIBLE = String.raw`\p{Cf}\u{FE00}-\u{FE0F}\u{AD}\u{61C}\u{115F}\u{1160}\u{180E}\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{206F}\u{3164}\u{FEFF}\u{FFA0}\u{FFF9}-\u{FFFB}\u{E0000}-\u{E0FFF}`;
const INVISIBLE_PATTERN = new RegExp(`[${INVISIBLE}]`, "gu");
// eslint-disable-next-line no-control-regex -- untrusted names: control characters are matched on purpose.
const CONTROL_PATTERN = /[\u{0}-\u{1F}\u{7F}-\u{9F}]/gu;
// Everything a <pre> would hide: both of the above, except tab and line feed.
const HIDDEN_PATTERN = new RegExp(
  String.raw`\r\n|[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}${INVISIBLE}]`,
  "gu",
);

// The symbols an emoji presentation selector may follow (the bases of the
// standard emoji variation sequences, without the ASCII keycaps). After one of
// them U+FE0E and U+FE0F choose how it is drawn and hide nothing; anywhere
// else they can only hide, and are treated like every other selector.
const PICTOGRAPHS: ReadonlyArray<readonly [number, number]> = [
  [0xa9, 0xa9],
  [0xae, 0xae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2190, 0x21ff],
  [0x2300, 0x23ff],
  [0x24c2, 0x24c2],
  [0x25a0, 0x27bf],
  [0x2900, 0x297f],
  [0x2b00, 0x2bff],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3299],
  [0x1f000, 0x1faff],
];

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

const codePointBefore = (text: string, index: number) => {
  if (index <= 0) return -1;
  const unit = text.charCodeAt(index - 1);
  const whole =
    index >= 2 && unit >= 0xdc00 && unit <= 0xdfff
      ? (text.codePointAt(index - 2) ?? unit)
      : unit;
  return whole > 0xffff ? whole : unit;
};

/** True for U+FE0E or U+FE0F at `index` when it styles the pictograph before it. */
const isEmojiSelector = (code: number, text: string, index: number) => {
  if (code !== 0xfe0e && code !== 0xfe0f) return false;
  const base = codePointBefore(text, index);
  return PICTOGRAPHS.some(([from, to]) => base >= from && base <= to);
};

const codePointLabel = (code: number) =>
  `⟨U+${code.toString(16).toUpperCase().padStart(4, "0")}⟩`;

const occurrences = (text: string, needle: string) => {
  let count = 0;
  for (
    let index = text.indexOf(needle);
    index !== -1;
    index = text.indexOf(needle, index + needle.length)
  )
    count += 1;
  return count;
};

/** Lines as a terminal sees them: `\n`, `\r\n` and a lone `\r` each end one. */
export function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  const breaks =
    occurrences(text, "\n") +
    occurrences(text, "\r") -
    occurrences(text, "\r\n");
  const last = text.charCodeAt(text.length - 1);
  return breaks + (last === 10 || last === 13 ? 0 : 1);
}

export interface PreviewExcerpt {
  /** The start of the text, unchanged. */
  text: string;
  omittedLines: number;
  omittedCharacters: number;
}

/**
 * The part of a preview the dialog renders. Finding the cut reads at most
 * `previewCharacters`, and counting what is left out is one native scan, so a
 * payload of many megabytes stays cheap and only the excerpt reaches the DOM.
 */
export function excerptPreview(text: string): PreviewExcerpt {
  let end = Math.min(text.length, PROMPT_LIMITS.previewCharacters);
  if (end < text.length) {
    const last = text.charCodeAt(end - 1);
    // Keep a character and a Windows line end whole.
    if (isHighSurrogate(last) || (last === 13 && text.charCodeAt(end) === 10))
      end -= 1;
  }

  let breaks = 0;
  for (let index = 0; index < end; index += 1) {
    const code = text.charCodeAt(index);
    if (code !== 10 && code !== 13) continue;
    const next =
      index + (code === 13 && text.charCodeAt(index + 1) === 10 ? 2 : 1);
    breaks += 1;
    // The line limit applies only when another line follows this break.
    if (breaks === PROMPT_LIMITS.previewLines && next < text.length) {
      end = index;
      break;
    }
    index = next - 1;
  }

  if (end === text.length)
    return { text, omittedLines: 0, omittedCharacters: 0 };
  const shown = text.slice(0, end);
  return {
    text: shown,
    omittedLines: Math.max(0, countTextLines(text) - countTextLines(shown)),
    omittedCharacters: text.length - end,
  };
}

/**
 * Makes the characters of a payload that a `<pre>` would hide visible, so the
 * preview cannot look harmless and run something else. A Windows line end
 * stays one line break; a lone carriage return, which a terminal takes as
 * Enter, is shown and breaks the line; control characters appear as their
 * control pictures and invisible ones as their code point. Ordinary text,
 * tabs and line breaks are returned unchanged.
 *
 * `markFinalLineFeed` is for a text that is shown to its end: a line feed
 * there draws nothing, yet for a paste it decides whether the last line runs,
 * so it is shown as its own symbol.
 */
export function revealHiddenCharacters(
  text: string,
  options?: { markFinalLineFeed?: boolean },
): string {
  const shown = text.replace(HIDDEN_PATTERN, (match, index: number) => {
    if (match === "\r\n") return "\n";
    if (match === "\r") return "␍\n";
    const code = match.codePointAt(0) ?? 0;
    if (code < 0x20) return String.fromCharCode(0x2400 + code);
    if (code === 0x7f) return "␡";
    return isEmojiSelector(code, text, index) ? match : codePointLabel(code);
  });
  return options?.markFinalLineFeed && text.endsWith("\n")
    ? `${shown.slice(0, -1)}␊`
    : shown;
}

/** A name or label on one line: no control or direction characters, bounded with an ellipsis. */
export function toSingleLine(text: string, limit: number): string {
  const line = String(text ?? "")
    .replace(INVISIBLE_PATTERN, (match, index: number, whole: string) =>
      isEmojiSelector(match.codePointAt(0) ?? 0, whole, index) ? match : "",
    )
    .replace(CONTROL_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= limit) return line;
  const end = isHighSurrogate(line.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return `${line.slice(0, end).trimEnd()}${ELLIPSIS}`;
}

// The least of a path's start that is kept when its end takes the whole limit.
const PATH_HEAD_MINIMUM = 16;

/**
 * A path that fits the limit, with the middle left out when it is longer. The
 * start is kept, and so is the end: the final segment whole, whatever its
 * length, with the folders before it while they fit in half the limit. Both
 * `/` and `\` separate segments.
 */
export function shortenPath(
  path: string,
  limit: number = PROMPT_LIMITS.path,
): { text: string; omitted: number } {
  const whole = { text: path, omitted: 0 };
  if (path.length <= limit) return whole;
  const separatorBefore = (from: number) => {
    for (let index = from; index >= 0; index -= 1) {
      const code = path.charCodeAt(index);
      if (code === 47 || code === 92) return index;
    }
    return -1;
  };

  // A folder's trailing separator belongs to its segment.
  let tailStart = separatorBefore(path.length - 2);
  if (tailStart <= 0) return whole;
  for (
    let next = separatorBefore(tailStart - 1);
    next > 0 && path.length - next <= limit / 2;
    next = separatorBefore(next - 1)
  )
    tailStart = next;

  let headEnd = Math.max(
    PATH_HEAD_MINIMUM,
    limit - (path.length - tailStart) - ELLIPSIS.length,
  );
  if (headEnd >= tailStart) return whole;
  if (isHighSurrogate(path.charCodeAt(headEnd - 1))) headEnd -= 1;
  // End the start on a folder boundary when it has one.
  const boundary = separatorBefore(headEnd - 1);
  if (boundary > 0) headEnd = boundary + 1;
  return {
    text: `${path.slice(0, headEnd)}${ELLIPSIS}${path.slice(tailStart)}`,
    omitted: tailStart - headEnd,
  };
}

// ─── Wording shared with the dialog ─────────────────────────────

export const PROMPT_CANCEL_LABEL = "Cancel";

export const PROMPT_HIDDEN_CHARACTERS_NOTICE =
  "Hidden control characters are shown as symbols.";

const count = (value: number) => value.toLocaleString();

const plural = (value: number, one: string, many: string) =>
  `${count(value)} ${value === 1 ? one : many}`;

/** The badge of the visible prompt when others wait: "1 of 3". */
export const promptQueueLabel = (position: number, total: number) =>
  `${count(position)} of ${count(total)}`;

/** The same position as a screen reader hears it: "Prompt 1 of 3". */
export const promptQueueAnnouncement = (position: number, total: number) =>
  `Prompt ${promptQueueLabel(position, total)}`;

export const previewOmittedNotice = (omitted: {
  lines: number;
  characters: number;
}) =>
  omitted.lines > 0
    ? `and ${plural(omitted.lines, "more line", "more lines")} (${plural(omitted.characters, "character", "characters")}) ${omitted.lines === 1 ? "is" : "are"} not shown`
    : `${plural(omitted.characters, "more character", "more characters")} ${omitted.characters === 1 ? "is" : "are"} not shown`;

export const targetsOmittedNotice = (omitted: number) =>
  `and ${count(omitted)} more`;

// ─── Builders ───────────────────────────────────────────────────

/**
 * The session a prompt is about. A title uses `name`, or `hostname` when there
 * is no name; given both, the request also shows the host in a row under the
 * message, so that two sessions of one name cannot be mistaken.
 */
export interface PromptSessionRef {
  name?: string | null;
  hostname?: string | null;
}

const quoted = (name: string) =>
  `"${toSingleLine(name, PROMPT_LIMITS.nameInTitle)}"`;

const sessionLabel = (session: PromptSessionRef) =>
  toSingleLine(
    session.name || session.hostname || "",
    PROMPT_LIMITS.nameInTitle,
  ) || "this session";

/**
 * The row that tells two sessions of one name apart: the name, then the host,
 * as the bulk prompt lists each of its targets. A title names a session by its
 * name, or by its host when it has no name, so the row is added only when both
 * are known and differ. `always` is for a prompt whose title does not name the
 * session at all: it then shows whichever of the two is known. Hidden
 * characters in a host are marked, so two hosts cannot look the same.
 */
const sessionTargets = (
  session: PromptSessionRef | undefined,
  always = false,
): Pick<PromptRequest, "targets"> => {
  const name = session?.name || "";
  const host = session?.hostname || "";
  const both =
    name !== "" &&
    host !== "" &&
    toSingleLine(name, Infinity) !== toSingleLine(host, Infinity);
  if (!both && !(always && (name || host))) return {};
  const item: PromptTarget = both
    ? { id: "session", name, detail: revealHiddenCharacters(host) }
    : { id: "session", name: name || revealHiddenCharacters(host) };
  return { targets: { label: "Session", items: [item] } };
};

const REMEMBER_HINT = (what: string) =>
  `You are asked again if the ${what} changes or the session ends.`;

/**
 * Run a saved script in an SSH terminal. `command` is the text that will be
 * sent (the shebang line already removed) and is previewed unchanged.
 * `offerRemember` adds the "Don't ask again" checkbox: pass it only where the
 * answer's `remember` is acted on (see `createPromptMemory`).
 */
export function sshScriptRunPrompt(input: {
  script: { name: string; language?: string | null };
  command: string;
  session: PromptSessionRef;
  offerRemember?: boolean;
}): PromptRequest {
  const { script, command, session } = input;
  const facts = [plural(countTextLines(command), "line", "lines")];
  if (script.language) facts.unshift(script.language);
  return {
    title: `Run ${quoted(script.name)} on ${sessionLabel(session)}?`,
    message: "This runs the commands below in this SSH session.",
    confirmLabel: "Run script",
    ...sessionTargets(session),
    preview: { label: "Commands to run", text: command },
    facts,
    hint: "Settings, Macros: Confirm before running SSH scripts",
    ...(input.offerRemember
      ? {
          remember: {
            label: "Don't ask again for this script in this session",
            hint: REMEMBER_HINT("script"),
          },
        }
      : {}),
  };
}

/**
 * Replay a terminal macro. The preview lists one numbered line per step, with
 * the pause that follows it and whether Enter is sent. `offerRemember` as for
 * `sshScriptRunPrompt`.
 */
export function sshMacroReplayPrompt(input: {
  macro: {
    name: string;
    steps: readonly {
      command: string;
      delayMs: number;
      sendNewline: boolean;
    }[];
  };
  session: PromptSessionRef;
  offerRemember?: boolean;
}): PromptRequest {
  const { macro, session } = input;
  const steps = macro.steps.map((step, index) => {
    const number = `${index + 1}. `;
    const notes =
      (step.sendNewline ? "" : "  [no Enter]") +
      // The replay does not pause after the last step.
      (step.delayMs > 0 && index < macro.steps.length - 1
        ? `  [then wait ${count(step.delayMs)} ms]`
        : "");
    const indent = " ".repeat(number.length);
    return `${number}${step.command.split(/\r\n|\r|\n/).join(`\n${indent}`)}${notes}`;
  });
  return {
    title: `Replay ${quoted(macro.name)} on ${sessionLabel(session)}?`,
    message: `This types ${plural(macro.steps.length, "step", "steps")} into this SSH session.`,
    confirmLabel: "Replay macro",
    ...sessionTargets(session),
    preview: { label: "Steps", text: steps.join("\n") },
    facts: [plural(macro.steps.length, "step", "steps")],
    hint: "Settings, Macros: Confirm before replay",
    ...(input.offerRemember
      ? {
          remember: {
            label: "Don't ask again for this macro in this session",
            hint: REMEMBER_HINT("macro"),
          },
        }
      : {}),
  };
}

/**
 * Paste text into a terminal. `multiLine` says the multi-line warning applies;
 * `lengthLimit` is the configured limit when the text is over it. The text is
 * previewed unchanged.
 */
export function terminalPastePrompt(input: {
  text: string;
  session: PromptSessionRef;
  multiLine: boolean;
  lengthLimit?: number;
}): PromptRequest {
  const { text, session } = input;
  const reasons: string[] = [];
  if (input.multiLine) reasons.push("multiple lines");
  if (input.lengthLimit !== undefined && input.lengthLimit > 0)
    reasons.push(
      `${plural(text.length, "character", "characters")}, over the limit of ${count(input.lengthLimit)}`,
    );
  const risk = "It may run commands as soon as it is pasted.";
  return {
    title: `Paste into ${sessionLabel(session)}?`,
    message:
      reasons.length > 0
        ? `The text contains ${reasons.join(" and ")}. ${risk}`
        : risk,
    confirmLabel: "Paste",
    tone: "warning",
    ...sessionTargets(session),
    preview: { label: "Text to paste", text },
    facts: [
      plural(countTextLines(text), "line", "lines"),
      plural(text.length, "character", "characters"),
    ],
    hint: "Settings, Behavior: Warn before pasting multi-line text",
  };
}

const BULK_RUN_POLICY_LABEL = {
  always: "Always",
  "destructive-only": "Destructive",
  never: "Never",
} as const;

/**
 * Send one command to several SSH sessions. Every session is listed by name
 * and host. A destructive command is marked as such and opens with the focus
 * on Cancel. `scriptName` names the saved script while the editor still holds
 * it; `policy` is the script library's "Confirm run" setting.
 */
export function bulkCommandRunPrompt(input: {
  command: string;
  sessions: readonly {
    id: string;
    name?: string | null;
    hostname?: string | null;
  }[];
  destructive: boolean;
  scriptName?: string | null;
  policy?: keyof typeof BULK_RUN_POLICY_LABEL;
}): PromptRequest {
  const { command, sessions, destructive } = input;
  const total = sessions.length;
  const items = sessions.map((session): PromptTarget => {
    const name = session.name || session.hostname || session.id;
    return session.hostname && session.hostname !== name
      ? {
          id: session.id,
          name,
          detail: revealHiddenCharacters(session.hostname),
        }
      : { id: session.id, name };
  });
  return {
    title: `Send ${destructive ? "a destructive" : "this"} command to ${plural(total, "SSH session", "SSH sessions")}?`,
    ...(destructive
      ? {
          message: `This command may make destructive changes on ${total === 1 ? "the selected session" : "every selected session"}.`,
          tone: "danger" as const,
          defaultAction: "cancel" as const,
        }
      : {}),
    confirmLabel: `Send to ${plural(total, "session", "sessions")}`,
    preview: { label: "Command", text: command },
    targets: { label: "Runs on", items },
    ...(input.scriptName
      ? { facts: [`Script ${quoted(input.scriptName)}`] }
      : {}),
    ...(input.policy
      ? {
          hint: `Script library, Confirm run: ${BULK_RUN_POLICY_LABEL[input.policy]}`,
        }
      : {}),
  };
}

/** Move a Bulk SSH script to the trash, or delete it for good. */
export function bulkScriptDeletePrompt(input: {
  name: string;
  permanent: boolean;
}): PromptRequest {
  return input.permanent
    ? {
        title: `Permanently delete ${quoted(input.name)}?`,
        message: "This cannot be undone.",
        confirmLabel: "Delete permanently",
        tone: "danger",
        defaultAction: "cancel",
      }
    : {
        title: `Move ${quoted(input.name)} to trash?`,
        message: "You can restore it from the trash.",
        confirmLabel: "Move to trash",
      };
}

/** Empty the Bulk SSH script trash. */
export function bulkScriptTrashEmptyPrompt(input: {
  count: number;
}): PromptRequest {
  return {
    title: `Permanently delete ${plural(input.count, "trashed script", "trashed scripts")}?`,
    message: "This cannot be undone.",
    confirmLabel: "Empty trash",
    tone: "danger",
    defaultAction: "cancel",
  };
}

/**
 * Copy dropped files to a remote session. `size` is already formatted, for
 * example "4.2 MB". `folders` is how many folders the drop contains: the title
 * then reads "3 files in 2 folders", and a drop of folders with no files in
 * them asks about the empty folders instead of "0 files" and a size.
 */
export function fileTransferPrompt(input: {
  count: number;
  size: string;
  session: PromptSessionRef;
  folders?: number;
}): PromptRequest {
  const folders =
    input.folders !== undefined && input.folders > 0 ? input.folders : 0;
  if (folders > 0 && input.count === 0)
    return {
      title: `Send ${plural(folders, "empty folder", "empty folders")} to ${sessionLabel(input.session)}?`,
      message: `Only the ${folders === 1 ? "folder is" : "folders are"} created in the remote session; no files are copied.`,
      confirmLabel: folders === 1 ? "Send folder" : "Send folders",
      ...sessionTargets(input.session),
    };
  return {
    title: `Send ${plural(input.count, "file", "files")}${folders > 0 ? ` in ${plural(folders, "folder", "folders")}` : ""} to ${sessionLabel(input.session)}?`,
    message: `${toSingleLine(input.size, PROMPT_LIMITS.label)} will be copied to the remote session.`,
    confirmLabel: input.count === 1 ? "Send file" : "Send files",
    ...sessionTargets(input.session),
  };
}

/**
 * Delete a remote file or folder for good. `path` is the entry's absolute
 * remote path. It is previewed under the name as untrusted text: the dialog
 * marks its hidden characters, and a path over `PROMPT_LIMITS.path` loses its
 * middle, never its final segment (see `shortenPath`). `session` says where:
 * the title does not name the session, so its name and host get their own row.
 */
export function remoteDeletePrompt(input: {
  name: string;
  isFolder?: boolean;
  path?: string;
  session?: PromptSessionRef;
}): PromptRequest {
  const path = input.path ? shortenPath(input.path) : undefined;
  return {
    title: `Permanently delete ${quoted(input.name)}?`,
    message: input.isFolder
      ? "This cannot be undone. Everything inside it is deleted too."
      : "This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
    defaultAction: "cancel",
    ...sessionTargets(input.session, true),
    ...(path
      ? {
          preview: {
            label:
              path.omitted > 0
                ? `Path (${plural(path.omitted, "character", "characters")} in the middle ${path.omitted === 1 ? "is" : "are"} not shown)`
                : "Path",
            text: path.text,
          },
        }
      : {}),
  };
}
