import type {
  ConnectionBehaviorActionV1,
  ConnectionBehaviorEventContextInput,
  ConnectionBehaviorRuleV1,
  SafeConnectionBehaviorEventContext,
} from "../../types/connection/behavior";
import {
  normalizeConnectionBehavior,
  type ConnectionBehaviorNormalizationResult,
} from "./normalizeBehavior";
import {
  createSafeBehaviorEventContext,
  materializeBehaviorAction,
  sanitizeBehaviorText,
} from "./template";

export interface ConnectionBehaviorActionExecutionContext {
  event: SafeConnectionBehaviorEventContext;
  ruleId: string;
  ruleName: string;
  actionIndex: number;
  signal: AbortSignal;
}

export type ConnectionBehaviorActionHandlerMap = {
  [Type in ConnectionBehaviorActionV1["type"]]: (
    action: Extract<ConnectionBehaviorActionV1, { type: Type }>,
    context: ConnectionBehaviorActionExecutionContext,
  ) => void | Promise<void>;
};

export interface ConnectionBehaviorActionError {
  ruleId: string;
  actionIndex: number;
  actionType: ConnectionBehaviorActionV1["type"];
  message: string;
}

export interface ConnectionBehaviorRuleExecutionResult {
  ruleId: string;
  status: "completed" | "skipped" | "cancelled";
  reason?: "disabled" | "filter" | "cooldown" | "once" | "in-flight";
  executedActions: number;
  errors: ConnectionBehaviorActionError[];
}

export interface ConnectionBehaviorDispatchResult {
  status:
    | "completed"
    | "cancelled"
    | "duplicate"
    | "invalid-context"
    | "invalid-config"
    | "unsupported-version"
    | "no-config"
    | "recursion-blocked";
  matchedRules: number;
  executedActions: number;
  normalization: ConnectionBehaviorNormalizationResult;
  rules: ConnectionBehaviorRuleExecutionResult[];
  errors: ConnectionBehaviorActionError[];
}

export interface ConnectionBehaviorDispatcherDependencies {
  handlers?: Partial<ConnectionBehaviorActionHandlerMap>;
  now?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  maxRecursionDepth?: number;
  maxRememberedEvents?: number;
  onActionError?: (
    error: ConnectionBehaviorActionError,
    context: SafeConnectionBehaviorEventContext,
  ) => void;
}

export interface ConnectionBehaviorDispatchOptions {
  signal?: AbortSignal;
}

const createAbortError = () => {
  const error = new Error("Behavior dispatch was cancelled.");
  error.name = "AbortError";
  return error;
};

