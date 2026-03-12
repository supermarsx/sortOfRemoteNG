import React from "react";
import { btnDefault, btnDisabled } from "./helpers";
import { ClipboardPaste, Copy } from "lucide-react";

const ClipboardButtons: React.FC<{
  isConnected: boolean;
  onCopy: () => void;
  onPaste: () => void;
}> = ({ isConnected, onCopy, onPaste }) => (
  <>
    <button
      onClick={onCopy}
      className={isConnected ? btnDefault : btnDisabled}
      disabled={!isConnected}
      data-tooltip="Copy to clipboard"
    >
      <Copy size={14} />
    </button>
    <button
      onClick={onPaste}
      className={isConnected ? btnDefault : btnDisabled}
      disabled={!isConnected}
      data-tooltip="Paste from clipboard"
    >
      <ClipboardPaste size={14} />
    </button>
  </>
);

export default ClipboardButtons;
