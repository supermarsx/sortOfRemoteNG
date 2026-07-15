import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorAutomationV1,
  ConnectionBehaviorEventReason,
  ConnectionBehaviorRuleV1,
} from "../../../types/connection/behavior";
import type { CustomScript } from "../../../types/settings/settings";
import { SettingsManager } from "../../../utils/settings/settingsManager";
import {
  Checkbox,
  FormField,
  NumberInput,
  Select,
  Textarea,
  TextInput,
} from "../../ui/forms";
import {
  BEHAVIOR_REASON_OPTIONS,
  createDefaultBehaviorAction,
  createDefaultBehaviorRule,
  EDITABLE_ACTION_TYPES,
  EDITABLE_SESSION_EVENTS,
  inspectBehaviorAutomationForEditor,
  moveBehaviorItem,
  parseOptionalNonNegativeInteger,
  validateBehaviorAutomationForEditor,
  type BehaviorEditorValidationIssue,
  type EditableBehaviorActionType,
} from "./behaviorEditor";

const TRI_STATE_OPTIONS = [
  { value: "", label: "Use global setting" },
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
] as const;

const FOCUS_OPTIONS = [
  { value: "", label: "Use global setting" },
  { value: "true", label: "Focus tab" },
  { value: "false", label: "Open in background" },
] as const;

const WARN_OPTIONS = [
  { value: "", label: "Use global setting" },
  { value: "true", label: "Warn before closing" },
  { value: "false", label: "Close without warning" },
] as const;

const parseOptionalBool = (value: string): boolean | undefined =>
  value === "true" ? true : value === "false" ? false : undefined;

const boolSelectValue = (value: boolean | undefined): string =>
  value === true ? "true" : value === false ? "false" : "";

const buttonClass =
  "inline-flex items-center justify-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed disabled:opacity-40";

const EMPTY_AUTOMATION: ConnectionBehaviorAutomationV1 = {
  version: 1,
  rules: [],
};

