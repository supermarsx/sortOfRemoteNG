import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultInteractiveSignIn from "../../src/components/security/VaultInteractiveSignIn";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseCredentialFacets } from "../../src/types/security/databaseCredentialVault";
const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  getInvoke: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../../src/hooks/security/useRuntimeCredentialVault", () => ({
  useRuntimeCredentialVault: () => h.resolve,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: h.getInvoke }));
const connection = {
  id: "saved",
  name: "Portal",
  protocol: "https",
  hostname: "portal.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  credentialSource: {
    kind: "vault",
    credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  },
  password: "IGNORED_PASSWORD",
} satisfies Connection;
const session = {
  id: "tab",
  connectionId: "saved",
  ownerDatabaseId: "db-a",
  protocol: "https",
  hostname: connection.hostname,
} as ConnectionSession;
const props = {
  connection,
  session,
  sessionTarget:
    "https://portal.example.test/private?secret=URL_PRIVATE#fragment",
};
const facets = (): DatabaseCredentialFacets => ({
  social: [
    {
      id: "social",
      provider: "Example provider",
      origin: "https://portal.example.test",
      accountHint: "Account hint",
      portable: false,
    },
  ],
  passkey: [
    {
      id: "key",
      provider: "Security key",
      rpId: "portal.example.test",
      portable: false,
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  h.getInvoke.mockResolvedValue(h.invoke);
  h.invoke.mockResolvedValue(undefined);
  h.resolve.mockImplementation(async (assert: () => void) => ({
    facets: facets(),
    assertCurrent: assert,
  }));
});
async function load() {
  fireEvent.click(
    screen.getByRole("button", { name: "Vault social and passkey sign-in" }),
  );
  await screen.findByText("Example provider · Social sign-in");
}
describe("interactive vault browser handoff", () => {
  it("does not reopen a dismissed dialog after deferred binding resolution", async () => {
    let release!: (value: {
      facets: DatabaseCredentialFacets;
      assertCurrent: () => void;
    }) => void;
    h.resolve.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<VaultInteractiveSignIn {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Vault social and passkey sign-in" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () =>
      release({ facets: facets(), assertCurrent: () => {} }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("loadsbindings onlyonexplicitclick andopenscredentialfreeoriginalHTTPSURL", async () => {
    render(<VaultInteractiveSignIn {...props} />);
    expect(h.resolve).not.toHaveBeenCalled();
    await load();
    expect(h.resolve).toHaveBeenCalledWith(
      expect.any(Function),
      false,
      "bindings",
    );
    expect(document.body.textContent).not.toContain("URL_PRIVATE");
    expect(document.body.textContent).not.toContain("IGNORED_PASSWORD");
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open website for Example provider" }),
    );
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledExactlyOnceWith("open_url_external", {
        url: "https://portal.example.test/",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "does not sign in the embedded tab",
    );
  });
  it("doesnotopenwrongorigins ormatchingpublicsuffixlikeRPIDs", async () => {
    h.resolve.mockImplementation(async (assert: () => void) => ({
      facets: {
        social: [
          { ...facets().social![0], origin: "https://other.example.test" },
        ],
        passkey: [{ ...facets().passkey![0], rpId: "test" }],
      },
      assertCurrent: assert,
    }));
    render(<VaultInteractiveSignIn {...props} />);
    await load();
    expect(
      screen.getByRole("button", { name: "Open website for Example provider" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open website for Security key" }),
    ).toBeDisabled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("rechecks thebinding beforeopening andclears ephemeral facets", async () => {
    const disclosures: {
      facets: DatabaseCredentialFacets;
      assertCurrent: () => void;
    }[] = [];
    h.resolve.mockImplementation(async (assert: () => void) => {
      const result = { facets: facets(), assertCurrent: assert };
      if (disclosures.length)
        result.facets.social![0].accountHint = "Changed account";
      disclosures.push(result);
      return result;
    });
    render(<VaultInteractiveSignIn {...props} />);
    await load();
    expect(disclosures[0].facets).toEqual({});
    fireEvent.click(
      screen.getByRole("button", { name: "Open website for Example provider" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "binding changed",
    );
    expect(disclosures[1].facets).toEqual({});
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("cancels deferrednativehandoff afterclose orownerswitch", async () => {
    let release!: (value: typeof h.invoke) => void;
    h.getInvoke.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const view = render(<VaultInteractiveSignIn {...props} />);
    await load();
    fireEvent.click(
      screen.getByRole("button", { name: "Open website for Security key" }),
    );
    await waitFor(() => expect(h.getInvoke).toHaveBeenCalled());
    view.rerender(
      <VaultInteractiveSignIn
        {...props}
        session={{ ...session, ownerDatabaseId: "db-b" }}
      />,
    );
    await act(async () => release(h.invoke));
    expect(h.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("Account hint")).not.toBeInTheDocument();
  });
  it("failsclosed forHTTP andnativehandofffailure withoutleakingrawerrors", async () => {
    const view = render(
      <VaultInteractiveSignIn
        {...props}
        connection={{ ...connection, protocol: "http", port: 80 }}
        sessionTarget="http://portal.example.test/"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Vault social and passkey sign-in" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "requires a saved HTTPS",
    );
    expect(h.resolve).not.toHaveBeenCalled();
    view.unmount();
    h.invoke.mockRejectedValue(new Error("PRIVATE_NATIVE_ERROR"));
    render(<VaultInteractiveSignIn {...props} />);
    await load();
    fireEvent.click(
      screen.getByRole("button", { name: "Open website for Security key" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "compatible browser/authenticator",
    );
    expect(document.body.textContent).not.toContain("PRIVATE_NATIVE_ERROR");
  });
});
