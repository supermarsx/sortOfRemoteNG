import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import * as toolSessions from "../../src/components/app/toolSession";
import { activateNewToolTab } from "../../src/utils/session/activateNewToolTab";

const preferences = vi.hoisted(() => ({
  openConnectionEditorInBackground: false,
  openToolInBackground: false,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => preferences }) },
}));

// Execute the shipping App callbacks with their collaborators injected, without
// mounting the app's unrelated native startup, database and network effects.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function appCallback<T>(name: string, bindings: Record<string, unknown>): T {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!initializer) throw new Error(`Missing App callback ${name}`);
  const compiled = ts.transpileModule(
    `const subject = ${initializer.getText(source)};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
      },
    },
  );
  const scope = {
    ...toolSessions,
    activateNewToolTab,
    useCallback: (fn: unknown) => fn,
    ...bindings,
  };
  return new Function(
    ...Object.keys(scope),
    `${compiled.outputText}\nreturn subject;`,
  )(...Object.values(scope)) as T;
}

beforeEach(() => {
  preferences.openToolInBackground = false;
  preferences.openConnectionEditorInBackground = false;
});

describe("App tab opening focus", () => {
  it("reads live settings through the same retained toolbar setter and still focuses existing tabs", () => {
    const sessionsRef = { current: [] as ConnectionSession[] };
    const dispatch = vi.fn();
    const activate = vi.fn();
    const makeSetter = appCallback<(key: string) => (open: boolean) => void>(
      "makeToolSetter",
      {
        sessionsRef,
        dispatch,
        setActiveSessionId: activate,
        focusDetachedWindow: vi.fn(),
        wmRegistry: { current: {} },
      },
    );
    const setter = makeSetter("settings");
    preferences.openToolInBackground = true;
    setter(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    setter(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(sessionsRef.current[0].id);
    sessionsRef.current = [];
    activate.mockClear();
    preferences.openToolInBackground = false;
    setter(true);
    expect(activate).toHaveBeenCalledExactlyOnceWith(sessionsRef.current[0].id);
  });

  it.each([false, true])(
    "preserves the sync settings deep link for an existing tab (detached=%s)",
    (detached) => {
      preferences.openToolInBackground = true;
      const existing = toolSessions.createToolSession("settings");
      if (detached)
        existing.layout = {
          isDetached: true,
          windowId: "settings-window",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          zIndex: 1,
        };
      let request = { tab: undefined as string | undefined, nonce: 0 };
      const dispatch = vi.fn();
      const activate = vi.fn();
      const focusDetachedWindow = vi.fn();
      const open = appCallback<(tab: string) => void>("handleOpenSettings", {
        state: { sessions: [existing] },
        dispatch,
        setActiveSessionId: activate,
        focusDetachedWindow,
        setSettingsTabRequest: (
          update: (previous: typeof request) => typeof request,
        ) => {
          request = update(request);
        },
      });
      open("cloudSync");
      open("cloudSync");
      expect(request).toEqual({ tab: "cloudSync", nonce: 2 });
      expect(dispatch).not.toHaveBeenCalled();
      if (detached) {
        expect(focusDetachedWindow).toHaveBeenCalledWith("settings-window");
        expect(activate).not.toHaveBeenCalled();
      } else expect(activate).toHaveBeenCalledWith(existing.id);
    },
  );

  it.each([false, true])(
    "applies the preference only when creating Settings (background=%s)",
    (background) => {
      preferences.openToolInBackground = background;
      const activate = vi.fn();
      const dispatch = vi.fn();
      const open = appCallback<(tab: string) => void>("handleOpenSettings", {
        state: { sessions: [] },
        dispatch,
        setActiveSessionId: activate,
        focusDetachedWindow: vi.fn(),
        setSettingsTabRequest: vi.fn(),
        generateId: () => "new-settings",
      });
      open("cloudSync");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ADD_SESSION",
        payload: expect.objectContaining({
          id: "new-settings",
          protocol: "tool:settings",
        }),
      });
      expect(activate).toHaveBeenCalledTimes(background ? 0 : 1);
    },
  );
});
