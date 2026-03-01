import React from "react";
import { RDPClientHeaderProps, btnActive, btnDefault } from "./helpers";
import { Activity, Camera, ClipboardCopy, Copy, Save, Search, Settings } from "lucide-react";

const ToolbarButtons: React.FC<{ p: RDPClientHeaderProps }> = ({ p }) => (
  <>
    {p.magnifierEnabled && (
      <button
        onClick={() => p.setMagnifierActive(!p.magnifierActive)}
        className={p.magnifierActive ? btnActive : btnDefault}
        title="Magnifier Glass"
      >
        <Search size={14} />
      </button>
    )}
    <button
      onClick={() => p.setShowInternals(!p.showInternals)}
      className={p.showInternals ? btnActive : btnDefault}
      title="RDP Internals"
    >
      <Activity size={14} />
    </button>
    <button
      onClick={() => p.setShowSettings(!p.showSettings)}
      className={btnDefault}
      title="RDP Settings"
    >
      <Settings size={14} />
    </button>
    <button
      onClick={p.handleScreenshot}
      className={btnDefault}
      title="Save screenshot to file"
    >
      <Camera size={14} />
    </button>
    <button
      onClick={p.handleScreenshotToClipboard}
      className={btnDefault}
      title="Copy screenshot to clipboard"
    >
      <ClipboardCopy size={14} />
    </button>
  </>
);

export default ToolbarButtons;
