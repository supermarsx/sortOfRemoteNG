import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import GdrivePanel, { gdriveDescriptor } from "./GdrivePanel";
import { gdriveApi } from "../../hooks/integration/useGdrive";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "gdrive_is_authenticated":
        return Promise.resolve(false);
      case "gdrive_get_auth_url":
        return Promise.resolve("https://accounts.google.com/o/oauth2/auth?x=1");
      case "gdrive_get_token":
        return Promise.resolve({
          accessToken: "ya29.abc",
          refreshToken: "1//refresh",
          tokenType: "Bearer",
        });
      default:
        return Promise.resolve(undefined);
    }
  });
});

describe("GdrivePanel", () => {
  it("renders the OAuth credential form when not authenticated", async () => {
    render(<GdrivePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("xxxxxx.apps.googleusercontent.com"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Get authorization URL/i }),
    ).toBeInTheDocument();
  });

  it("the OAuth flow maps to set_credentials → get_auth_url → exchange_code", async () => {
    render(<GdrivePanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("xxxxxx.apps.googleusercontent.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByPlaceholderText("xxxxxx.apps.googleusercontent.com"),
      { target: { value: "my-client-id" } },
    );
    // The client secret is the only password field in the credential form.
    const secretInput = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(secretInput, { target: { value: "my-secret" } });

    fireEvent.click(
      screen.getByRole("button", { name: /Get authorization URL/i }),
    );

    // Step 1: credentials registered with the exact snake→camel arg names.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "gdrive_set_credentials",
        expect.objectContaining({
          clientId: "my-client-id",
          clientSecret: "my-secret",
          redirectUri: expect.any(String),
          scopes: expect.arrayContaining([
            "https://www.googleapis.com/auth/drive",
          ]),
        }),
      ),
    );
    // Step 2: authorization URL requested.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "gdrive_get_auth_url",
        undefined,
      ),
    );

    // Step 3: the code-entry box appears; exchanging maps to gdrive_exchange_code.
    const codeInput = await screen.findByPlaceholderText("4/0Axxxx...");
    fireEvent.change(codeInput, { target: { value: "auth-code-123" } });
    fireEvent.click(screen.getByRole("button", { name: /Exchange code/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("gdrive_exchange_code", {
        code: "auth-code-123",
      }),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(gdriveDescriptor.key).toBe("gdrive");
    expect(gdriveDescriptor.category).toBe("file-storage");
    expect(gdriveDescriptor.label).toBe("Google Drive");
    expect(typeof gdriveDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names", () => {
    gdriveApi.listFiles(undefined, 10);
    gdriveApi.shareWithUser("f1", "u@x.com", "writer", true);
    gdriveApi.createDrive("Team", "req-1");
    expect(invokeMock).toHaveBeenCalledWith("gdrive_list_files", {
      query: undefined,
      pageSize: 10,
      pageToken: undefined,
      orderBy: undefined,
    });
    expect(invokeMock).toHaveBeenCalledWith("gdrive_share_with_user", {
      fileId: "f1",
      email: "u@x.com",
      role: "writer",
      sendNotification: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("gdrive_create_drive", {
      name: "Team",
      requestId: "req-1",
    });
  });
});
