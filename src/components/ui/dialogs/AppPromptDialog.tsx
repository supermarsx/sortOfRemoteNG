import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Play, ShieldAlert } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../overlays/Modal";
import { DialogHeader } from "../overlays/DialogHeader";
import { Checkbox } from "../forms/Checkbox";
import { cx } from "../lib/cx";
import type {
  PromptDecision,
  PromptRequest,
} from "../../../utils/prompts/promptQueue";
import {
  PROMPT_CANCEL_LABEL,
  PROMPT_HIDDEN_CHARACTERS_NOTICE,
  PROMPT_LIMITS,
  excerptPreview,
  previewOmittedNotice,
  promptQueueAnnouncement,
  promptQueueLabel,
  revealHiddenCharacters,
  targetsOmittedNotice,
  toSingleLine,
} from "../../../utils/prompts/runPromptRequests";
import styles from "./AppPromptDialog.module.css";

export interface AppPromptDialogProps {
  request: PromptRequest;
  /** Prompts waiting behind this one; above zero shows the "1 of N" badge. */
  queued?: number;
  /**
   * Called once, with the user's answer. The owner removes the dialog (or
   * replaces it under a new key) in response; it does not answer twice.
   */
  onDecision: (decision: PromptDecision) => void;
}

// A key typed before the prompt could be read must not answer it: paste then
// Enter is a habit, and Enter held on the control that opened the prompt
// repeats. Shorter than a deliberate reaction to a new dialog.
const KEYBOARD_ARM_DELAY_MS = 300;

const TONES = {
  default: {
    icon: Play,
    iconColor: "text-primary",
    action: "sor-modal-primary",
  },
  warning: {
    icon: ShieldAlert,
    iconColor: "text-warning",
    action:
      "px-4 py-2 rounded-md text-[var(--color-text)] transition-colors bg-warning hover:bg-warning/90",
  },
  danger: {
    icon: AlertTriangle,
    iconColor: "text-error",
    action:
      "px-4 py-2 rounded-md text-[var(--color-text)] transition-colors bg-error hover:bg-error/90",
  },
} as const;

const SECTION_LABEL =
  "mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-textMuted)]";

// The keys with which a radio group selects: the arrows move the selection,
// Space selects the focused answer. Enter selects nothing.
const CHOICE_SELECTION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  " ",
]);

/**
 * The app's themed prompt: what will run, where, and two buttons. Purely
 * presentational; `<PromptHost />` shows one for the head of the prompt queue
 * and owns Escape, so call sites use `requestPrompt` rather than this.
 *
 * Everything in the request is untrusted text and is rendered as text. Names
 * are kept on one line and bounded; the preview is capped, with the rest
 * counted, and its hidden characters are made visible.
 *
 * A group of choices may grant something lasting, so only a deliberate act
 * changes or reports it: the first answer is selected on open; a selection
 * changes only on a trusted event, from the keyboard only once the prompt can
 * be read and never on key repeat or the second click of a double click; and
 * a confirm reports the choice only when its own click is trusted and the
 * prompt can be read. A click a script dispatches still confirms, with no
 * choice; every other way out answers not confirmed.
 */
