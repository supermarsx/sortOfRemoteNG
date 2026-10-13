import React, { useContext, useMemo } from "react";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../../types/connection/connection";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import { parseCanonicalWebAuthority } from "../../../utils/connection/sanitizeHostname";
import {
  DRONE_SCM_PROVIDERS,
  DRONE_SCM_SPECS,
  type DroneScmIssue,
  type DroneScmProvider,
  linkDroneScmFromConnection,
  normalizeDroneScmSettings,
  resolveDroneScmBridge,
} from "../../../utils/connection/droneScmBridge";

/** Fixed sentences only; never text from a page or a saved value. */
const ISSUE_TEXT: Record<DroneScmIssue, string> = {
  "invalid-settings": "Review the Git provider settings.",
  "unknown-field": "Review the Git provider settings.",
  "invalid-provider": "Choose the Git provider Drone signs in through.",
  "invalid-scm-origin": "Review the Git provider's address.",
  "invalid-client-id":
    "Enter the OAuth client ID exactly as Drone is configured with it (letters, digits, '.', '_', '~' and '-').",
  "invalid-drone-origin": "Save Drone's own web address first.",
  "scm-origin-required": "Enter the Git provider's address.",
  "scm-origin-fixed":
    "Bitbucket Cloud always signs in at https://bitbucket.org.",
  "scm-origin-is-drone": "The Git provider cannot be Drone itself.",
  "insecure-scm-origin":
    "The Git provider must use HTTPS: the password and the authenticator code travel on that leg.",
  "invalid-redirect-target": "Review the Git provider settings.",
  "not-an-authorize-redirect": "Review the Git provider settings.",
  "callback-not-drone": "Review the Git provider settings.",
  "not-an-scm-connection":
    "That connection is not a Gitea, GitHub or GitLab connection.",
};

const LINKABLE_LABELS: Readonly<Record<string, string>> = {
  gitea: "Gitea",
  github: "GitHub",
  "gitlab-self-hosted": "GitLab",
};

function droneUrl(formData: Partial<Connection>): string {
  try {
    const protocol = formData.protocol === "http" ? "http" : "https";
    const authority = parseCanonicalWebAuthority(formData.hostname ?? "");
    const url = new URL(`${protocol}://${authority.hostname}/`);
    const port = formData.port || authority.port;
    if (port) url.port = String(port);
    return url.href;
  } catch {
    return "";
  }
}

/** Drone CI's saved provider fields (also declared on HttpApplicationSettings). */
type DroneApplication = HttpApplicationSettings & {
  droneScmProvider?: DroneScmProvider;
  droneScmOrigin?: string;
  droneScmClientId?: string;
};

interface Props {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  /** Saved connections to link from; defaults to the open database's. */
  connections?: readonly Connection[];
}

/**
 * Drone CI's Git provider (bridged sign-in). The provider address is the only
 * place credentials may be typed for an OAuth provider; it is entered or
 * linked here and never taken from a redirect.
 */