interface OptionalNumberFieldProps {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

const OptionalNumberField: React.FC<OptionalNumberFieldProps> = ({
  id,
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  hint,
}) => (
  <FormField label={label} htmlFor={id} hint={hint}>
    <input
      id={id}
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      placeholder="Global"
      className="sor-form-input"
      onChange={(event) =>
        onChange(
          parseOptionalNonNegativeInteger(
            event.target.value,
            max ?? Number.MAX_SAFE_INTEGER,
          ),
        )
      }
    />
  </FormField>
);

const issuesAt = (
  issues: readonly BehaviorEditorValidationIssue[],
  path: string,
): string | undefined => issues.find((issue) => issue.path === path)?.message;

interface ActionEditorProps {
  action: ConnectionBehaviorActionV1;
  actionIndex: number;
  ruleIndex: number;
  actionCount: number;
  scripts: readonly CustomScript[];
  issues: readonly BehaviorEditorValidationIssue[];
  onReplace: (action: ConnectionBehaviorActionV1) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

const ActionEditor: React.FC<ActionEditorProps> = ({
  action,
  actionIndex,
  ruleIndex,
  actionCount,
  scripts,
  issues,
  onReplace,
  onRemove,
  onMove,
}) => {
  const number = actionIndex + 1;
  const prefix = `behavior-rule-${ruleIndex + 1}-action-${number}`;
  const scriptError = issuesAt(
    issues,
    `rules[${ruleIndex}].actions[${actionIndex}].scriptId`,
  );
  const scriptOptions = scripts.map((script) => ({
    value: script.id,
    label: `${script.name}${script.enabled ? "" : " (disabled)"}`,
    disabled: !script.enabled,
    title: script.protocol ? `Protocol: ${script.protocol}` : undefined,
  }));
  if (
    action.type === "runCustomScript" &&
    action.scriptId &&
    !scripts.some((script) => script.id === action.scriptId)
  ) {
    scriptOptions.unshift({
      value: action.scriptId,
      label: `Unavailable script (${action.scriptId})`,
      disabled: true,
      title: "This saved script no longer exists.",
    });
  }

  return (
    <li className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--color-textSecondary)]">
          Action {number}
        </span>
        <div className="min-w-44 flex-1">
          <Select
            label={`Action ${number} type`}
            value={action.type}
            onChange={(value) =>
              onReplace(
                createDefaultBehaviorAction(
                  value as EditableBehaviorActionType,
                  scripts,
                ),
              )
            }
            options={EDITABLE_ACTION_TYPES.map((option) => ({ ...option }))}
            variant="form-sm"
          />
        </div>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Move action ${number} up`}
          disabled={actionIndex === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Move action ${number} down`}
          disabled={actionIndex === actionCount - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Remove action ${number}`}
          onClick={onRemove}
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>

      {action.type === "notify" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <TextInput
            id={`${prefix}-title`}
            label={`Action ${number} notification title`}
            value={action.title ?? ""}
            onChange={(title) => onReplace({ ...action, title })}
            placeholder="{{connection.name}}"
            variant="form-sm"
          />
          <Select
            label={`Action ${number} notification level`}
            value={action.level ?? "info"}
            onChange={(level) =>
              onReplace({
                ...action,
                level: level as "info" | "warning" | "error",
              })
            }
            options={[
              { value: "info", label: "Information" },
              { value: "warning", label: "Warning" },
              { value: "error", label: "Error" },
            ]}
            variant="form-sm"
          />
          <Textarea
            id={`${prefix}-message`}
            label={`Action ${number} notification message`}
            value={action.message ?? ""}
            onChange={(message) => onReplace({ ...action, message })}
            placeholder="{{event.type}}"
            variant="form-sm"
            rows={2}
          />
          <Select
            label={`Action ${number} notification sound`}
            value={action.sound ?? "inherit"}
            onChange={(sound) =>
              onReplace({
                ...action,
                sound: sound as "inherit" | "on" | "off",
              })
            }
            options={[
              { value: "inherit", label: "Use global setting" },
              { value: "on", label: "Sound on" },
              { value: "off", label: "Silent" },
            ]}
            variant="form-sm"
          />
        </div>
      )}

      {action.type === "writeLog" && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_10rem] gap-2">
          <Textarea
            id={`${prefix}-log-message`}
            label={`Action ${number} log message`}
            value={action.message ?? ""}
            onChange={(message) => onReplace({ ...action, message })}
            placeholder="{{event.type}} for {{connection.name}}"
            variant="form-sm"
            rows={2}
          />
          <Select
            label={`Action ${number} log level`}
            value={action.level ?? "info"}
            onChange={(level) =>
              onReplace({
                ...action,
                level: level as "info" | "warn" | "error",
              })
            }
            options={[
              { value: "info", label: "Information" },
              { value: "warn", label: "Warning" },
              { value: "error", label: "Error" },
            ]}
            variant="form-sm"
          />
        </div>
      )}

      {action.type === "reconnect" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <OptionalNumberField
            id={`${prefix}-reconnect-delay`}
            label={`Action ${number} reconnect delay (ms)`}
            value={action.delayMs}
            onChange={(delayMs) => onReplace({ ...action, delayMs })}
            max={86_400_000}
          />
          <OptionalNumberField
            id={`${prefix}-reconnect-attempts`}
            label={`Action ${number} maximum attempts`}
            value={action.maxAttempts}
            onChange={(maxAttempts) => onReplace({ ...action, maxAttempts })}
            max={100}
            hint="0 prevents the action from starting a retry."
          />
          <FormField label="Backoff">
            <Select
              label={`Action ${number} reconnect backoff`}
              value={action.backoff ?? "fixed"}
              onChange={(backoff) =>
                onReplace({
                  ...action,
                  backoff: backoff as "fixed" | "exponential",
                })
              }
              options={[
                { value: "fixed", label: "Fixed delay" },
                { value: "exponential", label: "Exponential delay" },
              ]}
              variant="form-sm"
            />
          </FormField>
        </div>
      )}

      {action.type === "runCustomScript" && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_12rem] gap-2">
          <FormField
            label="Saved script"
            error={scriptError}
            hint={
              scripts.length === 0
                ? "Create a saved custom script in Settings first."
                : undefined
            }
          >
            <Select
              label={`Action ${number} saved script`}
              value={action.scriptId}
              onChange={(scriptId) => onReplace({ ...action, scriptId })}
              options={scriptOptions}
              placeholder="Select a saved script"
              searchable
              searchPlaceholder="Search saved scripts"
              variant="form-sm"
            />
          </FormField>
          <OptionalNumberField
            id={`${prefix}-script-timeout`}
            label={`Action ${number} script timeout (ms)`}
            value={action.timeoutMs}
            onChange={(timeoutMs) => onReplace({ ...action, timeoutMs })}
            max={3_600_000}
          />
        </div>
      )}
    </li>
  );
};

interface RuleEditorProps {
  rule: ConnectionBehaviorRuleV1;
  ruleIndex: number;
  ruleCount: number;
  scripts: readonly CustomScript[];
  issues: readonly BehaviorEditorValidationIssue[];
  onReplace: (rule: ConnectionBehaviorRuleV1) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

const RuleEditor: React.FC<RuleEditorProps> = ({
  rule,
  ruleIndex,
  ruleCount,
  scripts,
  issues,
  onReplace,
  onRemove,
  onMove,
}) => {
  const [newActionType, setNewActionType] =
    useState<EditableBehaviorActionType>("notify");
  const number = ruleIndex + 1;
  const prefix = `rules[${ruleIndex}]`;
  const ruleNameError = issuesAt(issues, `${prefix}.name`);
  const actionsError = issuesAt(issues, `${prefix}.actions`);
  const idError = issuesAt(issues, `${prefix}.id`);

  const replaceActions = (actions: ConnectionBehaviorActionV1[]) =>
    onReplace({ ...rule, actions });

  const toggleReason = (
    reason: ConnectionBehaviorEventReason,
    checked: boolean,
  ) => {
    const current = rule.when?.reasons ?? [];
    const reasons = checked
      ? [...current, reason].filter(
          (candidate, index, all) => all.indexOf(candidate) === index,
        )
      : current.filter((candidate) => candidate !== reason);
    const when = {
      ...rule.when,
      reasons: reasons.length > 0 ? reasons : undefined,
    };
    onReplace({
      ...rule,
      when: when.reasons || when.windowKinds ? when : undefined,
    });
  };

  return (
    <article
      data-testid={`behavior-rule-${rule.id}`}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4 space-y-4"
      aria-labelledby={`behavior-rule-${rule.id}-heading`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          variant="form"
          checked={rule.enabled !== false}
          onChange={(enabled) => onReplace({ ...rule, enabled })}
          aria-label={`Enable rule ${number}`}
        />
        <h4
          id={`behavior-rule-${rule.id}-heading`}
          className="text-sm font-semibold text-[var(--color-text)] flex-1"
        >
          Rule {number}: {rule.name || "Unnamed rule"}
        </h4>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Move rule ${number} up`}
          disabled={ruleIndex === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Move rule ${number} down`}
          disabled={ruleIndex === ruleCount - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Remove rule ${number}`}
          onClick={onRemove}
        >
          <Trash2 size={13} /> Remove rule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <TextInput
          id={`behavior-rule-${rule.id}-name`}
          label={`Rule ${number} name`}
          value={rule.name}
          onChange={(name) => onReplace({ ...rule, name })}
          error={ruleNameError ?? idError}
          variant="form-sm"
        />
        <FormField label="Session event">
          <Select
            label={`Rule ${number} event`}
            value={rule.event}
            onChange={(event) =>
              onReplace({
                ...rule,
                event: event as ConnectionBehaviorRuleV1["event"],
              })
            }
            options={EDITABLE_SESSION_EVENTS.map((option) => ({ ...option }))}
            variant="form-sm"
          />
        </FormField>
      </div>

