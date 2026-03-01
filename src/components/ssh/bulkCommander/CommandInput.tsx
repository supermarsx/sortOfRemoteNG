import { Mgr, TFunc } from "./types";

function CommandInput({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex gap-3">
        <div className="flex-1">
          <textarea
            ref={mgr.commandInputRef}
            value={mgr.command}
            onChange={(e) => mgr.setCommand(e.target.value)}
            onKeyDown={mgr.handleKeyDown}
            placeholder={t(
              "bulkSsh.commandPlaceholder",
              "Enter command to send to all selected sessions...",
            )}
            className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 font-mono text-sm resize-y min-h-[80px] max-h-[300px]"
            rows={3}
            disabled={mgr.isExecuting || mgr.selectedCount === 0}
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={mgr.executeCommand}
            disabled={
              !mgr.command.trim() ||
              mgr.selectedCount === 0 ||
              mgr.isExecuting
            }
            className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
          >
            {mgr.isExecuting ? (
              <>
                <div className="w-4 h-4 border-2 border-[var(--color-border)]/30 border-t-[var(--color-text)] rounded-full animate-spin" />
                {t("bulkSsh.executing", "Running...")}
              </>
            ) : (
              <>
                <Send size={16} />
                {t("bulkSsh.send", "Send")}
              </>
            )}
          </button>
          <button
            onClick={mgr.sendCancel}
            disabled={mgr.selectedCount === 0}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
            title={t("bulkSsh.sendCancel", "Send Ctrl+C")}
          >
            <StopCircle size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommandInput;
