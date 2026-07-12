import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors LxdPanel.test).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import LxdImagesTab from "./LxdImagesTab";
import { lxdImagesApi } from "../../../hooks/integration/lxd/useLxdImages";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]); // list_* default → empty arrays
});

describe("lxdImagesApi", () => {
  it("wraps all 28 category commands with the exact command names", () => {
    // Spot-check the four resource groups + the multi-arg image commands.
    lxdImagesApi.listImages();
    lxdImagesApi.getImage("abc");
    lxdImagesApi.deleteImage("abc");
    lxdImagesApi.updateImage("abc", { os: "ubuntu" }, true, false);
    lxdImagesApi.copyImageFromRemote("srv", "simplestreams", true, false, "ubuntu/22.04");
    lxdImagesApi.renameProfile("old", "new");
    lxdImagesApi.patchProject("p", { config: {} });
    lxdImagesApi.addCertificate({ name: "c", certificate: "PEM" });

    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual([
      "lxd_list_images",
      "lxd_get_image",
      "lxd_delete_image",
      "lxd_update_image",
      "lxd_copy_image_from_remote",
      "lxd_rename_profile",
      "lxd_patch_project",
      "lxd_add_certificate",
    ]);

    // camelCase arg conversion is exercised end-to-end.
    expect(invokeMock).toHaveBeenCalledWith("lxd_update_image", {
      fingerprint: "abc",
      properties: { os: "ubuntu" },
      public: true,
      autoUpdate: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("lxd_rename_profile", {
      name: "old",
      newName: "new",
    });
    expect(invokeMock).toHaveBeenCalledWith("lxd_copy_image_from_remote", {
      server: "srv",
      protocol: "simplestreams",
      alias: "ubuntu/22.04",
      fingerprint: undefined,
      autoUpdate: true,
      public: false,
    });
  });
});

describe("LxdImagesTab", () => {
  it("gates on connection", () => {
    render(<LxdImagesTab connected={false} />);
    expect(
      screen.getByText(
        "Connect to an LXD server to manage images, profiles, projects and certificates.",
      ),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("lists images on mount when connected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lxd_list_images")
        return Promise.resolve([
          { fingerprint: "deadbeefcafe0000", architecture: "x86_64", type: "container", public: true },
        ]);
      return Promise.resolve([]);
    });

    render(<LxdImagesTab connected />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("lxd_list_images", undefined),
    );
    // The fingerprint prefix appears in both the row title and subtitle.
    expect((await screen.findAllByText(/deadbeefcafe/)).length).toBeGreaterThan(0);
  });

  it("switches to the Profiles section and lists profiles", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lxd_list_profiles")
        return Promise.resolve([{ name: "default", description: "Default profile" }]);
      return Promise.resolve([]);
    });

    render(<LxdImagesTab connected />);
    fireEvent.click(screen.getByText("Profiles"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("lxd_list_profiles", undefined),
    );
    expect(await screen.findByText("default")).toBeInTheDocument();
  });
});
