import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebar } from "../../src/hooks/connection/useSidebar";
import { SecureStorage } from "../../src/utils/storage/storage";

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [],
      filter: {
        searchTerm: "",
        tags: [],
        colorTags: [],
        protocols: [],
        showRecent: false,
        showFavorites: false,
        sortBy: "name",
        sortDirection: "asc",
      },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Connections header storage badge removal", () => {
  afterEach(() => vi.restoreAllMocks());
  it("does not query legacy global storage to describe the active database", () => {
    const encrypted = vi
      .spyOn(SecureStorage, "isStorageEncrypted")
      .mockResolvedValue(true);
    const unlocked = vi
      .spyOn(SecureStorage, "isStorageUnlocked")
      .mockReturnValue(false);
    const { result, unmount } = renderHook(() => useSidebar());
    expect(encrypted).not.toHaveBeenCalled();
    expect(unlocked).not.toHaveBeenCalled();
    expect(result.current).not.toHaveProperty("isStorageEncrypted");
    expect(result.current).not.toHaveProperty("isStorageUnlocked");
    expect(result.current).toHaveProperty("updateConnectionReorder");
    unmount();
  });
});
