import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import type { Connection } from "../../../types/connection/connection";
import type { CustomScript } from "../../../types/settings/settings";
import { BehaviorSection } from "./BehaviorSection";
import {
  createStableBehaviorRuleId,
  moveBehaviorItem,
  parseOptionalNonNegativeInteger,
} from "./behaviorEditor";

const makeScript = (overrides: Partial<CustomScript> = {}): CustomScript => ({
  id: "script-health",
  name: "Health check",
  type: "javascript",
  content: "return true",
  trigger: "manual",
  enabled: true,
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
  ...overrides,
});

interface HarnessProps {
  initial?: Partial<Connection>;
  scripts?: readonly CustomScript[];
  onChange?: (value: Partial<Connection>) => void;
}

const Harness: React.FC<HarnessProps> = ({
  initial = {},
  scripts = [],
  onChange,
}) => {
  const [formData, setFormData] = useState<Partial<Connection>>({
    id: "connection-1",
    name: "Production",
    protocol: "rdp",
    hostname: "prod.example.test",
    isGroup: false,
    ...initial,
  });

  useEffect(() => {
    onChange?.(formData);
  }, [formData, onChange]);

  return (
    <BehaviorSection
      mgr={{ formData, setFormData } as ConnectionEditorMgr}
      scripts={scripts}
    />
  );
};

