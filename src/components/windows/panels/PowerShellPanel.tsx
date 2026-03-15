import React, { useState, useCallback, useRef, useEffect } from "react";
import { Play, Loader2, AlertCircle, Trash2, Terminal } from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";

interface HistoryEntry {
  command: string;
  output: string;
  error: boolean;
  timestamp: Date;
}

interface PowerShellPanelProps {
  ctx: WinmgmtContext;
}

/**
 * PowerShell panel that executes WQL queries via the raw_query command.
 * Not a full PS shell — uses WMI raw query capability for remote execution.
 */
const PowerShellPanel: React.FC<PowerShellPanelProps> = ({ ctx }) => {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const execute = useCallback(async () => {
    if (!command.trim()) return;
    const cmd = command.trim();
    setCommand("");
    setRunning(true);
    setHistoryIndex(-1);

    try {
      const results = await ctx.cmd<Record<string, string>[]>(
        "winmgmt_raw_query",
        { query: cmd },
      );
      const output =
        results.length === 0
          ? "(no results)"
          : results
              .map((row) =>
                Object.entries(row)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n"),
              )
              .join("\n---\n");

      setHistory((prev) => [
        ...prev,
        { command: cmd, output, error: false, timestamp: new Date() },
      ]);
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          command: cmd,
          output: String(err),
          error: true,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [command, ctx]);

  // Scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      execute();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const cmds = history.map((h) => h.command);
      if (cmds.length > 0) {
        const newIndex = historyIndex < cmds.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCommand(cmds[cmds.length - 1 - newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(history[history.length - 1 - newIndex].command);
      } else {
        setHistoryIndex(-1);
        setCommand("");
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1a2e]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <Terminal size={14} className="text-blue-400" />
        <span className="text-xs text-[var(--color-textSecondary)]">
          WMI Query Console — {ctx.hostname}
        </span>
        <button
          onClick={() => setHistory([])}
          className="ml-auto p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]"
          title="Clear"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto p-3 font-mono text-xs"
      >
        {history.length === 0 && (
          <div className="text-gray-500 mb-3">
            <p>WMI Query Console</p>
            <p className="mt-1">
              Enter WQL queries to execute on the remote machine.
            </p>
            <p className="text-gray-600 mt-2">Examples:</p>
            <p className="text-gray-600">
              {" "}
              SELECT Name, State FROM Win32_Service WHERE State = 'Running'
            </p>
            <p className="text-gray-600">
              {" "}
              SELECT * FROM Win32_OperatingSystem
            </p>
            <p className="text-gray-600">
              {" "}
              SELECT Name, WorkingSetSize FROM Win32_Process
            </p>
          </div>
        )}
        {history.map((entry, i) => (
          <div key={i} className="mb-3">
            <div className="text-blue-400 flex items-center gap-1">
              <span className="text-gray-500">PS&gt;</span> {entry.command}
            </div>
            <pre
              className={`mt-1 whitespace-pre-wrap ${entry.error ? "text-red-400" : "text-gray-300"}`}
            >
              {entry.output}
            </pre>
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 size={12} className="animate-spin" />
            Executing…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] bg-[#141428] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-mono text-xs">PS&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            placeholder="Enter WQL query…"
            className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-gray-200 placeholder:text-gray-600"
            autoFocus
          />
          <button
            onClick={execute}
            disabled={running || !command.trim()}
            className="p-1 rounded hover:bg-blue-500/20 text-blue-400 disabled:opacity-30"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PowerShellPanel;
