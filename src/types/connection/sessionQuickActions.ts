import type { AutomationScope } from "../recording/automationLibrary";

export interface QuickActionReference {
  kind: "script" | "macro";
  id: string;
  /** Omitted legacy references always mean app-wide, never a database fallback. */
  scope?: AutomationScope;
}

export interface SshQuickActionsConfig {
  version: 1;
  items: QuickActionReference[];
}

export interface HttpAutomationConfig extends SshQuickActionsConfig {
  interactionMacrosEnabled: boolean;
  scriptInjectionEnabled: boolean;
  forceDark: boolean;
  darkMode?: import("./websiteDarkMode").WebsiteDarkModeConfig;
}

/** Global availability does not grant consent to run code on a website. */
export interface SessionQuickActionsSettings {
  sshEnabled: boolean;
  httpEnabled: boolean;
  allowWebMacros: boolean;
  allowWebScriptInjection: boolean;
  allowWebForceDark: boolean;
  confirmBeforeScriptRun: boolean;
}

export const DEFAULT_SESSION_QUICK_ACTIONS: Readonly<SessionQuickActionsSettings> =
  Object.freeze({
    sshEnabled: true,
    httpEnabled: true,
    allowWebMacros: true,
    allowWebScriptInjection: true,
    allowWebForceDark: true,
    confirmBeforeScriptRun: true,
  });
