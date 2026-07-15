import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorAutomationV1,
  ConnectionBehaviorEventReason,
  ConnectionBehaviorEventType,
  ConnectionBehaviorRuleV1,
} from "../../../types/connection/behavior";
import type { CustomScript } from "../../../types/settings/settings";
import {
  normalizeConnectionBehavior,
  type ConnectionBehaviorNormalizationResult,
} from "../../../utils/behavior/normalizeBehavior";

export const EDITABLE_SESSION_EVENTS = [
  { value: "session.started", label: "Session started" },
  { value: "session.connected", label: "Session connected" },
  { value: "session.connectFailed", label: "Initial connection failed" },
  { value: "session.reconnectStarted", label: "Reconnect started" },
  { value: "session.reconnected", label: "Session reconnected" },
  { value: "session.reconnectFailed", label: "Reconnect failed" },
  { value: "session.disconnected", label: "Remote session disconnected" },
  { value: "session.ended", label: "Session ended" },
  { value: "window.focused", label: "Window focused" },
  { value: "window.blurred", label: "Window blurred" },
  { value: "window.minimized", label: "Window minimized" },
  { value: "window.restored", label: "Window restored" },
  { value: "window.closeRequested", label: "Window close requested" },
  { value: "window.closed", label: "Window closed" },
] as const satisfies ReadonlyArray<{
  value: ConnectionBehaviorEventType;
  label: string;
}>;

export const EDITABLE_ACTION_TYPES = [
  { value: "notify", label: "Show notification" },
  { value: "writeLog", label: "Write action log" },
  { value: "reconnect", label: "Reconnect session" },
  { value: "runCustomScript", label: "Run saved script" },
  { value: "focusSession", label: "Focus session and owning window" },
  { value: "closeTab", label: "Close session tab" },
  { value: "setOwningWindowState", label: "Set owning window state" },
] as const;

export type EditableBehaviorActionType =
  (typeof EDITABLE_ACTION_TYPES)[number]["value"];

export const BEHAVIOR_REASON_OPTIONS = [
  { value: "user", label: "User action" },
  { value: "remote", label: "Remote side" },
  { value: "network", label: "Network" },
  { value: "error", label: "Error" },
  { value: "appExit", label: "Application exit" },
  { value: "windowClose", label: "Window close" },
  { value: "restore", label: "Session restore" },
  { value: "unknown", label: "Unknown" },
] as const satisfies ReadonlyArray<{
  value: ConnectionBehaviorEventReason;
  label: string;
}>;

const EDITABLE_EVENT_SET = new Set<string>(
  EDITABLE_SESSION_EVENTS.map((event) => event.value),
);
const EDITABLE_ACTION_SET = new Set<string>(
  EDITABLE_ACTION_TYPES.map((action) => action.value),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createStableBehaviorRuleId(
  rules: readonly Pick<ConnectionBehaviorRuleV1, "id">[],
): string {
  const occupied = new Set(rules.map((rule) => rule.id));
  let index = 1;
  while (occupied.has(`behavior-rule-${index}`)) index += 1;
  return `behavior-rule-${index}`;
}

export function createDefaultBehaviorAction(
  type: EditableBehaviorActionType,
  scripts: readonly CustomScript[] = [],
): ConnectionBehaviorActionV1 {
  switch (type) {
    case "notify":
      return {
        type,
        title: "{{connection.name}}",
        message: "{{event.type}}",
        level: "info",
        sound: "inherit",
      };
    case "writeLog":
      return {
        type,
        level: "info",
        message: "{{event.type}} for {{connection.name}}",
      };
    case "reconnect":
      return { type, delayMs: 0, maxAttempts: 1, backoff: "fixed" };
    case "runCustomScript":
      return {
        type,
        scriptId: scripts.find((script) => script.enabled)?.id ?? "",
        timeoutMs: 30_000,
      };
    case "focusSession":
      return { type, raiseWindow: true, restoreIfMinimized: true };
    case "closeTab":
      return { type, respectClosePolicy: true };
    case "setOwningWindowState":
      return { type, state: "focused" };
  }
}

export function createDefaultBehaviorRule(
  rules: readonly ConnectionBehaviorRuleV1[],
): ConnectionBehaviorRuleV1 {
  const id = createStableBehaviorRuleId(rules);
  return {
    id,
    name: "New automation rule",
    enabled: true,
    event: "session.started",
    actions: [createDefaultBehaviorAction("writeLog")],
    options: {
      delayMs: 0,
      cooldownMs: 0,
      oncePerSession: false,
      stopOnActionError: false,
    },
  };
}

export function moveBehaviorItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function parseOptionalNonNegativeInteger(
  value: string,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(0, Math.floor(parsed)), max);
}

