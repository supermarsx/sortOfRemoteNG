import React, { useEffect, useSyncExternalStore } from "react";
import { AppPromptDialog } from "./AppPromptDialog";
import styles from "./AppPromptDialog.module.css";
import {
  cancelAllPrompts,
  getPromptSnapshot,
  registerPromptHost,
  settlePrompt,
  subscribePrompts,
  type PendingPrompt,
  type PromptDecision,
} from "../../../utils/prompts/promptQueue";

const NOT_CONFIRMED: PromptDecision = { confirmed: false, remember: false };

// The window roots are prerendered; nothing is ever pending on the server.
const NO_PROMPTS: readonly PendingPrompt[] = [];
const getServerSnapshot = () => NO_PROMPTS;

const ACTIVATION_KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;

/** The prompt's backdrop, and so everything in the prompt, carries the dialog's own class. */
const isInsidePrompt = (target: Element) => {
  for (let node: Element | null = target; node; node = node.parentElement)
    if (node.classList.contains(styles.backdrop)) return true;
  return false;
};

/** A prompt that cannot be drawn cannot be read, so it is answered "no". */
class PromptFailureBoundary extends React.Component<
  { onFailure: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Shows the window's pending prompts, one at a time. Mount exactly one in
 * each window root: without it `requestPrompt` rejects in that window, and
 * when it unmounts every pending prompt resolves as not confirmed.
 */
export const PromptHost: React.FC = () => {
  const pending = useSyncExternalStore(
    subscribePrompts,
    getPromptSnapshot,
    getServerSnapshot,
  );

  useEffect(() => registerPromptHost(), []);

  // Escape cancels the visible prompt and nothing else. The listener is added
  // once, when the host mounts, and reads the queue when the key arrives, so
  // it runs ahead of capture listeners that are added to window later and
  // stops them. The fullscreen provider, whose own Escape listener may have
  // been added first, stands aside while a prompt is pending. Dialogs
  // underneath listen on document and never see the key.
  //
  // Enter and Space answer a prompt only through its own buttons, and while
  // one is showing they must not answer anything else: a dialog underneath
  // may confirm on Enter from its document listener. So from anywhere in the
  // prompt but its buttons these keys keep their native effect (the checkbox,
  // scrolling a region) and go no further, and with nothing focused they do
  // nothing at all. A control outside the prompt that holds the focus is left
  // alone: the unlock screen and menus sit above the prompt and must work.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const head = getPromptSnapshot()[0];
      if (!head) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A held key cancels one prompt, not every prompt waiting behind it.
      if (!event.repeat) settlePrompt(head.id, NOT_CONFIRMED);
    };
    const onActivationKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (getPromptSnapshot().length === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        target !== document.body &&
        target !== document.documentElement
      ) {
        if (!isInsidePrompt(target) || target.closest("button")) return;
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    for (const type of ACTIVATION_KEY_EVENTS)
      window.addEventListener(type, onActivationKey, true);
    window.addEventListener("pagehide", cancelAllPrompts);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      for (const type of ACTIVATION_KEY_EVENTS)
        window.removeEventListener(type, onActivationKey, true);
      window.removeEventListener("pagehide", cancelAllPrompts);
    };
  }, []);

  const head = pending[0];
  if (!head) return null;

  // Keyed by prompt: each one starts with its own focus, checkbox, entrance
  // and single answer, and the next is on screen in the same commit.
  return (
    <PromptFailureBoundary
      key={head.id}
      onFailure={() => settlePrompt(head.id, NOT_CONFIRMED)}
    >
      <AppPromptDialog
        request={head.request}
        queued={pending.length - 1}
        onDecision={(decision) => settlePrompt(head.id, decision)}
      />
    </PromptFailureBoundary>
  );
};

export default PromptHost;
