import {
  CONNECTION_BEHAVIOR_AUTOMATION_VERSION,
  CONNECTION_BEHAVIOR_EVENT_REASONS,
  CONNECTION_BEHAVIOR_EVENT_TYPES,
  CONNECTION_BEHAVIOR_WINDOW_KINDS,
  type ConnectionBehaviorActionV1,
  type ConnectionBehaviorAutomationV1,
  type ConnectionBehaviorEventReason,
  type ConnectionBehaviorEventType,
  type ConnectionBehaviorRuleFiltersV1,
  type ConnectionBehaviorRuleOptionsV1,
  type ConnectionBehaviorRuleV1,
  type ConnectionBehaviorWindowKind,
} from "../../types/connection/behavior";

const MAX_RULE_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCRIPT_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_RECONNECT_ATTEMPTS = 100;
const MAX_TEXT_LENGTH = 4096;

const EVENT_TYPES = new Set<string>(CONNECTION_BEHAVIOR_EVENT_TYPES);
const EVENT_REASONS = new Set<string>(CONNECTION_BEHAVIOR_EVENT_REASONS);
const WINDOW_KINDS = new Set<string>(CONNECTION_BEHAVIOR_WINDOW_KINDS);

type UnknownRecord = Record<string, unknown>;

export interface ConnectionBehaviorValidationIssue {
  path: string;
  code:
    | "invalid-type"
    | "invalid-value"
    | "missing-value"
    | "unsupported-version"
    | "value-clamped";
  message: string;
}

export interface ConnectionBehaviorNormalizationResult {
  status: "absent" | "valid" | "invalid" | "unsupported-version";
  executable: boolean;
  config?: ConnectionBehaviorAutomationV1;
  issues: ConnectionBehaviorValidationIssue[];
  /** The untouched input, so callers can preserve future schemas verbatim. */
  raw: unknown;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issue = (
  issues: ConnectionBehaviorValidationIssue[],
  path: string,
  code: ConnectionBehaviorValidationIssue["code"],
  message: string,
) => {
  issues.push({ path, code, message });
};

const normalizedString = (
  value: unknown,
  fallback: string,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): string => {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, path, "missing-value", `Using fallback value "${fallback}".`);
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    issue(
      issues,
      path,
      "value-clamped",
      `Value was limited to ${MAX_TEXT_LENGTH} characters.`,
    );
    return trimmed.slice(0, MAX_TEXT_LENGTH);
  }
  return trimmed;
};

const optionalString = (
  value: unknown,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issue(issues, path, "invalid-type", "Expected a string.");
    return undefined;
  }
  if (value.length > MAX_TEXT_LENGTH) {
    issue(
      issues,
      path,
      "value-clamped",
      `Value was limited to ${MAX_TEXT_LENGTH} characters.`,
    );
    return value.slice(0, MAX_TEXT_LENGTH);
  }
  return value;
};

const optionalBoolean = (
  value: unknown,
  fallback: boolean,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    issue(issues, path, "invalid-type", `Using default value ${fallback}.`);
    return fallback;
  }
  return value;
};

const optionalInteger = (
  value: unknown,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
  max: number,
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issue(
      issues,
      path,
      "invalid-value",
      "Expected a finite non-negative number.",
    );
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized > max) {
    issue(issues, path, "value-clamped", `Value was limited to ${max}.`);
    return max;
  }
  return normalized;
};

const normalizeEnumArray = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): T[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issue(issues, path, "invalid-type", "Expected an array.");
    return undefined;
  }
  const result: T[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      issue(
        issues,
        `${path}[${index}]`,
        "invalid-value",
        "Unsupported filter value was ignored.",
      );
      continue;
    }
    if (!result.includes(entry as T)) result.push(entry as T);
  }
  return result.length > 0 ? result : undefined;
};

