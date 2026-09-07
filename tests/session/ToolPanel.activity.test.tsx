import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import { SessionRenderActivityProvider } from "../../src/components/session/SessionRenderActivity";
import { createToolSession } from "../../src/components/app/toolSession";

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { sessions: [], connections: [] } }),
}));
vi.mock("../../src/components/session/sessionManager/SessionManager", () => ({
  SessionManager: ({ isVisible }: { isVisible: boolean }) => {
    const [count, setCount] = useState(0);
    return (
      <button
        data-testid="manager"
        data-visible={String(isVisible)}
        onClick={() => setCount(count + 1)}
      >
        {count}
      </button>
    );
  },
}));

describe("tool tab background activity", () => {
  it.each(["rdpSessions", "internalProxy"] as const)(
    "propagates visibility to %s without resetting manager state",
    async (tool) => {
      const session = createToolSession(tool);
      const view = (active: boolean) => (
        <SessionRenderActivityProvider isActive={active}>
          <ToolTabViewer session={session} onClose={vi.fn()} />
        </SessionRenderActivityProvider>
      );
      const { rerender } = render(view(true));
      const manager = await screen.findByTestId("manager");
      fireEvent.click(manager);
      expect(manager).toHaveTextContent("1");
      rerender(view(false));
      expect(manager).toHaveAttribute("data-visible", "false");
      expect(manager).toHaveTextContent("1");
      rerender(view(true));
      expect(manager).toHaveAttribute("data-visible", "true");
      expect(manager).toHaveTextContent("1");
    },
  );
});
