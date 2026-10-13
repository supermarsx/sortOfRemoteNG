/**
 * The window's prompt queue: one themed, non-blocking confirmation at a time.
 *
 * `requestPrompt` replaces `window.confirm` for anything that runs on a
 * session. It returns a promise instead of stopping the window, so sessions
 * keep streaming while the user reads. `<PromptHost />`, mounted once per
 * window, draws the head of the queue with `AppPromptDialog`.
 *
 * The answer is a safety step, so every path here fails closed:
 * - only the affirmative button of the visible prompt resolves `confirmed`;
 * - abort, Escape, the backdrop, a closing window, a host that goes away and
 *   an error while drawing all resolve `{ confirmed: false, remember: false }`;
 * - a window without a host rejects with `PromptHostUnavailableError`, loudly,
 *   and never falls back to a native dialog.
 *
 * Because the call yields, a call site needs what the synchronous box gave it
 * for free: a guard against a second trigger while the prompt is open, an
 * abort signal tied to its owner, and a re-check of its state after the answer
 * and before anything is sent.
 *
 * Nothing here logs a request, and a request is dropped as soon as it is
 * answered: a preview may be a script with a password in it.
 */

export interface PromptTarget {
  id: string;
  name: string;
  detail?: string;
}

/** One answer of a group of choices. */
export interface PromptChoiceOption {
  /** What the decision reports as `choice`. Distinct within the group. */
  id: string;
  label: string;
  hint?: string;
}

export interface PromptRequest {
  /** The question, naming the action and where it runs. */
  title: string;
  /** One or two sentences. Also the dialog's accessible description. */
  message?: string;
  /** The affirmative button: a verb, not "OK". */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  tone?: "default" | "warning" | "danger";
  /** The button that has focus on open, and so the one Enter activates. Defaults to "confirm". */
  defaultAction?: "confirm" | "cancel";
  /** Exactly what will be sent. Pass the same variable that is sent afterwards. */
  preview?: { label: string; text: string };
  /** Where it will run. */
  targets?: { label: string; items: PromptTarget[] };
  /** Small chips: "bash", "12 lines", "3 steps". */
  facts?: string[];
  /** An optional checkbox; its state comes back as `remember` with a confirm. */
  remember?: { label: string; hint?: string };
  /**
   * One question with several answers, as a radio group. The first option is
   * the default and the only one ever selected when the prompt opens. Two to
   * six options with distinct ids; any other group is dropped when the
   * request is queued, and the prompt is shown without it.
   */
  choices?: {
    /** The group's legend. */
    label: string;
    options: readonly PromptChoiceOption[];
    /** One or two sentences under the group. */
    note?: string;
    noteTone?: "default" | "danger";
  };
  /** Where to change the policy that raised this prompt. */
  hint?: string;
  /**
   * A second request with this key while an identical one is pending joins it
   * instead of queueing another dialog. Include the session id: the key is the
   * caller's statement that both requests are the same action on the same
   * target. A request whose content differs is never joined, whatever its key.
   */
  dedupeKey?: string;
}

export interface PromptDecision {
  /** True only when the user activated the affirmative button of this prompt. */
  confirmed: boolean;
  /** True only with a confirm, and only when the request offered the checkbox and it was ticked. */
  remember: boolean;
  /**
   * The id of the selected answer of `choices`. Only with a confirm, only an
   * id the request offered, and never the key when there is nothing to
   * report: a request without `choices` gets exactly `{ confirmed, remember }`.
   * The dialog reports it only for a deliberate confirm (see `AppPromptDialog`),
   * so a missing `choice` means "the first answer".
   */
  choice?: string;
}

export interface PromptOptions {
  /** Aborting resolves the request as not confirmed and closes its prompt. */
  signal?: AbortSignal;
}

export class PromptHostUnavailableError extends Error {
  constructor() {
    super("This window has no prompt host, so nothing was confirmed.");
    this.name = "PromptHostUnavailableError";
  }
}

export interface PendingPrompt {
  id: number;
  request: PromptRequest;
}

