import React from "react";
import { RDPClientHeaderProps, btnActive, btnDefault } from "./helpers";
import { Activity, Camera, ClipboardCopy, Maximize2, Minimize2, Search, Settings, X } from "lucide-react";

const ToolbarButtons: React.FC<{ p: RDPClientHeaderProps }> = ({ p }) => (
  <>
    <button
      onClick={() => p.setMagnifierActive(!p.magnifierActive)}
      className={p.magnifierActive ? btnActive : btnDefault}
      data-tooltip="Magnifier"
    >
      <Search size={14} />
    </button>
    {p.magnifierActive && (
      <div className="flex items-center gap-1 ml-2 px-2 py-0.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)] text-xs">
        <span className="text-[var(--color-textMuted)] mr-1">Magnifier</span>
        <button onClick={() => p.setMagnifierZoom(Math.max(2, p.magnifierZoom - 1))} className="px-1 hover:bg-[var(--color-surfaceHover)] rounded" data-tooltip="Decrease zoom">&minus;</button>
        <span className="text-[var(--color-textSecondary)] w-6 text-center">{p.magnifierZoom}x</span>
        <button onClick={() => p.setMagnifierZoom(Math.min(8, p.magnifierZoom + 1))} className="px-1 hover:bg-[var(--color-surfaceHover)] rounded" data-tooltip="Increase zoom">+</button>
        <div className="w-px h-3 bg-[var(--color-border)] mx-1" />
        <button onClick={() => p.setMagnifierPipSize(Math.max(150, (p.magnifierPipSize ?? 280) - 40))} className="px-1 hover:bg-[var(--color-surfaceHover)] rounded" data-tooltip="Smaller window">
          <Minimize2 size={11} />
        </button>
        <button onClick={() => p.setMagnifierPipSize(Math.min(500, (p.magnifierPipSize ?? 280) + 40))} className="px-1 hover:bg-[var(--color-surfaceHover)] rounded" data-tooltip="Larger window">
          <Maximize2 size={11} />
        </button>
        <div className="w-px h-3 bg-[var(--color-border)] mx-1" />
        <button onClick={() => p.setMagnifierActive(false)} className="px-1 hover:bg-error/20 hover:text-error rounded" data-tooltip="Close magnifier">
          <X size={11} />
        </button>
      </div>
    )}
    <button
      onClick={() => p.setShowInternals(!p.showInternals)}
      className={p.showInternals ? btnActive : btnDefault}
      data-tooltip="RDP Internals"
    >
      <Activity size={14} />
    </button>
    <button
      onClick={() => p.setShowSettings(!p.showSettings)}
      className={btnDefault}
      data-tooltip="RDP Settings"
    >
      <Settings size={14} />
    </button>
    <button
      onClick={p.handleScreenshot}
      className={btnDefault}
      data-tooltip="Save screenshot to file"
    >
      <Camera size={14} />
    </button>
    <button
      onClick={p.handleScreenshotToClipboard}
      className={btnDefault}
      data-tooltip="Copy screenshot to clipboard"
    >
      <ClipboardCopy size={14} />
    </button>
  </>
);

export default ToolbarButtons;
