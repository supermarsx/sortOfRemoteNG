import React, { useState } from "react";
import {
  TRIGGER_TYPES,
  SCRIPT_LANGUAGES,
  EXECUTION_MODES,
} from "../../../types/ssh/sshScripts";
import { FormField } from "../../ui/forms/FormField";
import type {
  CreateScriptFormProps,
  ScriptTrigger,
  ScriptLanguage,
  ExecutionMode,
} from "./types";

export const CreateScriptForm: React.FC<CreateScriptFormProps> = ({
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("#!/bin/bash\n\n");
  const [language, setLanguage] = useState<ScriptLanguage>("bash");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("exec");
  const [triggerType, setTriggerType] = useState<string>("login");
  const [category, setCategory] = useState("Custom");
  const [tagsInput, setTagsInput] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [delayMs, setDelayMs] = useState(0);
  const [intervalMs, setIntervalMs] = useState(60000);
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [pattern, setPattern] = useState("");
  const [idleMs, setIdleMs] = useState(300000);
  const [saving, setSaving] = useState(false);

  const buildTrigger = (): ScriptTrigger => {
    switch (triggerType) {
      case "login":
        return { type: "login", delayMs };
      case "logout":
        return { type: "logout", runOnError: false };
      case "reconnect":
        return { type: "reconnect" };
      case "connectionError":
        return { type: "connectionError" };
      case "interval":
        return { type: "interval", intervalMs };
      case "cron":
        return { type: "cron", expression: cronExpr };
      case "outputMatch":
        return {
          type: "outputMatch",
          pattern,
          cooldownMs: 5000,
        };
      case "idle":
        return { type: "idle", idleMs, repeat: false };
      case "manual":
        return { type: "manual" };
      case "resize":
        return { type: "resize" };
      case "keepaliveFailed":
        return { type: "keepaliveFailed", consecutiveFailures: 3 };
      case "portForwardChange":
        return { type: "portForwardChange" };
      case "hostKeyChanged":
        return { type: "hostKeyChanged" };
      default:
        return { type: "manual" };
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        content,
        language,
        executionMode,
        trigger: buildTrigger(),
        category,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        timeoutMs,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white">Create Script</h3>

      <div className="mt-6 space-y-4">
        {/* Name */}
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Login Banner Cleanup"
            className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white placeholder-text-muted focus:border-primary focus:outline-none"
          />
        </FormField>

        {/* Description */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this script do?"
            rows={2}
            className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white placeholder-text-muted focus:border-primary focus:outline-none"
          />
        </FormField>

        {/* Trigger + Language + Mode */}
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Trigger">
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Language">
            <select
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value as ScriptLanguage)
              }
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            >
              {SCRIPT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Execution Mode">
            <select
              value={executionMode}
              onChange={(e) =>
                setExecutionMode(e.target.value as ExecutionMode)
              }
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            >
              {EXECUTION_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Trigger-specific fields */}
        {triggerType === "login" && (
          <FormField label="Delay after login (ms)">
            <input
              type="number"
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}
        {triggerType === "interval" && (
          <FormField label="Interval (ms)">
            <input
              type="number"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}
        {triggerType === "cron" && (
          <FormField label="Cron expression">
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 * * * *"
              className="w-60 rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white font-mono"
            />
          </FormField>
        )}
        {triggerType === "outputMatch" && (
          <FormField label="Output regex pattern">
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="error|fail|warn"
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white font-mono"
            />
          </FormField>
        )}
        {triggerType === "idle" && (
          <FormField label="Idle timeout (ms)">
            <input
              type="number"
              value={idleMs}
              onChange={(e) => setIdleMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}

        {/* Category + Tags + Timeout */}
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Category">
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Tags (comma-separated)">
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="ssh, monitoring"
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Timeout (ms)">
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full rounded-lg border border-theme-border bg-surface px-3 py-2 text-sm text-white"
            />
          </FormField>
        </div>

        {/* Script content */}
        <FormField label="Script Content">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full rounded-lg border border-theme-border bg-background px-4 py-3 font-mono text-sm text-success placeholder-text-muted focus:border-primary focus:outline-none"
          />
        </FormField>
      </div>

      {/* Footer */}
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-surfaceHover"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={!name.trim() || saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create Script"}
        </button>
      </div>
    </div>
  );
};
