import React, { useEffect, useSyncExternalStore } from "react";
import { AppPromptDialog } from "./AppPromptDialog";
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
  // once, when the host mounts, and reads the queue when the key arrives:
  // capture listeners on window run in the order they were added, and the
  // fullscreen provider adds its own Escape listener later, when a session
  // enters fullscreen. Added per prompt, this one would run second and a
  // single Escape would also leave fullscreen. Dialogs underneath listen on
  // document and never see the key.
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
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pagehide", cancelAllPrompts);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
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
