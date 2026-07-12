// LXD / Incus — "Images & Profiles" invoke slice + hook (t42-lxd-c2).
//
// `lxdImagesApi` is a thin 1:1 wrapper over the 28 `lxd_*` Tauri commands in this
// category (Images 9, Profiles 7, Projects 7, Certificates 5). Unlike per-device
// integrations, LXD holds a single active connection in the backend `LxdService`
// state, so no command takes a connection id — the wrappers mirror the Rust fn
// params directly. Argument names are camelCase exactly matching the Rust params
// after Tauri v2's snake→camel conversion (`newName`, `autoUpdate`, `fingerprint`,
// `req`, `patch`, `body`, …), per `src-tauri/crates/sorng-lxd/src/commands.rs`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { LxdOperation } from "../../../types/lxd";
import type {
  AddCertificateRequest,
  CreateImageAliasRequest,
  CreateProfileRequest,
  CreateProjectRequest,
  LxdCertificate,
  LxdImage,
  LxdProfile,
  LxdProject,
  UpdateProfileRequest,
} from "../../../types/lxd/images";

/** One thin wrapper per command; args mirror the Rust signature 1:1. */
export const lxdImagesApi = {
  // ── Images ───────────────────────────────────────────────────────────────
  listImages: () => invoke<LxdImage[]>("lxd_list_images"),
  getImage: (fingerprint: string) =>
    invoke<LxdImage>("lxd_get_image", { fingerprint }),
  getImageAlias: (alias: string) =>
    invoke<unknown>("lxd_get_image_alias", { alias }),
  createImageAlias: (req: CreateImageAliasRequest) =>
    invoke<void>("lxd_create_image_alias", { req }),
  deleteImageAlias: (alias: string) =>
    invoke<void>("lxd_delete_image_alias", { alias }),
  deleteImage: (fingerprint: string) =>
    invoke<LxdOperation>("lxd_delete_image", { fingerprint }),
  updateImage: (
    fingerprint: string,
    properties: Record<string, string>,
    publicImage?: boolean,
    autoUpdate?: boolean,
  ) =>
    invoke<void>("lxd_update_image", {
      fingerprint,
      properties,
      public: publicImage,
      autoUpdate,
    }),
  copyImageFromRemote: (
    server: string,
    protocol: string,
    autoUpdate: boolean,
    publicImage: boolean,
    alias?: string,
    fingerprint?: string,
  ) =>
    invoke<LxdOperation>("lxd_copy_image_from_remote", {
      server,
      protocol,
      alias,
      fingerprint,
      autoUpdate,
      public: publicImage,
    }),
  refreshImage: (fingerprint: string) =>
    invoke<LxdOperation>("lxd_refresh_image", { fingerprint }),

  // ── Profiles ─────────────────────────────────────────────────────────────
  listProfiles: () => invoke<LxdProfile[]>("lxd_list_profiles"),
  getProfile: (name: string) =>
    invoke<LxdProfile>("lxd_get_profile", { name }),
  createProfile: (req: CreateProfileRequest) =>
    invoke<void>("lxd_create_profile", { req }),
  updateProfile: (req: UpdateProfileRequest) =>
    invoke<void>("lxd_update_profile", { req }),
  patchProfile: (name: string, patch: Record<string, unknown>) =>
    invoke<void>("lxd_patch_profile", { name, patch }),
  deleteProfile: (name: string) =>
    invoke<void>("lxd_delete_profile", { name }),
  renameProfile: (name: string, newName: string) =>
    invoke<void>("lxd_rename_profile", { name, newName }),

  // ── Projects ─────────────────────────────────────────────────────────────
  listProjects: () => invoke<LxdProject[]>("lxd_list_projects"),
  getProject: (name: string) =>
    invoke<LxdProject>("lxd_get_project", { name }),
  createProject: (req: CreateProjectRequest) =>
    invoke<void>("lxd_create_project", { req }),
  updateProject: (name: string, body: Record<string, unknown>) =>
    invoke<void>("lxd_update_project", { name, body }),
  patchProject: (name: string, patch: Record<string, unknown>) =>
    invoke<void>("lxd_patch_project", { name, patch }),
  deleteProject: (name: string) =>
    invoke<void>("lxd_delete_project", { name }),
  renameProject: (name: string, newName: string) =>
    invoke<void>("lxd_rename_project", { name, newName }),

  // ── Certificates ─────────────────────────────────────────────────────────
  listCertificates: () =>
    invoke<LxdCertificate[]>("lxd_list_certificates"),
  getCertificate: (fingerprint: string) =>
    invoke<LxdCertificate>("lxd_get_certificate", { fingerprint }),
  addCertificate: (req: AddCertificateRequest) =>
    invoke<void>("lxd_add_certificate", { req }),
  deleteCertificate: (fingerprint: string) =>
    invoke<void>("lxd_delete_certificate", { fingerprint }),
  updateCertificate: (fingerprint: string, patch: Record<string, unknown>) =>
    invoke<void>("lxd_update_certificate", { fingerprint, patch }),
} as const;

export type LxdImagesApi = typeof lxdImagesApi;

/** Small stateful helper the tab uses to funnel every command through a shared
 *  `loading` / `error` surface. Section view-state stays in the component; this
 *  hook owns only the cross-cutting request lifecycle. */
export function useLxdImages() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run an api call with shared loading/error handling. Returns the resolved
   *  value, or `undefined` if the call threw (the error is captured in state). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { api: lxdImagesApi, loading, error, setError, clearError, run };
}

export type UseLxdImages = ReturnType<typeof useLxdImages>;
