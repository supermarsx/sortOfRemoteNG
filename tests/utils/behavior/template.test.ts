import { describe, expect, it } from "vitest";
import type { ConnectionBehaviorEventContextInput } from "../../../src/types/connection/behavior";
import {
  createSafeBehaviorEventContext,
  materializeBehaviorAction,
  renderBehaviorTemplate,
  sanitizeBehaviorText,
} from "../../../src/utils/behavior/template";

const eventContext = (
  overrides: Partial<ConnectionBehaviorEventContextInput> = {},
): ConnectionBehaviorEventContextInput => ({
  eventId: "event-1",
  type: "session.connectFailed",
  timestamp: 123,
  source: "session-manager",
  reason: "error",
  connection: {
    id: "connection-1",
    name: "Production",
    protocol: "ssh",
    hostname: "host.example.test",
    port: 22,
  },
  session: { id: "session-1", name: "Shell", status: "error" },
  window: { id: "main", kind: "main", activeSessionId: "session-1" },
  error: { message: "Connection refused", code: "ECONNREFUSED" },
  ...overrides,
});

describe("behavior template safety", () => {
  it("rebuilds an allowlisted context and drops credential-shaped extra fields", () => {
    const unsafe = eventContext() as ConnectionBehaviorEventContextInput & {
      password: string;
      connection: ConnectionBehaviorEventContextInput["connection"] & {
        password: string;
        apiKey: string;
      };
    };
    unsafe.password = "top-level-secret";
    unsafe.connection.password = "connection-secret";
    unsafe.connection.apiKey = "api-secret";

    const safe = createSafeBehaviorEventContext(unsafe);

    expect(safe).not.toHaveProperty("password");
    expect(safe.connection).not.toHaveProperty("password");
    expect(safe.connection).not.toHaveProperty("apiKey");
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen(safe.connection)).toBe(true);
  });

  it("redacts common credential patterns from context and rendered output", () => {
    const unsafe = eventContext({
      connection: {
        id: "connection-1",
        name: "token=super-secret",
        protocol: "https",
        hostname: "https://alice:hunter2@example.test",
      },
      error: {
        message:
          "Authorization: Bearer abc.def password=hunter2 url=https://x.test/?api_key=12345",
      },
    });
    const safe = createSafeBehaviorEventContext(unsafe);
    const rendered = renderBehaviorTemplate(
      "{{connection.name}} {{connection.hostname}} {{error.message}}",
      safe,
    );

    expect(rendered).not.toContain("super-secret");
    expect(rendered).not.toContain("hunter2");
    expect(rendered).not.toContain("abc.def");
    expect(rendered).not.toContain("12345");
    expect(rendered).toContain("[redacted]");
  });

  it("supports only the documented placeholder vocabulary", () => {
    const safe = createSafeBehaviorEventContext(eventContext());
    expect(
      renderBehaviorTemplate(
        "{{connection.name}}/{{session.id}}/{{event.type}}/{{credentials.password}}",
        safe,
      ),
    ).toBe("Production/session-1/session.connectFailed/");
  });

  it("materializes user-visible notify and log strings before handler dispatch", () => {
    const safe = createSafeBehaviorEventContext(eventContext());
    expect(
      materializeBehaviorAction(
        {
          type: "notify",
          title: "{{connection.name}} failed",
          message: "{{error.message}}",
        },
        safe,
      ),
    ).toMatchObject({
      title: "Production failed",
      message: "Connection refused",
    });
    expect(
      materializeBehaviorAction(
        { type: "writeLog", message: "{{session.name}}: {{event.reason}}" },
        safe,
      ),
    ).toMatchObject({ message: "Shell: error" });
  });

  it("redacts private keys, authorization schemes, and URL credentials", () => {
    const value = [
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
      "Basic Zm9vOmJhcg==",
      "ssh://user:pass@example.test",
    ].join(" ");
    const safe = sanitizeBehaviorText(value);

    expect(safe).not.toContain("secret");
    expect(safe).not.toContain("Zm9vOmJhcg==");
    expect(safe).not.toContain("user:pass");
    expect(safe).toContain("[redacted private key]");
  });
});
