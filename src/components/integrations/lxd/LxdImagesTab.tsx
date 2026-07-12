// LxdImagesTab — "Images & Profiles" sub-tab for the LXD / Incus panel
// (t42-lxd-c2). Catalog/definitions view: images, profiles, projects and
// certificates. Binds all 28 commands of this category full-depth via
// `useLxdImages()`:
//   Images (9): list / get / getAlias / createAlias / deleteAlias / delete /
//     update / copyFromRemote / refresh
//   Profiles (7): list / get / create / update / patch / delete / rename
//   Projects (7): list / get / create / update / patch / delete / rename
//   Certificates (5): list / get / add / delete / update
//
// The panel shell owns the connection; this tab gates every fetch on `connected`
// and instantiates its own category hook.

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  FolderKanban,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { LxdTabProps } from "./registry";
import { useLxdImages } from "../../../hooks/integration/lxd/useLxdImages";
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

type Section = "images" | "profiles" | "projects" | "certificates";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60";
const ghostBtn =
  "app-bar-button flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-60";
const dangerBtn =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-500 disabled:opacity-60";

/** Parse a JSON textarea, returning `undefined` (and no throw) when empty. */
function parseJsonMaybe(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as Record<string, unknown>;
}

const LxdImagesTab: React.FC<LxdTabProps> = ({ connected }) => {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("images");
  const tools = useLxdImages();

  const sections: { key: Section; labelKey: string; label: string; icon: React.ReactNode }[] =
    [
      {
        key: "images",
        labelKey: "integrations.lxd.images.sectionImages",
        label: "Images",
        icon: <Boxes size={13} />,
      },
      {
        key: "profiles",
        labelKey: "integrations.lxd.images.sectionProfiles",
        label: "Profiles",
        icon: <Layers size={13} />,
      },
      {
        key: "projects",
        labelKey: "integrations.lxd.images.sectionProjects",
        label: "Projects",
        icon: <FolderKanban size={13} />,
      },
      {
        key: "certificates",
        labelKey: "integrations.lxd.images.sectionCertificates",
        label: "Certificates",
        icon: <ShieldCheck size={13} />,
      },
    ];

  if (!connected) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-textSecondary)]">
        {t(
          "integrations.lxd.images.notConnected",
          "Connect to an LXD server to manage images, profiles, projects and certificates.",
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Section selector */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-3 py-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setSection(s.key);
              tools.clearError();
            }}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              section === s.key
                ? "bg-primary/10 text-primary"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {s.icon}
            {t(s.labelKey, s.label)}
          </button>
        ))}
      </div>

      {tools.error && (
        <div className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1 break-words">{tools.error}</span>
          <button onClick={tools.clearError} className="shrink-0">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="p-3">
        {section === "images" && <ImagesSection tools={tools} />}
        {section === "profiles" && <ProfilesSection tools={tools} />}
        {section === "projects" && <ProjectsSection tools={tools} />}
        {section === "certificates" && <CertificatesSection tools={tools} />}
      </div>
    </div>
  );
};

// ─── Shared bits ──────────────────────────────────────────────────────────────

type Tools = ReturnType<typeof useLxdImages>;

const SectionToolbar: React.FC<{
  title: string;
  loading: boolean;
  onRefresh: () => void;
  onCreate?: () => void;
  createLabel?: string;
}> = ({ title, loading, onRefresh, onCreate, createLabel }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
        {title}
      </h3>
      <div className="flex items-center gap-1">
        <button onClick={onRefresh} disabled={loading} className={ghostBtn}>
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.lxd.images.refresh", "Refresh")}
        </button>
        {onCreate && (
          <button onClick={onCreate} className={ghostBtn}>
            <Plus size={12} />
            {createLabel ?? t("integrations.lxd.images.create", "New")}
          </button>
        )}
      </div>
    </div>
  );
};

const EmptyRow: React.FC<{ text: string }> = ({ text }) => (
  <div className="py-6 text-center text-xs text-[var(--color-textSecondary)]">
    {text}
  </div>
);

// ─── Images ─────────────────────────────────────────────────────────────────