const normalizeAction = (
  value: unknown,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): ConnectionBehaviorActionV1 | undefined => {
  if (!isRecord(value) || typeof value.type !== "string") {
    issue(issues, path, "invalid-type", "Expected a typed action object.");
    return undefined;
  }

  switch (value.type) {
    case "notify": {
      const level = ["info", "warning", "error"].includes(String(value.level))
        ? (value.level as "info" | "warning" | "error")
        : "info";
      const sound = ["inherit", "on", "off"].includes(String(value.sound))
        ? (value.sound as "inherit" | "on" | "off")
        : "inherit";
      return {
        type: "notify",
        title: optionalString(value.title, `${path}.title`, issues),
        message: optionalString(value.message, `${path}.message`, issues),
        level,
        sound,
      };
    }
    case "focusSession":
      return {
        type: "focusSession",
        raiseWindow: optionalBoolean(
          value.raiseWindow,
          true,
          `${path}.raiseWindow`,
          issues,
        ),
        restoreIfMinimized: optionalBoolean(
          value.restoreIfMinimized,
          true,
          `${path}.restoreIfMinimized`,
          issues,
        ),
      };
    case "reconnect": {
      const backoff = value.backoff === "exponential" ? "exponential" : "fixed";
      return {
        type: "reconnect",
        delayMs: optionalInteger(
          value.delayMs,
          `${path}.delayMs`,
          issues,
          MAX_RULE_DELAY_MS,
        ),
        maxAttempts: optionalInteger(
          value.maxAttempts,
          `${path}.maxAttempts`,
          issues,
          MAX_RECONNECT_ATTEMPTS,
        ),
        backoff,
      };
    }
    case "closeTab":
      return { type: "closeTab", respectClosePolicy: true };
    case "runCustomScript": {
      if (typeof value.scriptId !== "string" || !value.scriptId.trim()) {
        issue(
          issues,
          `${path}.scriptId`,
          "missing-value",
          "A saved script ID is required.",
        );
        return undefined;
      }
      return {
        type: "runCustomScript",
        scriptId: normalizedString(
          value.scriptId,
          "",
          `${path}.scriptId`,
          issues,
        ),
        timeoutMs: optionalInteger(
          value.timeoutMs,
          `${path}.timeoutMs`,
          issues,
          MAX_SCRIPT_TIMEOUT_MS,
        ),
      };
    }
    case "writeLog": {
      const level = ["info", "warn", "error"].includes(String(value.level))
        ? (value.level as "info" | "warn" | "error")
        : "info";
      return {
        type: "writeLog",
        level,
        message: optionalString(value.message, `${path}.message`, issues),
      };
    }
    case "setOwningWindowState":
      if (
        !(["focused", "minimized", "restored"] as unknown[]).includes(
          value.state,
        )
      ) {
        issue(
          issues,
          `${path}.state`,
          "invalid-value",
          "Unsupported owning-window state.",
        );
        return undefined;
      }
      return {
        type: "setOwningWindowState",
        state: value.state as "focused" | "minimized" | "restored",
      };
    default:
      issue(
        issues,
        `${path}.type`,
        "invalid-value",
        `Unsupported action type "${value.type}" was ignored.`,
      );
      return undefined;
  }
};

const normalizeFilters = (
  value: unknown,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): ConnectionBehaviorRuleFiltersV1 | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, path, "invalid-type", "Expected a filter object.");
    return undefined;
  }
  const reasons = normalizeEnumArray<ConnectionBehaviorEventReason>(
    value.reasons,
    EVENT_REASONS,
    `${path}.reasons`,
    issues,
  );
  const windowKinds = normalizeEnumArray<ConnectionBehaviorWindowKind>(
    value.windowKinds,
    WINDOW_KINDS,
    `${path}.windowKinds`,
    issues,
  );
  return reasons || windowKinds ? { reasons, windowKinds } : undefined;
};