export const AppPromptDialog: React.FC<AppPromptDialogProps> = ({
  request,
  queued = 0,
  onDecision,
}) => {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const decided = useRef(false);
  const shownAt = useRef<number | null>(null);
  const pressBeganInside = useRef(false);
  const [remember, setRemember] = useState(false);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  const tone = TONES[request.tone ?? "default"] ?? TONES.default;
  const rememberOffered = request.remember !== undefined;
  const choices = request.choices;
  const choiceOptions = choices?.options ?? [];
  const firstChoice = choiceOptions[0]?.id;
  const [choice, setChoice] = useState(firstChoice);
  const selectedChoice = choiceOptions.some((option) => option.id === choice)
    ? choice
    : firstChoice;

  // `deliberate`: the confirm was a trusted click once the prompt could be
  // read. Only then does it carry the choice.
  const decide = useCallback(
    (confirmed: boolean, deliberate = false) => {
      if (decided.current) return;
      decided.current = true;
      const decision: PromptDecision = {
        confirmed,
        remember: confirmed && rememberOffered && remember,
      };
      if (confirmed && deliberate && selectedChoice !== undefined)
        decision.choice = selectedChoice;
      onDecision(decision);
    },
    [onDecision, remember, rememberOffered, selectedChoice],
  );

  useEffect(() => {
    shownAt.current = performance.now();
  }, []);

  // The backdrop belongs to Modal. Its own close-on-click cannot tell these
  // two apart from a real dismissal, so the dialog listens itself: the second
  // click of the double click that opened the prompt, and a text selection
  // that began in the preview and ended outside the panel.
  useEffect(() => {
    const backdrop = actionRef.current?.closest<HTMLElement>(
      ".sor-modal-backdrop",
    );
    if (!backdrop) return;
    const onMouseDown = (event: MouseEvent) => {
      pressBeganInside.current = event.target !== backdrop;
    };
    const onClick = (event: MouseEvent) => {
      const beganInside = pressBeganInside.current;
      pressBeganInside.current = false;
      if (event.target !== backdrop || beganInside || event.detail > 1) return;
      decide(false);
    };
    backdrop.addEventListener("mousedown", onMouseDown);
    backdrop.addEventListener("click", onClick);
    return () => {
      backdrop.removeEventListener("mousedown", onMouseDown);
      backdrop.removeEventListener("click", onClick);
    };
  }, [decide]);

  const isArmed = () => {
    const shown = shownAt.current;
    return shown !== null && performance.now() - shown >= KEYBOARD_ARM_DELAY_MS;
  };

  const activate =
    (confirmed: boolean) => (event: React.MouseEvent<HTMLButtonElement>) => {
      // The second click of a double click belongs to whatever opened this.
      if (event.detail > 1) return;
      // A click with no pointer behind it is one the browser made from a key
      // or an assistive action: it waits like the key itself. Only a trusted
      // click is held, so one that a script dispatches still answers at once.
      if (event.detail === 0 && event.isTrusted && !isArmed()) return;
      decide(confirmed, event.isTrusted && isArmed());
    };

  // The browser selects a radio with a click: a pointer's, or one it makes
  // from Space or an arrow key. Anything else leaves the selection as it was,
  // and React puts the radios back to the state.
  const selectChoice =
    (optionId: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const click = event.nativeEvent as Partial<MouseEvent>;
      if (click.isTrusted !== true) return;
      const detail = typeof click.detail === "number" ? click.detail : 0;
      if (detail > 1) return;
      if (detail === 0 && !isArmed()) return;
      setChoice(optionId);
    };

  // A selection key held since before the prompt, or typed ahead, must not
  // move the selection: refusing the key stops the browser's click.
  const guardChoiceKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!CHOICE_SELECTION_KEYS.has(event.key)) return;
    if (event.repeat || !isArmed()) event.preventDefault();
  };

  // Enter and Space activate the focused button natively and nothing else
  // listens for them. Refusing the key here stops that native click.
  const guardKeyboardActivation = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat || !isArmed()) event.preventDefault();
  };

  // Enter answers with the focused button, so a destructive request opens on
  // Cancel unless it asks for the action.
  const defaultAction =
    request.defaultAction ?? (request.tone === "danger" ? "cancel" : "confirm");

  const title = toSingleLine(request.title, PROMPT_LIMITS.title);
  const message = request.message
    ? toSingleLine(request.message, PROMPT_LIMITS.message)
    : "";
  const hint = request.hint
    ? toSingleLine(request.hint, PROMPT_LIMITS.message)
    : "";
  const facts = (request.facts ?? [])
    .slice(0, PROMPT_LIMITS.facts)
    .map((fact) => toSingleLine(fact, PROMPT_LIMITS.label))
    .filter(Boolean);

  const previewText = request.preview?.text;
  const preview = useMemo(() => {
    if (previewText === undefined) return undefined;
    const excerpt = excerptPreview(String(previewText));
    const text = revealHiddenCharacters(excerpt.text);
    return {
      // The end of an excerpt is not the end of the text.
      text:
        excerpt.omittedCharacters > 0
          ? text
          : revealHiddenCharacters(excerpt.text, { markFinalLineFeed: true }),
      // A Windows line end shown as one line break is not a symbol, and the
      // mark for a final line feed needs no note.
      revealed: text !== excerpt.text.replace(/\r\n/g, "\n"),
      omitted:
        excerpt.omittedCharacters > 0
          ? previewOmittedNotice({
              lines: excerpt.omittedLines,
              characters: excerpt.omittedCharacters,
            })
          : "",
    };
  }, [previewText]);

  const targetItems = request.targets?.items;
  const targets = useMemo(
    () =>
      (targetItems ?? []).slice(0, PROMPT_LIMITS.targets).map((item) => ({
        name: toSingleLine(item.name, PROMPT_LIMITS.name),
        detail: item.detail
          ? toSingleLine(item.detail, PROMPT_LIMITS.name)
          : "",
      })),
    [targetItems],
  );
  const targetsOmitted = (targetItems?.length ?? 0) - targets.length;

  const messageId = `${id}-message`;
  const queueId = `${id}-queue`;
  const previewLabelId = `${id}-preview`;
  const targetsLabelId = `${id}-targets`;
  const rememberHintId = `${id}-remember`;
  const choiceName = `${id}-choice`;
  const choicesNoteId = `${id}-choices-note`;
  const choicesNote = choices?.note
    ? toSingleLine(choices.note, PROMPT_LIMITS.message)
    : "";
  const choicesDanger = choices?.noteTone === "danger";
  const describedBy =
    [message && messageId, queued > 0 && queueId].filter(Boolean).join(" ") ||
    undefined;

  return (
    <Modal
      isOpen
      closeOnEscape={false}
      closeOnBackdrop={false}
      backdropClassName={styles.backdrop}
      panelClassName={cx("max-w-xl mx-4", !reducedMotion && styles.enter)}
      dataTestId="app-prompt"
      ariaLabel={title}
      ariaDescribedBy={describedBy}
      initialFocusRef={defaultAction === "cancel" ? cancelRef : actionRef}
    >
      <DialogHeader
        icon={tone.icon}
        iconColor={tone.iconColor}
        variant="compact"
        title={<span className={styles.wrap}>{title}</span>}
        badge={
          queued > 0 ? (
            <span
              aria-hidden="true"
              className="whitespace-nowrap"
              data-testid="app-prompt-queue"
            >
              {promptQueueLabel(1, queued + 1)}
            </span>
          ) : undefined
        }
        onClose={() => decide(false)}
      />
      {/* Always present, so a change of the queue is announced. Never the payload. */}
      <span id={queueId} className="sr-only" role="status" aria-live="polite">
        {queued > 0 ? promptQueueAnnouncement(1, queued + 1) : ""}
      </span>

      <ModalBody className="px-5 py-4 space-y-3">
        {message && (
          <p
            id={messageId}
            className={cx("text-sm text-[var(--color-text)]", styles.wrap)}
            data-testid="app-prompt-message"
          >
            {message}
          </p>
        )}

        {request.targets && (
          <div>
            <div id={targetsLabelId} className={SECTION_LABEL}>
              {toSingleLine(request.targets.label, PROMPT_LIMITS.name)}
            </div>
            <div
              role="region"
              aria-labelledby={targetsLabelId}
              tabIndex={0}
              className={cx(
                styles.scroll,
                styles.targets,
                "rounded-md border border-[var(--color-border)]",
              )}
              data-testid="app-prompt-targets"
            >
              <ul>
                {targets.map((target, index) => (
                  <li
                    key={index}
                    className={cx("px-3 py-1.5 text-sm", styles.wrap)}
                  >
                    <span className="text-[var(--color-text)]">
                      {target.name}
                    </span>
                    {target.detail && (
                      <>
                        {" "}
                        <span className="text-[var(--color-textMuted)]">
                          {target.detail}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {targetsOmitted > 0 && (
                <p
                  className="px-3 py-1.5 text-xs text-[var(--color-textSecondary)]"
                  data-testid="app-prompt-targets-more"
                >
                  {targetsOmittedNotice(targetsOmitted)}
                </p>
              )}
            </div>
          </div>
        )}

        {request.preview && preview && (
          <div>
            <div id={previewLabelId} className={SECTION_LABEL}>
              {toSingleLine(request.preview.label, PROMPT_LIMITS.name)}
            </div>
            {/* Commands and paths read left to right in every layout direction. */}
            <pre
              dir="ltr"
              role="region"
              aria-labelledby={previewLabelId}
              tabIndex={0}
              className={cx(
                styles.scroll,
                styles.preview,
                "text-xs font-mono whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[var(--color-text)]",
              )}
              data-testid="app-prompt-preview"
            >
              {preview.text}
            </pre>
            {preview.omitted && (
              <p
                className="mt-1 text-xs text-[var(--color-textSecondary)]"
                data-testid="app-prompt-preview-more"
              >
                {preview.omitted}
              </p>
            )}
            {preview.revealed && (
              <p
                className="mt-1 text-xs text-[var(--color-textMuted)]"
                data-testid="app-prompt-preview-note"
              >
                {PROMPT_HIDDEN_CHARACTERS_NOTICE}
              </p>
            )}
          </div>
        )}

        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" data-testid="app-prompt-facts">
            {facts.map((fact, index) => (
              <li
                key={index}
                className={cx(
                  "rounded bg-[var(--color-surfaceHover)] px-2 py-0.5 text-xs text-[var(--color-textSecondary)]",
                  styles.wrap,
                )}
              >
                {fact}
              </li>
            ))}
          </ul>
        )}

        {choices && choiceOptions.length > 0 && (
          <fieldset
            className={styles.choices}
            aria-describedby={choicesNote ? choicesNoteId : undefined}
            data-testid="app-prompt-choices"
          >
            <legend
              className={cx(
                "mb-1.5 text-sm font-medium text-[var(--color-text)]",
                styles.wrap,
              )}
            >
              {toSingleLine(choices.label, PROMPT_LIMITS.choiceLabel)}
            </legend>
            <div className="space-y-1.5">
              {choiceOptions.map((option, index) => {
                const hintId = `${id}-choice-${index}`;
                return (
                  <div key={option.id}>
                    <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name={choiceName}
                        value={option.id}
                        checked={option.id === selectedChoice}
                        onChange={selectChoice(option.id)}
                        onKeyDown={guardChoiceKeys}
                        aria-describedby={option.hint ? hintId : undefined}
                        data-testid="app-prompt-choice"
                      />
                      <span className={styles.wrap}>
                        {toSingleLine(option.label, PROMPT_LIMITS.choiceLabel)}
                      </span>
                    </label>
                    {option.hint && (
                      <p
                        id={hintId}
                        className={cx(
                          "ml-6 mt-0.5 text-xs text-[var(--color-textMuted)]",
                          styles.wrap,
                        )}
                      >
                        {toSingleLine(option.hint, PROMPT_LIMITS.message)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {choicesNote && (
              <p
                id={choicesNoteId}
                className={cx(
                  "mt-2 flex items-start gap-1.5 text-xs",
                  choicesDanger
                    ? "text-error"
                    : "text-[var(--color-textMuted)]",
                )}
                data-testid="app-prompt-choices-note"
              >
                {/* The tone is said by the icon and the words, never by colour alone. */}
                {choicesDanger && (
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                )}
                <span className={styles.wrap}>{choicesNote}</span>
              </p>
            )}
          </fieldset>
        )}

        {request.remember && (
          <div>
            <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
              <Checkbox
                variant="form"
                className="mt-0.5 shrink-0"
                checked={remember}
                onChange={setRemember}
                aria-describedby={
                  request.remember.hint ? rememberHintId : undefined
                }
                data-testid="app-prompt-remember"
              />
              <span className={styles.wrap}>
                {toSingleLine(request.remember.label, PROMPT_LIMITS.message)}
              </span>
            </label>
            {request.remember.hint && (
              <p
                id={rememberHintId}
                className="ml-6 mt-0.5 text-xs text-[var(--color-textMuted)]"
              >
                {toSingleLine(request.remember.hint, PROMPT_LIMITS.message)}
              </p>
            )}
          </div>
        )}

        {hint && (
          <p
            className={cx("text-xs text-[var(--color-textMuted)]", styles.wrap)}
            data-testid="app-prompt-hint"
          >
            {hint}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          ref={cancelRef}
          className={cx("sor-modal-cancel", styles.action)}
          onKeyDown={guardKeyboardActivation}
          onClick={activate(false)}
          data-testid="app-prompt-cancel"
        >
          {toSingleLine(
            request.cancelLabel || PROMPT_CANCEL_LABEL,
            PROMPT_LIMITS.label,
          )}
        </button>
        <button
          type="button"
          ref={actionRef}
          className={cx(tone.action, styles.action)}
          onKeyDown={guardKeyboardActivation}
          onClick={activate(true)}
          data-tone={request.tone ?? "default"}
          data-testid="app-prompt-confirm"
        >
          {toSingleLine(request.confirmLabel, PROMPT_LIMITS.label)}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default AppPromptDialog;
