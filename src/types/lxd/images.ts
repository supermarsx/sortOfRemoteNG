// LXD / Incus — "Images & Profiles" category slice types (t42-lxd-c2).
//
// 1:1 mirror of the image / profile / project / certificate structs in
// `src-tauri/crates/sorng-lxd/src/types.rs`. Field casing matches each struct's
// serde attribute exactly (it is the wire format the Tauri command returns):
//   - response structs use `rename_all = "snake_case"` (or verbatim field names
//     when they carry no `rename_all`), so their fields stay snake_case here;
//   - the `#[serde(rename = "type")]` fields surface as `type`;
//   - request structs use `rename_all = "camelCase"`, so their fields are
//     camelCase.
// `null` is spelled out on response fields because their Rust `Option<T>` has no
// `skip_serializing_if` and therefore serializes as JSON `null` when absent.
//
// Shared types (`LxdOperation`, `LxdError`, connection) live in `../lxd` and are
// imported by the hook — this slice does not redefine them.

// ─── Images ─────────────────────────────────────────────────────────────────

/** Mirror of `ImageAlias` (verbatim field names). */
export interface ImageAlias {
  name?: string | null;
  description?: string | null;
}

/** Mirror of `ImageSource` (verbatim field names — note `image_type`, NOT
 *  `type`, since this struct carries no `rename`). */
export interface ImageSource {
  server?: string | null;
  protocol?: string | null;
  alias?: string | null;
  certificate?: string | null;
  image_type?: string | null;
}

/** Mirror of `LxdImage` (`snake_case`; `image_type` renamed to `type`). */
export interface LxdImage {
  fingerprint?: string | null;
  filename?: string | null;
  size?: number | null;
  architecture?: string | null;
  type?: string | null;
  public?: boolean | null;
  auto_update?: boolean | null;
  created_at?: string | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  uploaded_at?: string | null;
  update_source?: ImageSource | null;
  properties?: Record<string, string> | null;
  aliases?: ImageAlias[] | null;
  profiles?: string[] | null;
  cached?: boolean | null;
}

/** Mirror of `CreateImageAliasRequest` (`camelCase`). */
export interface CreateImageAliasRequest {
  name: string;
  description?: string;
  target: string;
}

// ─── Profiles ───────────────────────────────────────────────────────────────

/** Mirror of `LxdProfile` (`snake_case`). */
export interface LxdProfile {
  name: string;
  description?: string | null;
  config?: Record<string, string> | null;
  devices?: Record<string, Record<string, string>> | null;
  used_by?: string[] | null;
}

/** Mirror of `CreateProfileRequest` (`camelCase`, optional fields skipped when
 *  absent). */
export interface CreateProfileRequest {
  name: string;
  description?: string;
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
}

/** Mirror of `UpdateProfileRequest` (`camelCase`, optional fields skipped when
 *  absent). Full replacement of a profile's editable fields. */
export interface UpdateProfileRequest {
  name: string;
  description?: string;
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
}

// ─── Projects ───────────────────────────────────────────────────────────────

/** Mirror of `LxdProject` (`snake_case`). */
export interface LxdProject {
  name: string;
  description?: string | null;
  config?: Record<string, string> | null;
  used_by?: string[] | null;
}

/** Mirror of `CreateProjectRequest` (`camelCase`, optional fields skipped when
 *  absent). */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  config?: Record<string, string>;
}

// ─── Certificates ─────────────────────────────────────────────────────────────

/** Mirror of `LxdCertificate` (`snake_case`; `cert_type` renamed to `type`). */
export interface LxdCertificate {
  fingerprint?: string | null;
  name?: string | null;
  type?: string | null;
  restricted?: boolean | null;
  projects?: string[] | null;
  certificate?: string | null;
  description?: string | null;
}

/** Mirror of `AddCertificateRequest` (`camelCase`; `cert_type` renamed to
 *  `type`). `restricted` defaults to `false` server-side when omitted. */
export interface AddCertificateRequest {
  name: string;
  type?: string;
  certificate: string;
  password?: string;
  restricted?: boolean;
  projects?: string[];
  description?: string;
}