const abortableSleep = (
  delayMs: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return Promise.reject(createAbortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const matchesRule = (
  rule: ConnectionBehaviorRuleV1,
  context: SafeConnectionBehaviorEventContext,
): boolean => {
  if (rule.event !== context.type) return false;
  if (
    rule.when?.reasons?.length &&
    (!context.reason || !rule.when.reasons.includes(context.reason))
  ) {
    return false;
  }
  if (
    rule.when?.windowKinds?.length &&
    (!context.window || !rule.when.windowKinds.includes(context.window.kind))
  ) {
    return false;
  }
  return true;
};

export class ConnectionBehaviorDispatcher {
  private readonly handlers: Partial<ConnectionBehaviorActionHandlerMap>;
  private readonly now: () => number;
  private readonly sleep: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly maxRecursionDepth: number;
  private readonly maxRememberedEvents: number;
  private readonly onActionError?: ConnectionBehaviorDispatcherDependencies["onActionError"];
  private readonly activeEvents = new Map<string, AbortController>();
  private readonly activeEventDepths = new Map<string, number>();
  private readonly rememberedEventDepths = new Map<string, number>();
  private readonly sessionEvents = new Map<string, Set<string>>();
  private readonly seenEvents = new Set<string>();
  private readonly seenEventQueue: string[] = [];
  private readonly inFlightRules = new Set<string>();
  private readonly onceRules = new Set<string>();
  private readonly cooldownRules = new Map<string, number>();

  constructor(dependencies: ConnectionBehaviorDispatcherDependencies = {}) {
    this.handlers = dependencies.handlers ?? {};
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? abortableSleep;
    this.maxRecursionDepth = Math.max(1, dependencies.maxRecursionDepth ?? 4);
    this.maxRememberedEvents = Math.max(
      1,
      dependencies.maxRememberedEvents ?? 1000,
    );
    this.onActionError = dependencies.onActionError;
  }

  private rememberEvent(eventId: string, depth: number): void {
    this.seenEvents.add(eventId);
    this.rememberedEventDepths.set(eventId, depth);
    this.seenEventQueue.push(eventId);
    while (this.seenEventQueue.length > this.maxRememberedEvents) {
      const forgotten = this.seenEventQueue.shift();
      if (forgotten) {
        this.seenEvents.delete(forgotten);
        this.rememberedEventDepths.delete(forgotten);
      }
    }
  }

  private ruleScopeKey(
    rule: ConnectionBehaviorRuleV1,
    context: SafeConnectionBehaviorEventContext,
  ): string {
    return [
      context.connection.id,
      context.session?.id ?? "connection",
      rule.id,
    ].join("\u001f");
  }

  private eventResult(
    status: ConnectionBehaviorDispatchResult["status"],
    normalization: ConnectionBehaviorNormalizationResult,
  ): ConnectionBehaviorDispatchResult {
    return {
      status,
      matchedRules: 0,
      executedActions: 0,
      normalization,
      rules: [],
      errors: [],
    };
  }

  private registerSessionEvent(
    sessionId: string | undefined,
    eventId: string,
  ): void {
    if (!sessionId) return;
    const eventIds = this.sessionEvents.get(sessionId) ?? new Set<string>();
    eventIds.add(eventId);
    this.sessionEvents.set(sessionId, eventIds);
  }

  private unregisterSessionEvent(
    sessionId: string | undefined,
    eventId: string,
  ): void {
    if (!sessionId) return;
    const eventIds = this.sessionEvents.get(sessionId);
    eventIds?.delete(eventId);
    if (eventIds?.size === 0) this.sessionEvents.delete(sessionId);
  }

  async dispatch(
    configInput: unknown,
    contextInput: ConnectionBehaviorEventContextInput,
    options: ConnectionBehaviorDispatchOptions = {},
  ): Promise<ConnectionBehaviorDispatchResult> {
    const normalization = normalizeConnectionBehavior(configInput);
    if (normalization.status === "absent") {
      return this.eventResult("no-config", normalization);
    }
    if (normalization.status === "unsupported-version") {
      return this.eventResult("unsupported-version", normalization);
    }
    if (!normalization.executable || !normalization.config) {
      return this.eventResult("invalid-config", normalization);
    }

    const context = createSafeBehaviorEventContext(contextInput);
    if (!context.eventId || !context.connection.id) {
      return this.eventResult("invalid-context", normalization);
    }
    if (
      this.seenEvents.has(context.eventId) ||
      this.activeEvents.has(context.eventId)
    ) {
      return this.eventResult("duplicate", normalization);
    }

    const parentDepth = context.parentEventId
      ? (this.activeEventDepths.get(context.parentEventId) ??
        this.rememberedEventDepths.get(context.parentEventId) ??
        0)
      : 0;
    const depth = parentDepth + 1;
    if (depth > this.maxRecursionDepth) {
      return this.eventResult("recursion-blocked", normalization);
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else
      options.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });

    this.activeEvents.set(context.eventId, controller);
    this.activeEventDepths.set(context.eventId, depth);
    this.registerSessionEvent(context.session?.id, context.eventId);
    this.rememberEvent(context.eventId, depth);

    const result = this.eventResult("completed", normalization);
    try {
      for (const rule of normalization.config.rules) {
        if (controller.signal.aborted) {
          result.status = "cancelled";
          break;
        }
        if (rule.enabled === false) {
          result.rules.push({
            ruleId: rule.id,
            status: "skipped",
            reason: "disabled",
            executedActions: 0,
            errors: [],
          });
          continue;
        }
        if (!matchesRule(rule, context)) {
          result.rules.push({
            ruleId: rule.id,
            status: "skipped",
            reason: "filter",
            executedActions: 0,
            errors: [],
          });
          continue;
        }

        result.matchedRules += 1;
        const scopeKey = this.ruleScopeKey(rule, context);
        if (this.inFlightRules.has(scopeKey)) {
          result.rules.push({
            ruleId: rule.id,
            status: "skipped",
            reason: "in-flight",
            executedActions: 0,
            errors: [],
          });
          continue;
        }
        if (rule.options?.oncePerSession && this.onceRules.has(scopeKey)) {
          result.rules.push({
            ruleId: rule.id,
            status: "skipped",
            reason: "once",
            executedActions: 0,
            errors: [],
          });
          continue;
        }
        const cooldownUntil = this.cooldownRules.get(scopeKey) ?? 0;
        if ((rule.options?.cooldownMs ?? 0) > 0 && this.now() < cooldownUntil) {
          result.rules.push({
            ruleId: rule.id,
            status: "skipped",
            reason: "cooldown",
            executedActions: 0,
            errors: [],
          });
          continue;
        }

        const ruleResult: ConnectionBehaviorRuleExecutionResult = {
          ruleId: rule.id,
          status: "completed",
          executedActions: 0,
          errors: [],
        };
        result.rules.push(ruleResult);
        this.inFlightRules.add(scopeKey);
        try {
          await this.sleep(rule.options?.delayMs ?? 0, controller.signal);
          if (rule.options?.oncePerSession) this.onceRules.add(scopeKey);
          const cooldownMs = rule.options?.cooldownMs ?? 0;
          if (cooldownMs > 0) {
            this.cooldownRules.set(scopeKey, this.now() + cooldownMs);
          }

          for (const [actionIndex, rawAction] of rule.actions.entries()) {
            if (controller.signal.aborted) throw createAbortError();
            const action = materializeBehaviorAction(rawAction, context);
            const handler = this.handlers[action.type] as
              | ((
                  action: ConnectionBehaviorActionV1,
                  execution: ConnectionBehaviorActionExecutionContext,
                ) => void | Promise<void>)
              | undefined;
            try {
              if (!handler) {
                throw new Error(
                  `No handler is registered for behavior action "${action.type}".`,
                );
              }
              await handler(action, {
                event: context,
                ruleId: rule.id,
                ruleName: rule.name,
                actionIndex,
                signal: controller.signal,
              });
              ruleResult.executedActions += 1;
              result.executedActions += 1;
            } catch (error) {
              if (isAbortError(error) || controller.signal.aborted) throw error;
              const actionError: ConnectionBehaviorActionError = {
                ruleId: rule.id,
                actionIndex,
                actionType: action.type,
                message: sanitizeBehaviorText(
                  error instanceof Error
                    ? error.message
                    : "Unknown action error",
                ),
              };
              ruleResult.errors.push(actionError);
              result.errors.push(actionError);
              try {
                this.onActionError?.(actionError, context);
              } catch {
                // An observer must never change behavior execution semantics.
              }
              if (rule.options?.stopOnActionError) break;
            }
          }
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) {
            ruleResult.status = "cancelled";
            result.status = "cancelled";
            break;
          }
          throw error;
        } finally {
          this.inFlightRules.delete(scopeKey);
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      this.activeEvents.delete(context.eventId);
      this.activeEventDepths.delete(context.eventId);
      this.unregisterSessionEvent(context.session?.id, context.eventId);
    }
    return result;
  }

  cancelEvent(eventId: string): boolean {
    const controller = this.activeEvents.get(eventId);
    controller?.abort();
    return Boolean(controller);
  }

  cancelSession(sessionId: string, clearRuleState = true): number {
    const eventIds = [...(this.sessionEvents.get(sessionId) ?? [])];
    for (const eventId of eventIds) this.activeEvents.get(eventId)?.abort();
    if (clearRuleState) {
      const marker = `\u001f${sessionId}\u001f`;
      for (const key of this.onceRules) {
        if (key.includes(marker)) this.onceRules.delete(key);
      }
      for (const key of this.cooldownRules.keys()) {
        if (key.includes(marker)) this.cooldownRules.delete(key);
      }
    }
    return eventIds.length;
  }

  cancelAll(): number {
    const count = this.activeEvents.size;
    for (const controller of this.activeEvents.values()) controller.abort();
    return count;
  }
}