export default function DroneScmBridgeFields({
  formData,
  setFormData,
  connections,
}: Props) {
  const context = useContext(ConnectionContext);
  const saved = context?.state.connections;
  const application = formData.httpApplication as DroneApplication | undefined;
  const linkable = useMemo(
    () =>
      (connections ?? saved ?? []).filter(
        (connection) =>
          connection.id !== formData.id &&
          !connection.isGroup &&
          !!LINKABLE_LABELS[connection.httpApplication?.id ?? ""] &&
          linkDroneScmFromConnection(connection).ok,
      ),
    [connections, saved, formData.id],
  );
  if (application?.id !== "drone-ci") return null;

  const provider = application.droneScmProvider;
  const rawOrigin = application.droneScmOrigin;
  const clientId = application.droneScmClientId;
  const spec = provider ? DRONE_SCM_SPECS[provider] : undefined;
  const source = droneUrl(formData);
  const settings = {
    provider,
    ...(rawOrigin !== undefined ? { origin: rawOrigin } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
  };
  const originCheck =
    rawOrigin === undefined
      ? null
      : normalizeDroneScmSettings({ provider: "gitea", origin: rawOrigin });
  const invalidOrigin = !!originCheck && !originCheck.ok;
  const bridge = resolveDroneScmBridge(settings, source);

  const update = (patch: Partial<DroneApplication>) =>
    setFormData((previous) => {
      if (previous.httpApplication?.id !== "drone-ci") return previous;
      const next: DroneApplication = { ...previous.httpApplication, ...patch };
      for (const key of [
        "droneScmProvider",
        "droneScmOrigin",
        "droneScmClientId",
      ] as const)
        if (next[key] === undefined || next[key] === "") delete next[key];
      return { ...previous, httpApplication: next };
    });

  const link = (id: string) => {
    const connection = linkable.find((candidate) => candidate.id === id);
    if (!connection) return;
    const linked = linkDroneScmFromConnection(connection);
    if (!linked.ok) return;
    setFormData((previous) => {
      if (previous.httpApplication?.id !== "drone-ci") return previous;
      return {
        ...previous,
        httpApplication: {
          ...previous.httpApplication,
          droneScmProvider: linked.value.settings.provider,
          droneScmOrigin: linked.value.settings.origin,
        },
        // A shared vault reference only; local passwords never travel.
        ...(linked.value.credentialSource
          ? { credentialSource: linked.value.credentialSource }
          : {}),
      };
    });
  };
  const linkedFrom = linkable.find(
    (connection) =>
      connection.credentialSource?.kind === "vault" &&
      formData.credentialSource?.kind === "vault" &&
      connection.credentialSource.credentialId ===
        formData.credentialSource.credentialId,
  );
  const linkedLocal = linkable.find((connection) => {
    const linked = linkDroneScmFromConnection(connection);
    return (
      linked.ok &&
      !linked.value.credentialSource &&
      linked.value.settings.origin === rawOrigin
    );
  });

  let status: string;
  if (!bridge.ok) status = ISSUE_TEXT[bridge.issue];
  else if (bridge.value.scmOrigin === null)
    status = `The saved username and password are typed only into Drone's own sign-in form at ${bridge.value.droneOrigin}.`;
  else if (bridge.value.credentialOrigins.length)
    status = `The saved username and password are typed only on ${bridge.value.credentialOrigins[0]}, never on Drone or another redirect target.`;
  else
    status = `${spec?.label ?? "This provider"} has no reviewed sign-in page here: Drone opens it and you sign in there yourself; nothing is typed.`;

  return (
    <div className="max-w-xl space-y-2" data-testid="drone-scm-bridge">
      <label htmlFor="drone-scm-provider" className="block text-sm font-medium">
        Git provider
      </label>
      <select
        id="drone-scm-provider"
        className="sor-form-select"
        value={provider ?? ""}
        onChange={(event) =>
          update({
            droneScmProvider:
              (event.target.value as DroneScmProvider) || undefined,
          })
        }
      >
        <option value="">Choose a provider…</option>
        {DRONE_SCM_PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {DRONE_SCM_SPECS[value].label}
          </option>
        ))}
      </select>

      {linkable.length > 0 && (
        <>
          <label htmlFor="drone-scm-link" className="block text-sm font-medium">
            Use a saved Git connection
          </label>
          <select
            id="drone-scm-link"
            className="sor-form-select"
            value=""
            onChange={(event) => link(event.target.value)}
          >
            <option value="">Choose a connection…</option>
            {linkable.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {`${connection.name} (${LINKABLE_LABELS[connection.httpApplication!.id]})`}
              </option>
            ))}
          </select>
        </>
      )}

      {spec?.flow === "oauth" && !spec.fixedOrigin && (
        <>
          <label
            htmlFor="drone-scm-origin"
            className="block text-sm font-medium"
          >
            Git provider address
          </label>
          <input
            id="drone-scm-origin"
            className="sor-form-input"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            placeholder={spec.defaultOrigin ?? "https://git.example.com"}
            value={rawOrigin ?? ""}
            aria-invalid={invalidOrigin}
            aria-describedby="drone-scm-origin-help"
            onChange={(event) =>
              update({ droneScmOrigin: event.target.value || undefined })
            }
            onBlur={() => {
              if (originCheck?.ok && originCheck.value.origin)
                update({ droneScmOrigin: originCheck.value.origin });
            }}
          />
          <p
            id="drone-scm-origin-help"
            className="text-xs text-[var(--color-textMuted)]"
          >
            The exact HTTPS address Drone sends you to for sign-in
            {spec.defaultOrigin ? ` (blank means ${spec.defaultOrigin})` : ""}.
            Credentials are typed only there, never on an address a redirect
            names.
          </p>
          {invalidOrigin && (
            <p role="alert" className="text-sm text-error">
              Enter only the origin, such as https://git.example.com:3000,
              without a path, query, fragment or credentials.
            </p>
          )}
          <label
            htmlFor="drone-scm-client-id"
            className="block text-sm font-medium"
          >
            OAuth client ID (optional)
          </label>
          <input
            id="drone-scm-client-id"
            className="sor-form-input"
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            value={clientId ?? ""}
            onChange={(event) =>
              update({ droneScmClientId: event.target.value || undefined })
            }
          />
          <p className="text-xs text-[var(--color-textMuted)]">
            The public client ID of Drone&apos;s OAuth application (for Gitea,
            Drone&apos;s DRONE_GITEA_CLIENT_ID). Not a secret; it binds the
            provider&apos;s consent step to Drone&apos;s own application.
          </p>
        </>
      )}

      <p role="status" className="text-sm">
        {status}
      </p>
      {bridge.ok && bridge.value.totp && (
        <p className="text-xs text-[var(--color-textMuted)]">
          With Automatic 2FA set up, the authenticator code is typed only on{" "}
          {bridge.value.totp.origin}
          {bridge.value.totp.challenge.paths[0]}.
        </p>
      )}
      {bridge.ok && bridge.value.scmOrigin !== null && (
        <p className="text-xs text-[var(--color-textMuted)]">
          The provider&apos;s Authorize page stays with you. Once you have
          authorized Drone, the provider skips it on later sign-ins.
        </p>
      )}
      {linkedFrom && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Signs in with the same database vault entry as {linkedFrom.name}.
        </p>
      )}
      {!linkedFrom && linkedLocal && (
        <p className="text-xs text-[var(--color-textMuted)]">
          {linkedLocal.name} keeps its password in its own fields, which are
          never copied. Enter the Git provider&apos;s username and password for
          this connection, or move both connections to one database vault entry.
        </p>
      )}
    </div>
  );
}