const normalizeOptions = (
  value: unknown,
  path: string,
  issues: ConnectionBehaviorValidationIssue[],
): ConnectionBehaviorRuleOptionsV1 | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, path, "invalid-type", "Expected an options object.");
    return undefined;
  }
  return {
    delayMs:
      optionalInteger(
        value.delayMs,
        `${path}.delayMs`,
        issues,
        MAX_RULE_DELAY_MS,
      ) ?? 0,
    cooldownMs:
      optionalInteger(
        value.cooldownMs,
        `${path}.cooldownMs`,
        issues,
        MAX_RULE_DELAY_MS,
      ) ?? 0,
    oncePerSession: optionalBoolean(
      value.oncePerSession,
      false,
      `${path}.oncePerSession`,
      issues,
    ),
    stopOnActionError: optionalBoolean(
      value.stopOnActionError,
      false,
      `${path}.stopOnActionError`,
      issues,
    ),
  };
};

const normalizeRule = (
  value: unknown,
  index: number,
  issues: ConnectionBehaviorValidationIssue[],
): ConnectionBehaviorRuleV1 | undefined => {
  const path = `rules[${index}]`;
  if (!isRecord(value)) {
    issue(issues, path, "invalid-type", "Expected a rule object.");
    return undefined;
  }
  if (typeof value.event !== "string" || !EVENT_TYPES.has(value.event)) {
    issue(issues, `${path}.event`, "invalid-value", "Unsupported event type.");
    return undefined;
  }
  if (!Array.isArray(value.actions)) {
    issue(
      issues,
      `${path}.actions`,
      "invalid-type",
      "Expected an action array.",
    );
    return undefined;
  }

  const actions = value.actions
    .map((action, actionIndex) =>
      normalizeAction(action, `${path}.actions[${actionIndex}]`, issues),
    )
    .filter((action): action is ConnectionBehaviorActionV1 => Boolean(action));

  const id = normalizedString(
    value.id,
    `rule-${index + 1}`,
    `${path}.id`,
    issues,
  );
  return {
    id,
    name: normalizedString(value.name, id, `${path}.name`, issues),
    enabled: optionalBoolean(value.enabled, true, `${path}.enabled`, issues),
    event: value.event as ConnectionBehaviorEventType,
    when: normalizeFilters(value.when, `${path}.when`, issues),
    actions,
    options: normalizeOptions(value.options, `${path}.options`, issues),
  };
};

export function normalizeConnectionBehavior(
  value: unknown,
): ConnectionBehaviorNormalizationResult {
  if (value === undefined || value === null) {
    return { status: "absent", executable: false, issues: [], raw: value };
  }
  if (!isRecord(value)) {
    return {
      status: "invalid",
      executable: false,
      issues: [
        {
          path: "behaviorAutomation",
          code: "invalid-type",
          message: "Expected a behavior automation object.",
        },
      ],
      raw: value,
    };
  }
  if (typeof value.version === "number" && value.version !== 1) {
    return {
      status: "unsupported-version",
      executable: false,
      issues: [
        {
          path: "version",
          code: "unsupported-version",
          message: `Behavior automation version ${value.version} is not supported.`,
        },
      ],
      raw: value,
    };
  }
  if (value.version !== CONNECTION_BEHAVIOR_AUTOMATION_VERSION) {
    return {
      status: "invalid",
      executable: false,
      issues: [
        {
          path: "version",
          code: "invalid-value",
          message: "Behavior automation version 1 is required.",
        },
      ],
      raw: value,
    };
  }
  if (!Array.isArray(value.rules)) {
    return {
      status: "invalid",
      executable: false,
      issues: [
        {
          path: "rules",
          code: "invalid-type",
          message: "Expected a rule array.",
        },
      ],
      raw: value,
    };
  }

  const issues: ConnectionBehaviorValidationIssue[] = [];
  const rules = value.rules
    .map((rule, index) => normalizeRule(rule, index, issues))
    .filter((rule): rule is ConnectionBehaviorRuleV1 => Boolean(rule));

  return {
    status: "valid",
    executable: true,
    config: { version: CONNECTION_BEHAVIOR_AUTOMATION_VERSION, rules },
    issues,
    raw: value,
  };
}
