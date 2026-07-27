import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IntegrationSessionLifecycleProvider,
  disconnectIntegrationSession,
  reconnectIntegrationSession,
} from "../integrations/IntegrationSessionLifecycle";
import { useNginx } from "./useNginx";
import { usePostfix } from "./mail/usePostfix";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function Probe({
  kind,
  report,
}: {
  kind: "nginx" | "postfix";
  report: (value: any) => void;
}) {
  const nginx = useNginx();
  const postfix = usePostfix();
  useEffect(
    () => report(kind === "nginx" ? nginx : postfix),
    [kind, nginx, postfix, report],
  );
  return null;
}

describe("provider lifecycle ownership", () => {
  beforeEach(() => invokeMock.mockReset());

  for (const [kind, connectCommand, disconnectCommand] of [
    ["nginx", "ngx_connect", "ngx_disconnect"],
    ["postfix", "postfix_connect", "postfix_disconnect"],
  ] as const) {
    it(`${kind} synchronizes header disconnect and failed reconnect`, async () => {
      let latest: any;
      let failures = false;
      invokeMock.mockImplementation((command: string) => {
        if (command === connectCommand && failures)
          return Promise.reject(new Error("offline"));
        if (command === connectCommand)
          return Promise.resolve({ host: "host" });
        return Promise.resolve();
      });
      render(
        <IntegrationSessionLifecycleProvider sessionId={`${kind}-session`}>
          <Probe
            kind={kind}
            report={(v) => {
              latest = v;
            }}
          />
        </IntegrationSessionLifecycleProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());
      await act(async () => {
        await latest.connect("id-1", { host: "host" });
      });
      expect(latest.connectionId).toBe("id-1");
      await act(async () => {
        await disconnectIntegrationSession(`${kind}-session`);
      });
      expect(latest.connectionId).toBeNull();
      expect(invokeMock).toHaveBeenCalledWith(disconnectCommand, {
        id: "id-1",
      });
      await act(async () => {
        await latest.connect("id-1", { host: "host" });
      });
      failures = true;
      await act(async () => {
        await expect(
          reconnectIntegrationSession(`${kind}-session`),
        ).rejects.toThrow("offline");
      });
      expect(latest.connectionId).toBeNull();
    });
  }
});