export interface BehaviorEditorInspection {
  normalization: ConnectionBehaviorNormalizationResult;
  unsupportedEditorItems: string[];
  editableConfig?: ConnectionBehaviorAutomationV1;
}

export function inspectBehaviorAutomationForEditor(
  value: unknown,
): BehaviorEditorInspection {
  const normalization = normalizeConnectionBehavior(value);
  const unsupportedEditorItems: string[] = [];

  if (isRecord(value) && Array.isArray(value.rules)) {
    value.rules.forEach((rawRule, ruleIndex) => {
      if (!isRecord(rawRule)) return;
      if (
        typeof rawRule.event === "string" &&
        !EDITABLE_EVENT_SET.has(rawRule.event)
      ) {
        unsupportedEditorItems.push(
          `Rule ${ruleIndex + 1} uses event "${rawRule.event}".`,
        );
      }
      if (!Array.isArray(rawRule.actions)) return;
      rawRule.actions.forEach((rawAction, actionIndex) => {
        if (
          isRecord(rawAction) &&
          typeof rawAction.type === "string" &&
          !EDITABLE_ACTION_SET.has(rawAction.type)
        ) {
          unsupportedEditorItems.push(
            `Rule ${ruleIndex + 1}, action ${actionIndex + 1} uses "${rawAction.type}".`,
          );
        }
      });
    });
  }

  return {
    normalization,
    unsupportedEditorItems,
    editableConfig:
      normalization.status === "valid" && unsupportedEditorItems.length === 0
        ? normalization.config
        : undefined,
  };
}

export interface BehaviorEditorValidationIssue {
  path: string;
  message: string;
}

export function validateBehaviorAutomationForEditor(
  config: ConnectionBehaviorAutomationV1,
  scripts: readonly CustomScript[],
  protocol?: string,
): BehaviorEditorValidationIssue[] {
  const issues: BehaviorEditorValidationIssue[] = normalizeConnectionBehavior(
    config,
  ).issues.map((issue) => ({ path: issue.path, message: issue.message }));
  const seenIds = new Set<string>();

  config.rules.forEach((rule, ruleIndex) => {
    const rulePath = `rules[${ruleIndex}]`;
    if (!rule.name.trim()) {
      issues.push({ path: `${rulePath}.name`, message: "Enter a rule name." });
    }
    if (seenIds.has(rule.id)) {
      issues.push({
        path: `${rulePath}.id`,
        message: "Rule IDs must be unique.",
      });
    }
    seenIds.add(rule.id);
    if (rule.actions.length === 0) {
      issues.push({
        path: `${rulePath}.actions`,
        message: "Add at least one action.",
      });
    }

    rule.actions.forEach((action, actionIndex) => {
      if (action.type !== "runCustomScript") return;
      const path = `${rulePath}.actions[${actionIndex}].scriptId`;
      const script = scripts.find(
        (candidate) => candidate.id === action.scriptId,
      );
      if (!script) {
        issues.push({ path, message: "Select an available saved script." });
      } else if (!script.enabled) {
        issues.push({
          path,
          message: `Saved script "${script.name}" is disabled.`,
        });
      } else if (script.protocol && protocol && script.protocol !== protocol) {
        issues.push({
          path,
          message: `Saved script "${script.name}" only applies to ${script.protocol}.`,
        });
      }
    });
  });

  return issues;
}