type Settle = (decision: PromptDecision) => void;

interface Entry {
  prompt: PendingPrompt;
  /** One per caller: the first, and any that joined through `dedupeKey`. */
  waiters: Set<Settle>;
}

const NOT_CONFIRMED: PromptDecision = Object.freeze({
  confirmed: false,
  remember: false,
});

const EMPTY: readonly PendingPrompt[] = Object.freeze([]);

let nextId = 1;
let entries: Entry[] = [];
let snapshot: readonly PendingPrompt[] = EMPTY;
const hosts = new Set<symbol>();
const listeners = new Set<() => void>();

/** Rebuilds the snapshot and tells the host. Call after every change of `entries`. */
const publish = () => {
  snapshot =
    entries.length === 0
      ? EMPTY
      : Object.freeze(entries.map((entry) => entry.prompt));
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // A failing subscriber must not leave a prompt unanswered.
    }
  }
};

/** The most answers a group of choices may offer (`PROMPT_LIMITS.choices`). */
const MAX_CHOICES = 6;

type PromptChoices = NonNullable<PromptRequest["choices"]>;

const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === "string";

/**
 * A frozen copy of a well-formed group, or `undefined`. Only the known fields
 * are copied, so nothing a caller adds can preselect an answer; a group that
 * is not two to six options with distinct, non-empty ids is dropped whole.
 */
const copyChoices = (choices: unknown): PromptChoices | undefined => {
  if (typeof choices !== "object" || choices === null) return undefined;
  const { label, options, note, noteTone } = choices as PromptChoices;
  if (typeof label !== "string" || !isOptionalString(note)) return undefined;
  if (noteTone !== undefined && noteTone !== "default" && noteTone !== "danger")
    return undefined;
  if (
    !Array.isArray(options) ||
    options.length < 2 ||
    options.length > MAX_CHOICES
  )
    return undefined;
  const ids = new Set<string>();
  const copied: PromptChoiceOption[] = [];
  for (const option of options as unknown[]) {
    if (typeof option !== "object" || option === null) return undefined;
    const { id, label: optionLabel, hint } = option as PromptChoiceOption;
    if (typeof id !== "string" || id === "" || ids.has(id)) return undefined;
    if (typeof optionLabel !== "string" || !isOptionalString(hint))
      return undefined;
    ids.add(id);
    copied.push(
      Object.freeze(
        hint === undefined
          ? { id, label: optionLabel }
          : { id, label: optionLabel, hint },
      ),
    );
  }
  const copy: PromptChoices = { label, options: Object.freeze(copied) };
  if (note !== undefined) copy.note = note;
  if (noteTone !== undefined) copy.noteTone = noteTone;
  return Object.freeze(copy);
};

/** A private copy: what the caller does to its objects afterwards cannot change what is shown. */
const copyRequest = (request: PromptRequest): PromptRequest => {
  const copy: PromptRequest = {
    title: request.title,
    confirmLabel: request.confirmLabel,
  };
  if (request.message !== undefined) copy.message = request.message;
  if (request.cancelLabel !== undefined) copy.cancelLabel = request.cancelLabel;
  if (request.tone !== undefined) copy.tone = request.tone;
  if (request.defaultAction !== undefined)
    copy.defaultAction = request.defaultAction;
  if (request.hint !== undefined) copy.hint = request.hint;
  if (request.dedupeKey !== undefined) copy.dedupeKey = request.dedupeKey;
  if (request.preview)
    copy.preview = Object.freeze({
      label: request.preview.label,
      text: request.preview.text,
    });
  if (request.targets)
    copy.targets = Object.freeze({
      label: request.targets.label,
      items: Object.freeze(
        Array.from(request.targets.items, (item) =>
          Object.freeze(
            item.detail === undefined
              ? { id: item.id, name: item.name }
              : { id: item.id, name: item.name, detail: item.detail },
          ),
        ),
      ) as PromptTarget[],
    });
  if (request.facts)
    copy.facts = Object.freeze(Array.from(request.facts)) as string[];
  if (request.remember)
    copy.remember = Object.freeze(
      request.remember.hint === undefined
        ? { label: request.remember.label }
        : { label: request.remember.label, hint: request.remember.hint },
    );
  if (request.choices !== undefined) {
    const choices = copyChoices(request.choices);
    if (choices) copy.choices = choices;
  }
  return Object.freeze(copy);
};

