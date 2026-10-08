import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { CredentialEditorRequest } from "../../src/types/security/credentialEditor";
const h = vi.hoisted(() => ({
  sessions: [] as ConnectionSession[],
  dispatch: vi.fn(),
  status: "ready",
  databaseId: "db-a",
  generation: 1,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: h.sessions },
    dispatch: h.dispatch,
    databaseAvailability: { status: h.status, databaseId: h.databaseId },
    credentialVault: {
      scope: { databaseId: h.databaseId, generation: h.generation },
    },
  }),
}));
import { createCredentialEditorSession } from "../../src/components/app/toolSession";
import { useCredentialEditorSession } from "../../src/hooks/security/useCredentialEditorSession";
import { useSecurityToolSession } from "../../src/hooks/security/useSecurityToolSession";
const edit: CredentialEditorRequest = {
  scope: { databaseId: "db-a", generation: 1 },
  mode: "edit",
  credentialId: "entry-a",
};
afterEach(() => {
  cleanup();
  h.sessions = [];
  h.dispatch.mockClear();
  h.status = "ready";
  h.databaseId = "db-a";
  h.generation = 1;
});
describe("private credential editor tabs", () => {
  it("whitelists navigation metadata and snapshots the scope without secrets", () => {
    const request = {
      ...edit,
      scope: { ...edit.scope },
      password: "not-for-session",
    };
    const tab = createCredentialEditorSession(request);
    request.scope.databaseId = "changed";
    expect(tab.credentialEditor).toEqual(edit);
    expect(tab.ownerDatabaseId).toBe("db-a");
    expect(JSON.stringify(tab)).not.toContain("not-for-session");
    expect(tab.name).toBe("Edit credential");
  });
  it("deduplicates rapid opens without overwriting private drafts", () => {
    const activate = vi.fn();
    const { result } = renderHook(() => useCredentialEditorSession(activate));
    act(() => {
      result.current(edit);
      result.current(edit);
    });
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate.mock.calls[0]).toEqual(activate.mock.calls[1]);
  });
  it.each(["create", "migrate"] as const)(
    "separates %s from edit tabs",
    (mode) => {
      h.sessions = [createCredentialEditorSession(edit)];
      const { result } = renderHook(() => useCredentialEditorSession(vi.fn()));
      act(() =>
        result.current(
          mode === "create"
            ? { scope: edit.scope, mode }
            : { scope: edit.scope, mode, connectionId: "entry-a" },
        ),
      );
      expect(h.dispatch).toHaveBeenCalledOnce();
      expect(h.dispatch.mock.calls[0][0].payload.id).not.toBe(h.sessions[0].id);
    },
  );
  it.each(["locked", "different-database", "different-generation", "detached"])(
    "rejects %s requests",
    (kind) => {
      if (kind === "locked") h.status = "suspended";
      if (kind === "different-database") h.databaseId = "db-b";
      if (kind === "different-generation") h.generation = 2;
      const source =
        kind === "detached"
          ? ({
              ...createCredentialEditorSession(edit),
              layout: { isDetached: true, windowId: "other" },
            } as ConnectionSession)
          : undefined;
      const activate = vi.fn();
      const { result } = renderHook(() =>
        useCredentialEditorSession(activate, source),
      );
      act(() => result.current(edit));
      expect(h.dispatch).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    },
  );
  it("opens the vault list separately from an existing editor", () => {
    h.sessions = [createCredentialEditorSession(edit)];
    const activate = vi.fn();
    const { result } = renderHook(() =>
      useSecurityToolSession("credentialVault", activate),
    );
    act(() => result.current());
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(
      h.dispatch.mock.calls[0][0].payload.credentialEditor,
    ).toBeUndefined();
    expect(activate).not.toHaveBeenCalledWith(h.sessions[0].id);
  });
});
