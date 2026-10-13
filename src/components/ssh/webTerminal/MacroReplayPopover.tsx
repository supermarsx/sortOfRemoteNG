import { classifyRunRisk } from "../../../utils/recording/scriptRunTrust";
import { TrustedScriptMark } from "../../recording/scriptTrust/TrustedScriptMark";
import { WebTerminalMgr } from "./types";
import PopoverSurface from "../../ui/overlays/PopoverSurface";
import { PlayCircle, StopCircle } from "lucide-react";
import {
  OptionList,
  OptionEmptyState,
  OptionItemButton,
} from "../../ui/display/OptionList";

function MacroReplayPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.macroListRef}>
      {mgr.replayingMacro ? (
        <button
          onClick={mgr.handleStopReplay}
          className="app-bar-button p-2 text-warning"
          data-tooltip="Stop Replay"
          aria-label="Stop Replay"
        >
          <StopCircle size={14} />
        </button>
      ) : (
        <button
          onClick={() => mgr.setShowMacroList((v) => !v)}
          className={`app-bar-button p-2 ${mgr.showMacroList ? "text-primary" : ""}`}
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
        <p className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
          {mgr.terminalLibrary.error ??
            "App-wide macros. Database macros are available in the Macro Manager and favorites."}
        </p>
        <OptionList>
          {mgr.savedMacros.length === 0 ? (
            <OptionEmptyState>No saved macros</OptionEmptyState>
          ) : (
            mgr.savedMacros.map((m) => (
              <div key={m.id}>
                <OptionItemButton
                  onClick={() => mgr.handleReplayMacro(m)}
                  divider
                  className="text-sm"
                >
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-[10px] text-[var(--color-textSecondary)]">
                    {m.steps.length} steps
                  </div>
                </OptionItemButton>
                {mgr.scriptTrust?.macroMarks.get(m.id) && (
                  <TrustedScriptMark
                    scope={mgr.scriptTrust.macroMarks.get(m.id)!}
                    destructive={
                      classifyRunRisk({ kind: "ssh-macro", steps: m.steps }) ===
                      "destructive"
                    }
                    name={m.name}
                    onRevoke={() =>
                      mgr.scriptTrust.revoke({
                        kind: "ssh-macro",
                        library: { kind: "app" },
                        subjectId: m.id,
                      })
                    }
                  />
                )}
              </div>
            ))
          )}
        </OptionList>
      </PopoverSurface>
    </div>
  );
}

export default MacroReplayPopover;