const choose = (label: string, option: RegExp | string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("behavior editor helpers", () => {
  it("creates deterministic unused IDs and preserves item ordering", () => {
    expect(
      createStableBehaviorRuleId([
        { id: "behavior-rule-1" },
        { id: "custom" },
        { id: "behavior-rule-3" },
      ]),
    ).toBe("behavior-rule-2");
    expect(moveBehaviorItem(["first", "second", "third"], 2, 0)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("preserves explicit zero while treating an empty override as inherited", () => {
    expect(parseOptionalNonNegativeInteger("")).toBeUndefined();
    expect(parseOptionalNonNegativeInteger("0")).toBe(0);
    expect(parseOptionalNonNegativeInteger("4.9")).toBe(4);
    expect(parseOptionalNonNegativeInteger("999", 100)).toBe(100);
  });
});

describe("BehaviorSection", () => {
  it("edits focus and connection policy tri-state overrides, including zero retries", async () => {
    let latest: Partial<Connection> = {};
    render(<Harness onChange={(value) => (latest = value)} />);

    choose("On Connect", "Open in background");
    choose("On Windows Management Tool", "Focus tab");
    fireEvent.change(screen.getByLabelText("Retry attempts"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Retry delay (ms)"), {
      target: { value: "2500" },
    });
    choose("Warn on Close", "Close without warning");
    choose("WinRM Tools", "Enabled");

    await waitFor(() => {
      expect(latest).toMatchObject({
        focusOnConnect: false,
        focusOnWinmgmtTool: true,
        retryAttempts: 0,
        retryDelay: 2500,
        warnOnClose: false,
        enableWinrmTools: true,
      });
    });

    fireEvent.change(screen.getByLabelText("Retry attempts"), {
      target: { value: "" },
    });
    choose("Warn on Close", "Use global setting");
    await waitFor(() => {
      expect(latest.retryAttempts).toBeUndefined();
      expect(latest.warnOnClose).toBeUndefined();
    });
  });

  it("hides Windows-only policy controls for a non-Windows connection", () => {
    render(
      <Harness initial={{ protocol: "ssh", osType: "linux", port: 22 }} />,
    );

    expect(
      screen.queryByRole("combobox", {
        name: "On Windows Management Tool",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "WinRM Tools" }),
    ).not.toBeInTheDocument();
  });

  it("builds, orders, and configures only runtime-backed session automation", async () => {
    let latest: Partial<Connection> = {};
    const scripts = [makeScript()];
    render(
      <Harness scripts={scripts} onChange={(value) => (latest = value)} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add automation rule" }),
    );
    expect(
      screen.getByTestId("behavior-rule-behavior-rule-1"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rule 1 name"), {
      target: { value: "Recover remote drops" },
    });
    choose("Rule 1 event", "Remote session disconnected");
    fireEvent.click(screen.getByLabelText("Rule 1 reason Remote side"));
    fireEvent.change(screen.getByLabelText("Rule 1 delay (ms)"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Rule 1 cooldown (ms)"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByLabelText("Rule 1 once per session"));
    fireEvent.click(screen.getByLabelText("Rule 1 stop on action error"));

    choose("New action for rule 1", "Show notification");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    fireEvent.change(screen.getByLabelText("Action 2 notification title"), {
      target: { value: "Connection dropped" },
    });

    choose("New action for rule 1", "Reconnect session");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    fireEvent.change(screen.getByLabelText("Action 3 reconnect delay (ms)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Action 3 maximum attempts"), {
      target: { value: "0" },
    });
    choose("Action 3 reconnect backoff", "Exponential delay");

    choose("New action for rule 1", "Run saved script");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(
      screen.getByRole("combobox", { name: "Action 4 saved script" }),
    ).toHaveTextContent("Health check");
    fireEvent.change(screen.getByLabelText("Action 4 script timeout (ms)"), {
      target: { value: "7500" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Move action 4 up" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add automation rule" }),
    );
    expect(
      screen.getByTestId("behavior-rule-behavior-rule-2"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));

    await waitFor(() => {
      const rules = latest.behaviorAutomation?.rules;
      expect(rules?.map((rule) => rule.id)).toEqual([
        "behavior-rule-2",
        "behavior-rule-1",
      ]);
      expect(rules?.[1]).toMatchObject({
        name: "Recover remote drops",
        enabled: true,
        event: "session.disconnected",
        when: { reasons: ["remote"] },
        options: {
          delayMs: 25,
          cooldownMs: 500,
          oncePerSession: true,
          stopOnActionError: true,
        },
      });
      expect(rules?.[1].actions.map((action) => action.type)).toEqual([
        "writeLog",
        "notify",
        "runCustomScript",
        "reconnect",
      ]);
      expect(rules?.[1].actions[2]).toMatchObject({
        type: "runCustomScript",
        scriptId: "script-health",
        timeoutMs: 7500,
      });
      expect(rules?.[1].actions[3]).toMatchObject({
        type: "reconnect",
        delayMs: 0,
        maxAttempts: 0,
        backoff: "exponential",
      });
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Rule 1 event" }));
    expect(
      screen.queryByRole("option", { name: /window focused/i }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 1 event" }), {
      key: "Escape",
    });
    fireEvent.click(
      screen.getByRole("combobox", { name: "New action for rule 1" }),
    );
    expect(
      screen.queryByRole("option", { name: /focus session/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /close tab/i }),
    ).not.toBeInTheDocument();
  });

  it("shows actionable validation for an unavailable or protocol-mismatched script", async () => {
    const scripts = [
      makeScript({
        id: "rdp-only",
        name: "RDP only",
        protocol: "rdp",
      }),
    ];
    render(
      <Harness initial={{ protocol: "ssh", port: 22 }} scripts={scripts} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add automation rule" }),
    );
    choose("New action for rule 1", "Run saved script");
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));

    expect(
      await screen.findAllByText(
        'Saved script "RDP only" only applies to rdp.',
      ),
    ).toHaveLength(2);
    expect(screen.getByText(/Fix 1 automation issue/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove action 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove action 1" }));
    expect(await screen.findAllByText("Add at least one action.")).toHaveLength(
      2,
    );
  });

  it("preserves unsupported future automation until replacement is explicit", async () => {
    const futureAutomation = {
      version: 2,
      rules: [{ id: "future-rule", opaque: { keep: true } }],
    };
    let latest: Partial<Connection> = {};
    render(
      <Harness
        initial={{ behaviorAutomation: futureAutomation as never }}
        onChange={(value) => (latest = value)}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "version 2 is not supported",
    );
    expect(
      screen.queryByRole("button", { name: "Add automation rule" }),
    ).not.toBeInTheDocument();

    choose("On Connect", "Open in background");
    await waitFor(() => {
      expect(latest.behaviorAutomation).toEqual(futureAutomation);
      expect(latest.focusOnConnect).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace with an empty version 1 automation",
      }),
    );
    await waitFor(() => {
      expect(latest.behaviorAutomation).toEqual({ version: 1, rules: [] });
    });
  });

  it("keeps deferred version-1 actions read-only instead of exposing an unwired editor", () => {
    render(
      <Harness
        initial={{
          behaviorAutomation: {
            version: 1,
            rules: [
              {
                id: "future-runtime",
                name: "Focus later",
                event: "session.connected",
                actions: [{ type: "focusSession" }],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      'action 1 uses "focusSession"',
    );
    expect(
      screen.queryByRole("combobox", { name: "Action 1 type" }),
    ).not.toBeInTheDocument();
  });
});
