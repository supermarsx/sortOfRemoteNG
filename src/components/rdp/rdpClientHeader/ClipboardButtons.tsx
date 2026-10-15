import React from "react";
import { btnDefault, btnDisabled } from "./helpers";
import { ClipboardPaste, Copy } from "lucide-react";

const ClipboardButtons: React.FC<{
  isConnected: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  policyStatus?: "pending" | "ready" | "error";
  onCopy: () => void;
  onPaste: () => void;
}> = ({
  isConnected,
  canCopy = true,
  canPaste = true,
  policyStatus = "ready",
  onCopy,
  onPaste,
}) => {
  const reason =
    policyStatus === "pending"
      ? "Applying RDP clipboard settings…"
      : policyStatus === "error"
        ? "Reconnect this session to apply clipboard settings."
        : "This clipboard direction is disabled.";
  return (
    <>
      <button
        type="button"
        aria-label="Copy remote clipboard"
        onClick={() => onCopy()}
        className={isConnected && canCopy ? btnDefault : btnDisabled}
        disabled={!isConnected || !canCopy}
        data-tooltip={canCopy ? "Copy remote clipboard" : reason}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        aria-label="Paste from clipboard"
        onClick={() => onPaste()}
        className={isConnected && canPaste ? btnDefault : btnDisabled}
        disabled={!isConnected || !canPaste}
        data-tooltip={canPaste ? "Paste from clipboard" : reason}
      >
        <ClipboardPaste size={14} />
      </button>
    </>
  );
};
export default ClipboardButtons;
