import { describe, expect, it } from "vitest";
import {
  normalizeHttpApplicationSettings,
  normalizeTacticalRmmMeshOrigin,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationMeshOrigin,
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import type { HttpApplicationSettings } from "../../src/types/connection/connection";

const tactical = {
  version: 1,
  id: "tacticalrmm",
  loginMode: "manual",
} as const;
describe("Tactical MeshCentral origin", () => {
  it.each([
    ["HTTPS://MESH.example.com:443/", "https://mesh.example.com"],
    ["https://mesh.internal:8443/", "https://mesh.internal:8443"],
    ["https://meshserver", "https://meshserver"],
    ["https://10.0.0.5:4443", "https://10.0.0.5:4443"],
    ["https://[fd00::1]:8443/", "https://[fd00::1]:8443"],
  ])("canonicalizes exact configured authority %s", (meshOrigin, expected) => {
    const input = {
      ...tactical,
      apiOrigin: "https://api.example.com",
      meshOrigin,
    };
    const normalized = normalizeHttpApplicationSettings(input);
    expect(normalizeTacticalRmmMeshOrigin(meshOrigin)).toBe(expected);
    expect(normalized).toEqual({ ...input, meshOrigin: expected });
    expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
    expect(getReviewedApplicationMeshOrigin({ httpApplication: input })).toBe(
      expected,
    );
    expect(getReviewedApplicationProfile({ httpApplication: input })).toBe(
      "tacticalrmm",
    );
    expect(input.meshOrigin).toBe(meshOrigin);
  });
  it.each([
    "",
    " ",
    null,
    42,
    {},
    [],
    "http://mesh.example.com",
    "//mesh.example.com",
    "https:mesh.example.com",
    "https:///mesh.example.com",
    "https://mesh.example.com:0",
    "https://mesh.example.com:65536",
    "https://mesh.example.com.",
    "https://mesh.example.com.:8443/",
    "https://*.example.com",
    "https://user:secret@mesh.example.com",
    "https://@mesh.example.com",
    "https://mesh.example.com/mesh",
    "https://mesh.example.com/.",
    "https://mesh.example.com/%2e",
    "https://mesh.example.com//",
    "https://mesh.example.com?token=secret",
    "https://mesh.example.com?",
    "https://mesh.example.com#",
    "https://mesh.example.com#secret",
    "https://mesh.example.com\\",
    " https://mesh.example.com",
    "https://mesh.example.com\n",
    "https://mesh.\texample.com",
    "https://%6desh.example.com",
    `https://${"a".repeat(2048)}.test`,
  ])("keeps malformed imported value %j invalid", (meshOrigin) => {
    const input = { ...tactical, meshOrigin } as HttpApplicationSettings;
    const normalized = normalizeHttpApplicationSettings(input);
    expect(normalizeTacticalRmmMeshOrigin(meshOrigin)).toBeUndefined();
    expect(normalized).toEqual({ ...tactical, invalid: true });
    expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
    expect(
      getReviewedApplicationMeshOrigin({ httpApplication: input }),
    ).toBeUndefined();
    expect(
      getReviewedApplicationProfile({ httpApplication: input }),
    ).toBeUndefined();
    expect(() =>
      resolveHttpApplicationLogin({ httpApplication: input }),
    ).toThrow(/invalid/);
  });
  it.each(["portainer", "joomla", "cpanel", "unknown"])(
    "refuses Mesh routing for profile %s",
    (id) => {
      const input = {
        ...tactical,
        id,
        meshOrigin: "https://mesh.internal:8443",
      };
      expect(normalizeHttpApplicationSettings(input)?.invalid).toBe(true);
      expect(
        getReviewedApplicationMeshOrigin({ httpApplication: input }),
      ).toBeUndefined();
    },
  );
  it("omits the optional value and refuses otherwise invalid profiles", () => {
    expect(normalizeHttpApplicationSettings(tactical)).toEqual(tactical);
    for (const connection of [
      undefined,
      null,
      {},
      { httpApplication: tactical },
      {
        httpApplication: {
          ...tactical,
          invalid: true as const,
          meshOrigin: "https://mesh.internal",
        },
      },
    ])
      expect(getReviewedApplicationMeshOrigin(connection)).toBeUndefined();
  });
  it("rejects the canonical dashboard origin before native startup but allows another port", () => {
    const connection = {
      httpApplication: {
        ...tactical,
        meshOrigin: "HTTPS://RMM.example.com:443/",
      },
    };
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://rmm.example.com/dashboard",
      ),
    ).toThrow(/MeshCentral origin must differ/);
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://rmm.example.com:8443/dashboard",
      ),
    ).not.toThrow();
    expect(() =>
      validateHttpApplicationTarget(
        { httpApplication: tactical },
        "https://rmm.example.com/dashboard",
      ),
    ).not.toThrow();
  });
});