const sameList = <T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  same: (x: T, y: T) => boolean,
) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((item, index) => same(item, b[index])));

/** Field by field: a joined caller receives an answer the user gave to this exact content. */
const sameRequest = (a: PromptRequest, b: PromptRequest) =>
  a.title === b.title &&
  a.message === b.message &&
  a.confirmLabel === b.confirmLabel &&
  a.cancelLabel === b.cancelLabel &&
  a.tone === b.tone &&
  a.defaultAction === b.defaultAction &&
  a.hint === b.hint &&
  a.preview?.label === b.preview?.label &&
  a.preview?.text === b.preview?.text &&
  a.targets?.label === b.targets?.label &&
  sameList(
    a.targets?.items,
    b.targets?.items,
    (x, y) => x.id === y.id && x.name === y.name && x.detail === y.detail,
  ) &&
  sameList(a.facts, b.facts, (x, y) => x === y) &&
  a.remember?.label === b.remember?.label &&
  a.remember?.hint === b.remember?.hint &&
  (a.choices === undefined) === (b.choices === undefined) &&
  a.choices?.label === b.choices?.label &&
  a.choices?.note === b.choices?.note &&
  a.choices?.noteTone === b.choices?.noteTone &&
  sameList(
    a.choices?.options,
    b.choices?.options,
    (x, y) => x.id === y.id && x.label === y.label && x.hint === y.hint,
  );

const settleEntry = (entry: Entry, decision: PromptDecision) => {
  const waiters = Array.from(entry.waiters);
  entry.waiters.clear();
  for (const settle of waiters) settle(decision);
};

const cancelEntries = () => {
  if (entries.length === 0) return;
  const cancelled = entries;
  entries = [];
  for (const entry of cancelled) settleEntry(entry, NOT_CONFIRMED);
  publish();
};

/**
 * Asks the user and resolves with the answer. Never blocks, never throws
 * synchronously, and never rejects for a cancel: only a window without a
 * `<PromptHost />` rejects, with `PromptHostUnavailableError`.
 *
 *     const decision = await requestPrompt(sshScriptRunPrompt({ ... }), { signal });
 *     if (!decision.confirmed) return;
 */
export function requestPrompt(
  request: PromptRequest,
  options?: PromptOptions,
): Promise<PromptDecision> {
  const signal = options?.signal;
  if (signal?.aborted) return Promise.resolve(NOT_CONFIRMED);
  if (hosts.size === 0) return Promise.reject(new PromptHostUnavailableError());

  let shown: PromptRequest;
  try {
    shown = copyRequest(request);
  } catch {
    // A request that cannot be read cannot be shown, so it cannot be confirmed.
    return Promise.resolve(NOT_CONFIRMED);
  }

  return new Promise<PromptDecision>((resolve) => {
    let entry =
      shown.dedupeKey === undefined
        ? undefined
        : entries.find(
            (candidate) =>
              candidate.prompt.request.dedupeKey === shown.dedupeKey &&
              sameRequest(candidate.prompt.request, shown),
          );
    const joined = entry !== undefined;
    if (!entry) {
      entry = { prompt: { id: nextId++, request: shown }, waiters: new Set() };
      entries = [...entries, entry];
    }
    const target = entry;

    const onAbort = () => {
      if (!target.waiters.delete(settle)) return;
      resolve(NOT_CONFIRMED);
      // The prompt stays for the callers that are still waiting on it.
      if (target.waiters.size > 0 || !entries.includes(target)) return;
      entries = entries.filter((candidate) => candidate !== target);
      publish();
    };
    const settle: Settle = (decision) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    target.waiters.add(settle);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (!joined) publish();
  });
}