const ImagesSection: React.FC<{ tools: Tools }> = ({ tools }) => {
  const { t } = useTranslation();
  const { api, run, loading } = tools;
  const [images, setImages] = useState<LxdImage[]>([]);
  const [selected, setSelected] = useState<LxdImage | null>(null);
  const [showCopy, setShowCopy] = useState(false);
  const [showAlias, setShowAlias] = useState(false);
  const [aliasLookup, setAliasLookup] = useState("");
  const [aliasResult, setAliasResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await run(() => api.listImages());
    if (res) setImages(res);
  }, [api, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = useCallback(
    async (fingerprint: string) => {
      const img = await run(() => api.getImage(fingerprint));
      if (img) setSelected(img);
    },
    [api, run],
  );

  const remove = useCallback(
    async (fingerprint: string) => {
      await run(() => api.deleteImage(fingerprint));
      await refresh();
    },
    [api, run, refresh],
  );

  const refreshOne = useCallback(
    async (fingerprint: string) => {
      await run(() => api.refreshImage(fingerprint));
    },
    [api, run],
  );

  const lookupAlias = useCallback(async () => {
    const res = await run(() => api.getImageAlias(aliasLookup.trim()));
    setAliasResult(res === undefined ? null : JSON.stringify(res, null, 2));
  }, [api, run, aliasLookup]);

  const deleteAlias = useCallback(
    async (alias: string) => {
      await run(() => api.deleteImageAlias(alias));
      await refresh();
    },
    [api, run, refresh],
  );

  return (
    <div>
      <SectionToolbar
        title={t("integrations.lxd.images.sectionImages", "Images")}
        loading={loading}
        onRefresh={refresh}
      />
      <div className="mb-2 flex flex-wrap gap-1">
        <button onClick={() => setShowCopy((v) => !v)} className={ghostBtn}>
          <Plus size={12} />
          {t("integrations.lxd.images.copyFromRemote", "Copy from remote")}
        </button>
        <button onClick={() => setShowAlias((v) => !v)} className={ghostBtn}>
          <Plus size={12} />
          {t("integrations.lxd.images.manageAliases", "Aliases")}
        </button>
      </div>

      {showCopy && (
        <CopyImageForm
          tools={tools}
          onDone={() => {
            setShowCopy(false);
            void refresh();
          }}
        />
      )}
      {showAlias && (
        <div className="mb-3 rounded border border-[var(--color-border)] p-3">
          <CreateAliasForm tools={tools} onDone={refresh} />
          <div className="mt-3">
            <label className={labelClass}>
              {t("integrations.lxd.images.aliasLookup", "Look up alias")}
            </label>
            <div className="flex gap-1">
              <input
                className={inputClass}
                value={aliasLookup}
                onChange={(e) => setAliasLookup(e.target.value)}
                placeholder="images/ubuntu/22.04"
              />
              <button
                onClick={lookupAlias}
                disabled={!aliasLookup.trim()}
                className={primaryBtn}
              >
                {t("integrations.lxd.images.get", "Get")}
              </button>
              {aliasLookup.trim() && (
                <button
                  onClick={() => deleteAlias(aliasLookup.trim())}
                  className={dangerBtn}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {aliasResult && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-[11px] text-[var(--color-text)]">
                {aliasResult}
              </pre>
            )}
          </div>
        </div>
      )}

      {images.length === 0 ? (
        <EmptyRow text={t("integrations.lxd.images.emptyImages", "No images.")} />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {images.map((img) => (
            <li
              key={img.fingerprint ?? Math.random()}
              className="flex items-center justify-between gap-2 py-2"
            >
              <button
                onClick={() => img.fingerprint && openDetail(img.fingerprint)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-[var(--color-text)]">
                  {img.aliases?.[0]?.name ||
                    img.properties?.description ||
                    img.filename ||
                    img.fingerprint?.slice(0, 12) ||
                    "—"}
                </div>
                <div className="truncate text-[11px] text-[var(--color-textSecondary)]">
                  {img.fingerprint?.slice(0, 12)} · {img.architecture ?? "?"} ·{" "}
                  {img.type ?? "?"} · {img.public ? "public" : "private"}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => img.fingerprint && refreshOne(img.fingerprint)}
                  title={t("integrations.lxd.images.refreshImage", "Refresh")}
                  className={ghostBtn}
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => img.fingerprint && remove(img.fingerprint)}
                  className={dangerBtn}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <ImageDetail
          tools={tools}
          image={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

const CopyImageForm: React.FC<{ tools: Tools; onDone: () => void }> = ({
  tools,
  onDone,
}) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [server, setServer] = useState("https://images.linuxcontainers.org");
  const [protocol, setProtocol] = useState("simplestreams");
  const [alias, setAlias] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  const submit = useCallback(async () => {
    await run(() =>
      api.copyImageFromRemote(
        server,
        protocol,
        autoUpdate,
        isPublic,
        alias.trim() || undefined,
        fingerprint.trim() || undefined,
      ),
    );
    onDone();
  }, [api, run, server, protocol, autoUpdate, isPublic, alias, fingerprint, onDone]);

  return (
    <div className="mb-3 rounded border border-[var(--color-border)] p-3">
      <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
        {t("integrations.lxd.images.copyFromRemote", "Copy from remote")}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.images.server", "Remote server")}
          </label>
          <input
            className={inputClass}
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.images.protocol", "Protocol")}
          </label>
          <input
            className={inputClass}
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.images.alias", "Alias")}
          </label>
          <input
            className={inputClass}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="ubuntu/22.04"
          />
        </div>
        <div>
          <label className={labelClass}>
            {t("integrations.lxd.images.fingerprint", "Fingerprint")}
          </label>
          <input
            className={inputClass}
            value={fingerprint}
            onChange={(e) => setFingerprint(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-textSecondary)]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
          />
          {t("integrations.lxd.images.autoUpdate", "Auto-update")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          {t("integrations.lxd.images.public", "Public")}
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={submit}
          disabled={!server.trim() || !protocol.trim()}
          className={primaryBtn}
        >
          {t("integrations.lxd.images.copy", "Copy")}
        </button>
      </div>
    </div>
  );
};

const CreateAliasForm: React.FC<{ tools: Tools; onDone: () => void }> = ({
  tools,
  onDone,
}) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");

  const submit = useCallback(async () => {
    const req: CreateImageAliasRequest = {
      name: name.trim(),
      target: target.trim(),
      description: description.trim() || undefined,
    };
    await run(() => api.createImageAlias(req));
    setName("");
    setTarget("");
    setDescription("");
    onDone();
  }, [api, run, name, target, description, onDone]);

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
        {t("integrations.lxd.images.createAlias", "Create alias")}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("integrations.lxd.images.name", "Name")}
        />
        <input
          className={inputClass}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={t("integrations.lxd.images.target", "Target fingerprint")}
        />
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("integrations.lxd.images.description", "Description")}
        />
      </div>
      <button
        onClick={submit}
        disabled={!name.trim() || !target.trim()}
        className={`${primaryBtn} mt-2`}
      >
        <Plus size={12} />
        {t("integrations.lxd.images.create", "Create")}
      </button>
    </div>
  );
};

const ImageDetail: React.FC<{
  tools: Tools;
  image: LxdImage;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tools, image, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [isPublic, setIsPublic] = useState(!!image.public);
  const [autoUpdate, setAutoUpdate] = useState(!!image.auto_update);
  const [propsJson, setPropsJson] = useState(
    JSON.stringify(image.properties ?? {}, null, 2),
  );
  const [parseErr, setParseErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    let properties: Record<string, string>;
    try {
      properties = (parseJsonMaybe(propsJson) ?? {}) as Record<string, string>;
      setParseErr(null);
    } catch (e) {
      setParseErr((e as Error).message);
      return;
    }
    if (!image.fingerprint) return;
    await run(() =>
      api.updateImage(image.fingerprint as string, properties, isPublic, autoUpdate),
    );
    onSaved();
  }, [api, run, image.fingerprint, propsJson, isPublic, autoUpdate, onSaved]);

  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="truncate text-xs font-semibold text-[var(--color-text)]">
          {image.fingerprint?.slice(0, 20)}
        </h4>
        <button onClick={onClose} className={ghostBtn}>
          <X size={12} />
        </button>
      </div>
      <div className="mb-2 flex items-center gap-4 text-xs text-[var(--color-textSecondary)]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          {t("integrations.lxd.images.public", "Public")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
          />
          {t("integrations.lxd.images.autoUpdate", "Auto-update")}
        </label>
      </div>
      <label className={labelClass}>
        {t("integrations.lxd.images.properties", "Properties (JSON)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={5}
        value={propsJson}
        onChange={(e) => setPropsJson(e.target.value)}
      />
      {parseErr && <p className="mt-1 text-xs text-red-500">{parseErr}</p>}
      <button onClick={save} className={`${primaryBtn} mt-2`}>
        {t("integrations.lxd.images.update", "Update")}
      </button>
    </div>
  );
};

// ─── Profiles ───────────────────────────────────────────────────────────────

const ProfilesSection: React.FC<{ tools: Tools }> = ({ tools }) => {
  const { t } = useTranslation();
  const { api, run, loading } = tools;
  const [profiles, setProfiles] = useState<LxdProfile[]>([]);
  const [selected, setSelected] = useState<LxdProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    const res = await run(() => api.listProfiles());
    if (res) setProfiles(res);
  }, [api, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (name: string) => {
      const p = await run(() => api.getProfile(name));
      if (p) setSelected(p);
    },
    [api, run],
  );

  const remove = useCallback(
    async (name: string) => {
      await run(() => api.deleteProfile(name));
      await refresh();
    },
    [api, run, refresh],
  );

  const rename = useCallback(
    async (name: string) => {
      const newName = window.prompt(
        t("integrations.lxd.images.renamePrompt", "New name"),
        name,
      );
      if (!newName || newName === name) return;
      await run(() => api.renameProfile(name, newName));
      await refresh();
    },
    [api, run, refresh, t],
  );

  return (
    <div>
      <SectionToolbar
        title={t("integrations.lxd.images.sectionProfiles", "Profiles")}
        loading={loading}
        onRefresh={refresh}
        onCreate={() => setShowCreate((v) => !v)}
        createLabel={t("integrations.lxd.images.createProfile", "New profile")}
      />
      {showCreate && (
        <CreateProfileForm
          tools={tools}
          onDone={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
      {profiles.length === 0 ? (
        <EmptyRow
          text={t("integrations.lxd.images.emptyProfiles", "No profiles.")}
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {profiles.map((p) => (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2 py-2"
            >
              <button
                onClick={() => open(p.name)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-[var(--color-text)]">
                  {p.name}
                </div>
                <div className="truncate text-[11px] text-[var(--color-textSecondary)]">
                  {p.description || t("integrations.lxd.images.noDescription", "No description")}
                  {p.used_by?.length
                    ? ` · ${p.used_by.length} ${t("integrations.lxd.images.usedBy", "used by")}`
                    : ""}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => rename(p.name)} className={ghostBtn}>
                  {t("integrations.lxd.images.rename", "Rename")}
                </button>
                <button onClick={() => remove(p.name)} className={dangerBtn}>
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <ProfileDetail
          tools={tools}
          profile={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

const CreateProfileForm: React.FC<{ tools: Tools; onDone: () => void }> = ({
  tools,
  onDone,
}) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [configJson, setConfigJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    let config: Record<string, string> | undefined;
    try {
      config = parseJsonMaybe(configJson) as Record<string, string> | undefined;
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const req: CreateProfileRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      config,
    };
    await run(() => api.createProfile(req));
    onDone();
  }, [api, run, name, description, configJson, onDone]);

  return (
    <div className="mb-3 rounded border border-[var(--color-border)] p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("integrations.lxd.images.name", "Name")}
        />
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("integrations.lxd.images.description", "Description")}
        />
      </div>
      <label className={`${labelClass} mt-2`}>
        {t("integrations.lxd.images.config", "Config (JSON, optional)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={3}
        value={configJson}
        onChange={(e) => setConfigJson(e.target.value)}
        placeholder='{ "limits.cpu": "2" }'
      />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      <button
        onClick={submit}
        disabled={!name.trim()}
        className={`${primaryBtn} mt-2`}
      >
        <Plus size={12} />
        {t("integrations.lxd.images.create", "Create")}
      </button>
    </div>
  );
};

const ProfileDetail: React.FC<{
  tools: Tools;
  profile: LxdProfile;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tools, profile, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [description, setDescription] = useState(profile.description ?? "");
  const [configJson, setConfigJson] = useState(
    JSON.stringify(profile.config ?? {}, null, 2),
  );
  const [devicesJson, setDevicesJson] = useState(
    JSON.stringify(profile.devices ?? {}, null, 2),
  );
  const [patchJson, setPatchJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const update = useCallback(async () => {
    let config: Record<string, string> | undefined;
    let devices: Record<string, Record<string, string>> | undefined;
    try {
      config = parseJsonMaybe(configJson) as Record<string, string> | undefined;
      devices = parseJsonMaybe(devicesJson) as
        | Record<string, Record<string, string>>
        | undefined;
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const req: UpdateProfileRequest = {
      name: profile.name,
      description: description.trim() || undefined,
      config,
      devices,
    };
    await run(() => api.updateProfile(req));
    onSaved();
  }, [api, run, profile.name, description, configJson, devicesJson, onSaved]);

  const patch = useCallback(async () => {
    let body: Record<string, unknown> | undefined;
    try {
      body = parseJsonMaybe(patchJson);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!body) return;
    await run(() => api.patchProfile(profile.name, body as Record<string, unknown>));
    onSaved();
  }, [api, run, profile.name, patchJson, onSaved]);

  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="truncate text-xs font-semibold text-[var(--color-text)]">
          {profile.name}
        </h4>
        <button onClick={onClose} className={ghostBtn}>
          <X size={12} />
        </button>
      </div>
      <label className={labelClass}>
        {t("integrations.lxd.images.description", "Description")}
      </label>
      <input
        className={inputClass}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label className={`${labelClass} mt-2`}>
        {t("integrations.lxd.images.config", "Config (JSON)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={4}
        value={configJson}
        onChange={(e) => setConfigJson(e.target.value)}
      />
      <label className={`${labelClass} mt-2`}>
        {t("integrations.lxd.images.devices", "Devices (JSON)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={4}
        value={devicesJson}
        onChange={(e) => setDevicesJson(e.target.value)}
      />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={update} className={primaryBtn}>
          {t("integrations.lxd.images.update", "Update")}
        </button>
      </div>
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <label className={labelClass}>
          {t("integrations.lxd.images.patchJson", "Patch (JSON — partial merge)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={3}
          value={patchJson}
          onChange={(e) => setPatchJson(e.target.value)}
          placeholder='{ "config": { "limits.cpu": "4" } }'
        />
        <button
          onClick={patch}
          disabled={!patchJson.trim()}
          className={`${ghostBtn} mt-2`}
        >
          {t("integrations.lxd.images.patch", "Patch")}
        </button>
      </div>
    </div>
  );
};

// ─── Projects ───────────────────────────────────────────────────────────────

const ProjectsSection: React.FC<{ tools: Tools }> = ({ tools }) => {
  const { t } = useTranslation();
  const { api, run, loading } = tools;
  const [projects, setProjects] = useState<LxdProject[]>([]);
  const [selected, setSelected] = useState<LxdProject | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    const res = await run(() => api.listProjects());
    if (res) setProjects(res);
  }, [api, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (name: string) => {
      const p = await run(() => api.getProject(name));
      if (p) setSelected(p);
    },
    [api, run],
  );

  const remove = useCallback(
    async (name: string) => {
      await run(() => api.deleteProject(name));
      await refresh();
    },
    [api, run, refresh],
  );

  const rename = useCallback(
    async (name: string) => {
      const newName = window.prompt(
        t("integrations.lxd.images.renamePrompt", "New name"),
        name,
      );
      if (!newName || newName === name) return;
      await run(() => api.renameProject(name, newName));
      await refresh();
    },
    [api, run, refresh, t],
  );

  return (
    <div>
      <SectionToolbar
        title={t("integrations.lxd.images.sectionProjects", "Projects")}
        loading={loading}
        onRefresh={refresh}
        onCreate={() => setShowCreate((v) => !v)}
        createLabel={t("integrations.lxd.images.createProject", "New project")}
      />
      {showCreate && (
        <CreateProjectForm
          tools={tools}
          onDone={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
      {projects.length === 0 ? (
        <EmptyRow
          text={t("integrations.lxd.images.emptyProjects", "No projects.")}
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {projects.map((p) => (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2 py-2"
            >
              <button
                onClick={() => open(p.name)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-[var(--color-text)]">
                  {p.name}
                </div>
                <div className="truncate text-[11px] text-[var(--color-textSecondary)]">
                  {p.description || t("integrations.lxd.images.noDescription", "No description")}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => rename(p.name)} className={ghostBtn}>
                  {t("integrations.lxd.images.rename", "Rename")}
                </button>
                <button onClick={() => remove(p.name)} className={dangerBtn}>
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <ProjectDetail
          tools={tools}
          project={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

const CreateProjectForm: React.FC<{ tools: Tools; onDone: () => void }> = ({
  tools,
  onDone,
}) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [configJson, setConfigJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    let config: Record<string, string> | undefined;
    try {
      config = parseJsonMaybe(configJson) as Record<string, string> | undefined;
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const req: CreateProjectRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      config,
    };
    await run(() => api.createProject(req));
    onDone();
  }, [api, run, name, description, configJson, onDone]);

  return (
    <div className="mb-3 rounded border border-[var(--color-border)] p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("integrations.lxd.images.name", "Name")}
        />
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("integrations.lxd.images.description", "Description")}
        />
      </div>
      <label className={`${labelClass} mt-2`}>
        {t("integrations.lxd.images.config", "Config (JSON, optional)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={3}
        value={configJson}
        onChange={(e) => setConfigJson(e.target.value)}
        placeholder='{ "features.images": "true" }'
      />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      <button
        onClick={submit}
        disabled={!name.trim()}
        className={`${primaryBtn} mt-2`}
      >
        <Plus size={12} />
        {t("integrations.lxd.images.create", "Create")}
      </button>
    </div>
  );
};

const ProjectDetail: React.FC<{
  tools: Tools;
  project: LxdProject;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tools, project, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [bodyJson, setBodyJson] = useState(
    JSON.stringify(
      {
        description: project.description ?? "",
        config: project.config ?? {},
      },
      null,
      2,
    ),
  );
  const [patchJson, setPatchJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const update = useCallback(async () => {
    let body: Record<string, unknown> | undefined;
    try {
      body = parseJsonMaybe(bodyJson);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!body) return;
    await run(() => api.updateProject(project.name, body as Record<string, unknown>));
    onSaved();
  }, [api, run, project.name, bodyJson, onSaved]);

  const patch = useCallback(async () => {
    let body: Record<string, unknown> | undefined;
    try {
      body = parseJsonMaybe(patchJson);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!body) return;
    await run(() => api.patchProject(project.name, body as Record<string, unknown>));
    onSaved();
  }, [api, run, project.name, patchJson, onSaved]);

  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="truncate text-xs font-semibold text-[var(--color-text)]">
          {project.name}
        </h4>
        <button onClick={onClose} className={ghostBtn}>
          <X size={12} />
        </button>
      </div>
      <label className={labelClass}>
        {t("integrations.lxd.images.bodyJson", "Definition (JSON — full update)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={6}
        value={bodyJson}
        onChange={(e) => setBodyJson(e.target.value)}
      />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={update} className={primaryBtn}>
          {t("integrations.lxd.images.update", "Update")}
        </button>
      </div>
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <label className={labelClass}>
          {t("integrations.lxd.images.patchJson", "Patch (JSON — partial merge)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={3}
          value={patchJson}
          onChange={(e) => setPatchJson(e.target.value)}
        />
        <button
          onClick={patch}
          disabled={!patchJson.trim()}
          className={`${ghostBtn} mt-2`}
        >
          {t("integrations.lxd.images.patch", "Patch")}
        </button>
      </div>
    </div>
  );
};

// ─── Certificates ─────────────────────────────────────────────────────────────

const CertificatesSection: React.FC<{ tools: Tools }> = ({ tools }) => {
  const { t } = useTranslation();
  const { api, run, loading } = tools;
  const [certs, setCerts] = useState<LxdCertificate[]>([]);
  const [selected, setSelected] = useState<LxdCertificate | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    const res = await run(() => api.listCertificates());
    if (res) setCerts(res);
  }, [api, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (fingerprint: string) => {
      const c = await run(() => api.getCertificate(fingerprint));
      if (c) setSelected(c);
    },
    [api, run],
  );

  const remove = useCallback(
    async (fingerprint: string) => {
      await run(() => api.deleteCertificate(fingerprint));
      await refresh();
    },
    [api, run, refresh],
  );

  return (
    <div>
      <SectionToolbar
        title={t("integrations.lxd.images.sectionCertificates", "Certificates")}
        loading={loading}
        onRefresh={refresh}
        onCreate={() => setShowAdd((v) => !v)}
        createLabel={t("integrations.lxd.images.addCertificate", "Add certificate")}
      />
      {showAdd && (
        <AddCertificateForm
          tools={tools}
          onDone={() => {
            setShowAdd(false);
            void refresh();
          }}
        />
      )}
      {certs.length === 0 ? (
        <EmptyRow
          text={t("integrations.lxd.images.emptyCertificates", "No certificates.")}
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {certs.map((c) => (
            <li
              key={c.fingerprint ?? Math.random()}
              className="flex items-center justify-between gap-2 py-2"
            >
              <button
                onClick={() => c.fingerprint && open(c.fingerprint)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-[var(--color-text)]">
                  {c.name || c.fingerprint?.slice(0, 16) || "—"}
                </div>
                <div className="truncate text-[11px] text-[var(--color-textSecondary)]">
                  {c.type ?? "client"}
                  {c.restricted ? ` · ${t("integrations.lxd.images.restricted", "restricted")}` : ""}
                </div>
              </button>
              <button
                onClick={() => c.fingerprint && remove(c.fingerprint)}
                className={dangerBtn}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <CertificateDetail
          tools={tools}
          cert={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

const AddCertificateForm: React.FC<{ tools: Tools; onDone: () => void }> = ({
  tools,
  onDone,
}) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [name, setName] = useState("");
  const [certificate, setCertificate] = useState("");
  const [password, setPassword] = useState("");
  const [restricted, setRestricted] = useState(false);

  const submit = useCallback(async () => {
    const req: AddCertificateRequest = {
      name: name.trim(),
      certificate: certificate.trim(),
      password: password.trim() || undefined,
      restricted,
    };
    await run(() => api.addCertificate(req));
    onDone();
  }, [api, run, name, certificate, password, restricted, onDone]);

  return (
    <div className="mb-3 rounded border border-[var(--color-border)] p-3">
      <input
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("integrations.lxd.images.name", "Name")}
      />
      <label className={`${labelClass} mt-2`}>
        {t("integrations.lxd.images.certificate", "Certificate (PEM)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={4}
        value={certificate}
        onChange={(e) => setCertificate(e.target.value)}
        placeholder="-----BEGIN CERTIFICATE-----"
      />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("integrations.lxd.images.password", "Trust token (optional)")}
        />
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={restricted}
            onChange={(e) => setRestricted(e.target.checked)}
          />
          {t("integrations.lxd.images.restricted", "Restricted")}
        </label>
      </div>
      <button
        onClick={submit}
        disabled={!name.trim() || !certificate.trim()}
        className={`${primaryBtn} mt-2`}
      >
        <Plus size={12} />
        {t("integrations.lxd.images.add", "Add")}
      </button>
    </div>
  );
};

const CertificateDetail: React.FC<{
  tools: Tools;
  cert: LxdCertificate;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tools, cert, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { api, run } = tools;
  const [patchJson, setPatchJson] = useState(
    JSON.stringify(
      {
        name: cert.name ?? "",
        restricted: cert.restricted ?? false,
        projects: cert.projects ?? [],
      },
      null,
      2,
    ),
  );
  const [err, setErr] = useState<string | null>(null);

  const update = useCallback(async () => {
    let patch: Record<string, unknown> | undefined;
    try {
      patch = parseJsonMaybe(patchJson);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!patch || !cert.fingerprint) return;
    await run(() =>
      api.updateCertificate(cert.fingerprint as string, patch as Record<string, unknown>),
    );
    onSaved();
  }, [api, run, cert.fingerprint, patchJson, onSaved]);

  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="truncate text-xs font-semibold text-[var(--color-text)]">
          {cert.name || cert.fingerprint?.slice(0, 20)}
        </h4>
        <button onClick={onClose} className={ghostBtn}>
          <X size={12} />
        </button>
      </div>
      <label className={labelClass}>
        {t("integrations.lxd.images.patchJson", "Patch (JSON — partial merge)")}
      </label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={5}
        value={patchJson}
        onChange={(e) => setPatchJson(e.target.value)}
      />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      <button onClick={update} className={`${primaryBtn} mt-2`}>
        {t("integrations.lxd.images.update", "Update")}
      </button>
    </div>
  );
};

export default LxdImagesTab;