      <fieldset className="rounded border border-[var(--color-border)] p-3">
        <legend className="px-1 text-xs font-medium text-[var(--color-textSecondary)]">
          Reasons (optional — none means every reason)
        </legend>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
          {BEHAVIOR_REASON_OPTIONS.map((reason) => (
            <label
              key={reason.value}
              className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
            >
              <Checkbox
                variant="form"
                checked={rule.when?.reasons?.includes(reason.value) ?? false}
                onChange={(checked) => toggleReason(reason.value, checked)}
                aria-label={`Rule ${number} reason ${reason.label}`}
              />
              {reason.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded border border-[var(--color-border)] p-3">
        <legend className="px-1 text-xs font-medium text-[var(--color-textSecondary)]">
          Rule execution
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
          <FormField label="Delay before actions (ms)">
            <NumberInput
              label={`Rule ${number} delay (ms)`}
              value={rule.options?.delayMs ?? 0}
              onChange={(delayMs) =>
                onReplace({
                  ...rule,
                  options: { ...rule.options, delayMs },
                })
              }
              min={0}
              max={86_400_000}
              variant="form-sm"
            />
          </FormField>
          <FormField label="Cooldown after execution (ms)">
            <NumberInput
              label={`Rule ${number} cooldown (ms)`}
              value={rule.options?.cooldownMs ?? 0}
              onChange={(cooldownMs) =>
                onReplace({
                  ...rule,
                  options: { ...rule.options, cooldownMs },
                })
              }
              min={0}
              max={86_400_000}
              variant="form-sm"
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <Checkbox
              variant="form"
              checked={rule.options?.oncePerSession ?? false}
              onChange={(oncePerSession) =>
                onReplace({
                  ...rule,
                  options: { ...rule.options, oncePerSession },
                })
              }
              aria-label={`Rule ${number} once per session`}
            />
            Run once per session
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <Checkbox
              variant="form"
              checked={rule.options?.stopOnActionError ?? false}
              onChange={(stopOnActionError) =>
                onReplace({
                  ...rule,
                  options: { ...rule.options, stopOnActionError },
                })
              }
              aria-label={`Rule ${number} stop on action error`}
            />
            Stop remaining actions after an error
          </label>
        </div>
      </fieldset>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-[var(--color-textSecondary)]">
            Ordered actions
          </h5>
          {actionsError && (
            <span role="alert" className="text-xs text-error">
              {actionsError}
            </span>
          )}
        </div>
        <ol className="space-y-2">
          {rule.actions.map((action, actionIndex) => (
            <ActionEditor
              key={`${rule.id}-action-${actionIndex}`}
              action={action}
              actionIndex={actionIndex}
              ruleIndex={ruleIndex}
              actionCount={rule.actions.length}
              scripts={scripts}
              issues={issues}
              onReplace={(replacement) =>
                replaceActions(
                  rule.actions.map((candidate, index) =>
                    index === actionIndex ? replacement : candidate,
                  ),
                )
              }
              onRemove={() =>
                replaceActions(
                  rule.actions.filter(
                    (_candidate, index) => index !== actionIndex,
                  ),
                )
              }
              onMove={(direction) =>
                replaceActions(
                  moveBehaviorItem(
                    rule.actions,
                    actionIndex,
                    actionIndex + direction,
                  ),
                )
              }
            />
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1">
            <Select
              label={`New action for rule ${number}`}
              value={newActionType}
              onChange={(value) =>
                setNewActionType(value as EditableBehaviorActionType)
              }
              options={EDITABLE_ACTION_TYPES.map((option) => ({ ...option }))}
              variant="form-sm"
            />
          </div>
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              replaceActions([
                ...rule.actions,
                createDefaultBehaviorAction(newActionType, scripts),
              ])
            }
          >
            <Plus size={13} /> Add action
          </button>
        </div>
      </div>
    </article>
  );
};

export interface BehaviorSectionProps {
  mgr: ConnectionEditorMgr;
  /** Optional injection keeps component tests deterministic and isolated. */
  scripts?: readonly CustomScript[];
}

export const BehaviorSection: React.FC<BehaviorSectionProps> = ({
  mgr,
  scripts: injectedScripts,
}) => {
  const scripts =
    injectedScripts ?? SettingsManager.getInstance().getCustomScripts();
  const isWindows =
    mgr.formData.osType === "windows" ||
    (!mgr.formData.osType &&
      (mgr.formData.protocol === "rdp" || mgr.formData.protocol === "winrm"));
  const inspection = useMemo(
    () => inspectBehaviorAutomationForEditor(mgr.formData.behaviorAutomation),
    [mgr.formData.behaviorAutomation],
  );
  const isBlocked =
    inspection.normalization.status === "unsupported-version" ||
    inspection.normalization.status === "invalid" ||
    inspection.unsupportedEditorItems.length > 0;
  const automation: ConnectionBehaviorAutomationV1 =
    inspection.editableConfig ?? EMPTY_AUTOMATION;
  const issues = useMemo(
    () =>
      isBlocked
        ? []
        : validateBehaviorAutomationForEditor(
            automation,
            scripts,
            mgr.formData.protocol,
          ),
    [automation, isBlocked, mgr.formData.protocol, scripts],
  );

  const updateField = <Key extends keyof typeof mgr.formData>(
    key: Key,
    value: (typeof mgr.formData)[Key],
  ) => {
    mgr.setFormData((previous) => ({ ...previous, [key]: value }));
  };

  const setRules = (rules: ConnectionBehaviorRuleV1[]) => {
    mgr.setFormData((previous) => ({
      ...previous,
      behaviorAutomation: { version: 1, rules },
    }));
  };

  const replaceRule = (ruleIndex: number, rule: ConnectionBehaviorRuleV1) =>
    setRules(
      automation.rules.map((candidate, index) =>
        index === ruleIndex ? rule : candidate,
      ),
    );

  return (
    <div className="space-y-4">
      <section
        data-editor-search-section="behavior-focus"
        className="space-y-3 border-t border-[var(--color-border)] pt-3"
        aria-labelledby="behavior-focus-heading"
      >
        <h3
          id="behavior-focus-heading"
          className="text-xs font-semibold text-[var(--color-textSecondary)] flex items-center gap-1.5"
        >
          <Zap size={12} /> Focus behavior
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div data-editor-search-field="focus-on-connect">
            <FormField label="On Connect">
              <Select
                label="On Connect"
                value={boolSelectValue(mgr.formData.focusOnConnect)}
                onChange={(value) =>
                  updateField("focusOnConnect", parseOptionalBool(value))
                }
                options={FOCUS_OPTIONS.map((option) => ({ ...option }))}
                variant="form"
              />
            </FormField>
          </div>
          {isWindows && (
            <div data-editor-search-field="focus-on-winmgmt-tool">
              <FormField label="On Windows Management Tool">
                <Select
                  label="On Windows Management Tool"
                  value={boolSelectValue(mgr.formData.focusOnWinmgmtTool)}
                  onChange={(value) =>
                    updateField("focusOnWinmgmtTool", parseOptionalBool(value))
                  }
                  options={FOCUS_OPTIONS.map((option) => ({ ...option }))}
                  variant="form"
                />
              </FormField>
            </div>
          )}
        </div>
      </section>

      <section
        data-editor-search-section="behavior-connection"
        className="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
        aria-labelledby="behavior-connection-heading"
      >
        <h3
          id="behavior-connection-heading"
          className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-1.5"
        >
          <RefreshCw size={14} /> Connection policy overrides
        </h3>
        <p className="text-xs text-[var(--color-textMuted)]">
          Leave numeric values empty or choose “Use global setting” to inherit
          application defaults.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div data-editor-search-field="retry-attempts">
            <OptionalNumberField
              id="behavior-retry-attempts"
              label="Retry attempts"
              value={mgr.formData.retryAttempts}
              onChange={(retryAttempts) =>
                updateField("retryAttempts", retryAttempts)
              }
              max={100}
              hint="0 disables automatic retries for this connection."
            />
          </div>
          <div data-editor-search-field="retry-delay">
            <OptionalNumberField
              id="behavior-retry-delay"
              label="Retry delay (ms)"
              value={mgr.formData.retryDelay}
              onChange={(retryDelay) => updateField("retryDelay", retryDelay)}
              max={86_400_000}
            />
          </div>
          <div data-editor-search-field="warn-on-close">
            <FormField label="Warn on close">
              <Select
                label="Warn on Close"
                value={boolSelectValue(mgr.formData.warnOnClose)}
                onChange={(value) =>
                  updateField("warnOnClose", parseOptionalBool(value))
                }
                options={WARN_OPTIONS.map((option) => ({ ...option }))}
                variant="form"
              />
            </FormField>
          </div>
          {isWindows && (
            <div data-editor-search-field="enable-winrm-tools">
              <FormField label="WinRM tools">
                <Select
                  label="WinRM Tools"
                  value={boolSelectValue(mgr.formData.enableWinrmTools)}
                  onChange={(value) =>
                    updateField("enableWinrmTools", parseOptionalBool(value))
                  }
                  options={TRI_STATE_OPTIONS.map((option) => ({ ...option }))}
                  variant="form"
                />
              </FormField>
            </div>
          )}
        </div>
      </section>

      <section
        data-editor-search-section="behavior-automation"
        className="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
        aria-labelledby="behavior-automation-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3
              id="behavior-automation-heading"
              className="text-sm font-semibold text-[var(--color-text)]"
            >
              Session automation
            </h3>
            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              Rules run in order. Actions inside each matching rule also run in
              order.
            </p>
          </div>
          {!isBlocked && (
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                setRules([
                  ...automation.rules,
                  createDefaultBehaviorRule(automation.rules),
                ])
              }
            >
              <Plus size={13} /> Add automation rule
            </button>
          )}
        </div>

        {isBlocked ? (
          <div
            role="alert"
            className="rounded border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
          >
            <p className="font-semibold">
              This automation cannot be safely edited in the version 1 editor.
            </p>
            <p className="mt-1">
              It will be preserved unchanged unless you explicitly replace it.
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              {inspection.normalization.issues.map((issue) => (
                <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>
              ))}
              {inspection.unsupportedEditorItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              type="button"
              className={`${buttonClass} mt-3`}
              onClick={() => setRules([])}
            >
              Replace with an empty version 1 automation
            </button>
          </div>
        ) : (
          <>
            {issues.length > 0 && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded border border-error/40 bg-error/10 p-3 text-xs text-error"
              >
                <p className="font-semibold">
                  Fix {issues.length} automation issue
                  {issues.length === 1 ? "" : "s"}.
                </p>
                <ul className="list-disc pl-5 mt-1">
                  {issues.map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {automation.rules.length === 0 ? (
              <div
                role="status"
                className="rounded border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-textMuted)]"
              >
                No automation rules. Add one to react to a session lifecycle
                event.
              </div>
            ) : (
              <div className="space-y-3">
                {automation.rules.map((rule, ruleIndex) => (
                  <RuleEditor
                    key={`${rule.id}-${ruleIndex}`}
                    rule={rule}
                    ruleIndex={ruleIndex}
                    ruleCount={automation.rules.length}
                    scripts={scripts}
                    issues={issues}
                    onReplace={(replacement) =>
                      replaceRule(ruleIndex, replacement)
                    }
                    onRemove={() =>
                      setRules(
                        automation.rules.filter(
                          (_candidate, index) => index !== ruleIndex,
                        ),
                      )
                    }
                    onMove={(direction) =>
                      setRules(
                        moveBehaviorItem(
                          automation.rules,
                          ruleIndex,
                          ruleIndex + direction,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
