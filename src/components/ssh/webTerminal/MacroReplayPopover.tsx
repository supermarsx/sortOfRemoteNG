import { WebTerminalMgr } from "./types";
import PopoverSurface from "../../ui/overlays/PopoverSurface";
import { PlayCircle, StopCircle } from "lucide-react";
import { OptionList, OptionEmptyState, OptionItemButton } from "../../ui/display/OptionList";

function MacroReplayPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.macroListRef}>
      {mgr.replayingMacro ? (
        <button
          onClick={mgr.handleStopReplay}
          className="app-bar-button p-2 text-orange-400"
          data-tooltip="Stop Replay"
          aria-label="Stop Replay"
        >
          <StopCircle size={14} />
        </button>
      ) : (
        <button
          onClick={() => mgr.setShowMacroList((v) => !v)}
          className={`app-bar-button p-2 ${mgr.showMacroList ? "text-blue-400" : ""}`}
          data-tooltip="Replay Macro"
          aria-label="Replay Macro"
          disabled={mgr.status !== "connected"}
        >
          <PlayCircle size={14} />
        </button>
      )}
      <PopoverSurface
        isOpen={mgr.showMacroList}
        onClose={() => mgr.setShowMacroList(false)}
        anchorRef={mgr.macroListRef}
        className="sor-popover-panel w-64 max-h-64 overflow-y-auto"
        dataTestId="web-terminal-macro-popover"
      >
        <OptionList>
          {mgr.savedMacros.length === 0 ? (
            <OptionEmptyState>No saved macros</OptionEmptyState>
          ) : (
            mgr.savedMacros.map((m) => (
              <OptionItemButton
                key={m.id}
                onClick={() => mgr.handleReplayMacro(m)}
                divider
                className="text-sm"
              >
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  {m.steps.length} steps
                </div>
              </OptionItemButton>
            ))
          )}
        </OptionList>
      </PopoverSurface>
    </div>
  );
}

export default MacroReplayPopover;
