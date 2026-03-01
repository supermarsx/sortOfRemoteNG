import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";
import React, { useState } from "react";
import { History, RefreshCw, Send } from "lucide-react";

const ChatTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({ wa }) => {
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<WaChatMessage[]>([]);
  const [quickTo, setQuickTo] = useState("");
  const [quickText, setQuickText] = useState("");
  const [quickResult, setQuickResult] = useState<string | null>(null);

  const loadMessages = async () => {
    if (!threadId) return;
    const msgs = await wa.getMessages.execute(threadId);
    if (msgs) setMessages(msgs);
  };

  const handleQuickSend = async () => {
    setQuickResult(null);
    const msgId = await wa.sendAuto.execute(quickTo, quickText);
    if (msgId) {
      setQuickResult(`Sent (${msgId})`);
      setQuickText("");
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Quick send */}
      <div className="space-y-2">
        <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
          <Send size={16} />
          <span>Quick Send</span>
        </h3>
        <div className="flex space-x-2">
          <input
            value={quickTo}
            onChange={(e) => setQuickTo(e.target.value)}
            className="sor-input flex-shrink-0 w-40"
            placeholder="+1234567890"
          />
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            className="sor-input flex-1"
            placeholder="Message..."
            onKeyDown={(e) => e.key === "Enter" && handleQuickSend()}
          />
          <button
            onClick={handleQuickSend}
            disabled={wa.sendAuto.loading || !quickTo || !quickText}
            className="sor-btn-primary px-3"
          >
            {wa.sendAuto.loading ? <LoadingSpinner /> : <Send size={14} />}
          </button>
        </div>
        <ErrorMsg msg={wa.sendAuto.error} />
        {quickResult && <span className="text-green-400 text-xs">{quickResult}</span>}
      </div>

      <hr className="border-[var(--color-border)]" />

      {/* Thread viewer */}
      <div className="space-y-2">
        <h3 className="text-[var(--color-text)] font-medium text-sm">Chat History</h3>
        <div className="flex space-x-2">
          <input
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            className="sor-input flex-1"
            placeholder="Contact WA ID (e.g. 1234567890)"
          />
          <button
            onClick={loadMessages}
            disabled={wa.getMessages.loading || !threadId}
            className="sor-btn px-3"
          >
            {wa.getMessages.loading ? <LoadingSpinner /> : <RefreshCw size={14} />}
          </button>
        </div>
        <ErrorMsg msg={wa.getMessages.error} />
      </div>

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            No messages loaded.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === "outgoing" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                m.direction === "outgoing"
                  ? "bg-green-700 text-white rounded-br-none"
                  : "bg-[var(--color-border)] text-[var(--color-text)] rounded-bl-none"
              }`}
            >
              <div>{m.body ?? `[${m.msgType}]`}</div>
              <div className="text-[10px] opacity-60 mt-0.5 text-right">
                {new Date(m.timestamp).toLocaleTimeString()}{" "}
                {m.direction === "outgoing" && (
                  <span className="ml-1">
                    {m.status === "read"
                      ? "✓✓"
                      : m.status === "delivered"
                        ? "✓✓"
                        : m.status === "sent"
                          ? "✓"
                          : m.status === "failed"
                            ? "✗"
                            : "◷"}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatTab;
