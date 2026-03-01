import React from "react";
import { btnDefault, btnDisabled } from "./helpers";

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
      title="Copy to clipboard"
    >
      <Copy size={14} />
    </button>
    <button
      onClick={onPaste}
      className={isConnected ? btnDefault : btnDisabled}
      disabled={!isConnected}
      title="Paste from clipboard"
    >
      <ClipboardPaste size={14} />
    </button>
  </>
);

export default ClipboardButtons;