/**
 * The host's answer for the visible prompt. A settle for any other id (a
 * prompt that was already answered, aborted, or is still waiting) does nothing.
 */
export function settlePrompt(id: number, decision: PromptDecision): void {
  const head = entries[0];
  if (!head || head.prompt.id !== id) return;
  const confirmed = decision?.confirmed === true;
  const answer: PromptDecision = confirmed
    ? {
        confirmed: true,
        remember:
          head.prompt.request.remember !== undefined &&
          decision.remember === true,
      }
    : NOT_CONFIRMED;
  // A choice only with a confirm, and only one of the answers offered.
  const choice = confirmed ? decision.choice : undefined;
  if (
    typeof choice === "string" &&
    head.prompt.request.choices?.options.some((option) => option.id === choice)
  )
    answer.choice = choice;
  entries = entries.slice(1);
  settleEntry(head, answer);
  publish();
}

/** Resolves every pending prompt as not confirmed, for a window that is going away. */
export function cancelAllPrompts(): void {
  cancelEntries();
}

export function subscribePrompts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pending prompts, visible one first. The same array until the queue changes. */
export function getPromptSnapshot(): readonly PendingPrompt[] {
  return snapshot;
}

/**
 * Called by `<PromptHost />` on mount; the returned function unregisters it.
 * When the last host goes, every pending prompt resolves as not confirmed.
 */
export function registerPromptHost(): () => void {
  const host = Symbol("prompt-host");
  hosts.add(host);
  return () => {
    if (!hosts.delete(host)) return;
    if (hosts.size === 0) cancelEntries();
  };
}

export function resetPromptQueueForTests(): void {
  hosts.clear();
  cancelEntries();
  nextId = 1;
}

// ─── "Don't ask again" ──────────────────────────────────────────

export interface PromptMemoryScope {
  /** What kind of thing was confirmed, for example "ssh-script" or "ssh-macro". */
  kind: string;
  /** The script's or macro's id. */
  id: string;
  /** The backend session the answer was given for. A reconnect is a new session. */
  sessionId: string;
  /** The exact text that was reviewed: the command sent, or the macro's steps as JSON. */
  content: string;
}

export interface PromptMemory {
  /** True only for the same kind, id and session, and only while the content is identical. */
  has(scope: PromptMemoryScope): boolean;
  /** Call after a confirm whose `remember` is true, with the scope that was shown. */
  remember(scope: PromptMemoryScope): void;
  /** Call when a session ends, disconnects or is replaced. */
  forgetSession(sessionId: string): void;
  clear(): void;
}

/**
 * The memory behind a prompt's "Don't ask again" checkbox. It lives in the
 * object that owns it (one per terminal), is never written anywhere, and ends
 * with it. An answer is remembered for one script or macro on one session and
 * is dropped the first time its content differs, even if it later changes
 * back. It only skips the question: re-check the session and the library
 * before sending, exactly as after a confirm.
 */
export function createPromptMemory(): PromptMemory {
  const remembered = new Map<string, { sessionId: string; content: string }>();
  const keyOf = (scope: PromptMemoryScope) =>
    scope.kind && scope.id && scope.sessionId
      ? JSON.stringify([scope.kind, scope.sessionId, scope.id])
      : undefined;
  return {
    has(scope) {
      const key = keyOf(scope);
      if (key === undefined) return false;
      const entry = remembered.get(key);
      if (!entry) return false;
      if (entry.content === scope.content) return true;
      remembered.delete(key);
      return false;
    },
    remember(scope) {
      const key = keyOf(scope);
      if (key === undefined || typeof scope.content !== "string") return;
      remembered.set(key, {
        sessionId: scope.sessionId,
        content: scope.content,
      });
    },
    forgetSession(sessionId) {
      for (const [key, entry] of remembered)
        if (entry.sessionId === sessionId) remembered.delete(key);
    },
    clear() {
      remembered.clear();
    },
  };
}
