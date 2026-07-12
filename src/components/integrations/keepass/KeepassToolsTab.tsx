// KeePass — "Tools & Security" sub-tab (t42-keepass-c2).
//
// Full-depth binding of the sorng-keepass `tools` command category (~45 cmds):
// search/filter, attachments, the password toolkit (generate/analyze/health/
// profiles), OTP, auto-type, key files, import/export, recent databases, the
// change log, settings and service shutdown. Each command group is a collapsible
// section; every command is wired to a control and renders its result.
//
// Data flow: `useKeepassTools()` gives each section an independent loading/error
// lifecycle plus `run(api => ...)`; the shell routes the open database id in via
// `dbId` (KeepassTabProps).

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Search,
  Paperclip,
  KeyRound,
  ShieldCheck,
  Clock3,
  FileKey2,
  ArrowLeftRight,
  History,
  Settings2,
  Loader2,
  Power,
} from "lucide-react";
import type { EntrySummary, TagCount } from "../../../types/keepass";
import type { KeepassTabProps } from "./registry";
import type {
  AutoTypeMatch,
  AutoTypeToken,
  ChangeLogEntry,
  CharacterSet,
  DuplicateHandling,
  ExportConfig,
  ExportFormat,
  GeneratedPassword,
  ImportConfig,
  ImportFormat,
  ImportResult,
  KeePassAttachment,
  KeyFileFormat,
  KeyFileInfo,
  OtpValue,
  PasswordAnalysis,
  PasswordGeneratorRequest,
  PasswordGenMode,
  PasswordHealthReport,
  PasswordProfile,
  PasswordStrength,
  RecentDatabase,
  SearchQuery,
  SearchResult,
} from "../../../types/keepass/tools";
import { useKeepassTools } from "../../../hooks/integration/keepass/useKeepassTools";

// ─── Shared styling / primitives ──────────────────────────────────────────────

const inputCls =
  "min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50";
const ghostBtnCls = "app-bar-button px-2.5 py-1 text-xs";
const labelCls = "text-xs font-medium text-[var(--color-textSecondary)]";

function Section({
  title,
  icon: Icon,
  testId,
  defaultOpen,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-b border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
        data-testid={`keepass-tools-section-${testId}`}
      >
        <Icon className="h-4 w-4 text-primary" />
        {title}
        <ChevronDown
          className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

function StatusLine({
  isLoading,
  error,
}: {
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading)
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (error)
    return (
      <span className="text-xs text-red-400" data-testid="keepass-tools-error">
        {error}
      </span>
    );
  return null;
}

function ResultBox({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <pre className="max-h-56 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-input)] p-2 text-[11px] leading-tight text-[var(--color-textSecondary)]">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EntryList({ entries }: { entries: EntrySummary[] }) {
  if (entries.length === 0)
    return (
      <p className="text-xs text-[var(--color-textMuted)]">No entries.</p>
    );
  return (
    <ul className="max-h-56 divide-y divide-[var(--color-border)] overflow-auto rounded border border-[var(--color-border)]">
      {entries.map((e) => (
        <li key={e.uuid} className="px-2 py-1 text-xs text-[var(--color-text)]">
          <span className="font-medium">{e.title || "(untitled)"}</span>
          {e.username && (
            <span className="text-[var(--color-textMuted)]">
              {" "}
              · {e.username}
            </span>
          )}
          {e.isExpired && <span className="text-red-400"> · expired</span>}
        </li>
      ))}
    </ul>
  );
}

// ─── Search & filter ──────────────────────────────────────────────────────────

const SEARCH_STRENGTHS: PasswordStrength[] = [
  "VeryWeak",
  "Weak",
  "Fair",
  "Strong",
  "VeryStrong",
];

function SearchSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [term, setTerm] = useState("");
  const [advText, setAdvText] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("");
  const [days, setDays] = useState(30);
  const [maxStrength, setMaxStrength] = useState<PasswordStrength>("Weak");
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [duplicates, setDuplicates] = useState<EntrySummary[][] | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  const setList = (v: EntrySummary[] | undefined) => {
    if (v) {
      setEntries(v);
      setDuplicates(null);
      setTags(null);
    }
  };

  return (
    <Section
      title={t("integrations.keepass.tools.search.title", "Search & Filter")}
      icon={Search}
      testId="search"
      defaultOpen
    >
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.search.quickPlaceholder",
            "Quick search…",
          )}
          data-testid="keepass-tools-search-term"
        />
        <button
          type="button"
          className={btnCls}
          data-testid="keepass-tools-quick-search"
          onClick={async () =>
            setList(await run((api) => api.quickSearch(dbId, term)))
          }
        >
          {t("integrations.keepass.tools.search.go", "Search")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          value={advText}
          onChange={(e) => setAdvText(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.search.advancedPlaceholder",
            "Advanced search text…",
          )}
        />
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={isRegex}
            onChange={(e) => setIsRegex(e.target.checked)}
          />
          {t("integrations.keepass.tools.search.regex", "Regex")}
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          {t("integrations.keepass.tools.search.caseSensitive", "Case")}
        </label>
        <button
          type="button"
          className={btnCls}
          onClick={async () => {
            const query: SearchQuery = {
              text: advText || undefined,
              isRegex,
              caseSensitive,
              includeSubgroups: true,
              excludeExpired: false,
              onlyExpired: false,
              limit: 200,
            };
            const r = await run((api) => api.searchEntries(dbId, query));
            if (r) {
              setResult(r);
              setList(r.entries);
            }
          }}
        >
          {t("integrations.keepass.tools.search.advanced", "Advanced")}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.search.urlPlaceholder",
            "https://example.com",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setList(await run((api) => api.findEntriesForUrl(dbId, url)))
          }
        >
          {t("integrations.keepass.tools.search.byUrl", "By URL")}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.search.tagPlaceholder",
            "tag",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setList(await run((api) => api.findEntriesByTag(dbId, tag)))
          }
        >
          {t("integrations.keepass.tools.search.byTag", "By tag")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.getAllTags(dbId));
            if (r) {
              setTags(r);
              setDuplicates(null);
            }
          }}
        >
          {t("integrations.keepass.tools.search.allTags", "All tags")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={labelCls}>
          {t("integrations.keepass.tools.search.expiringIn", "Expiring in")}
        </span>
        <input
          type="number"
          className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <span className={labelCls}>
          {t("integrations.keepass.tools.search.days", "days")}
        </span>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setList(await run((api) => api.findExpiringEntries(dbId, days)))
          }
        >
          {t("integrations.keepass.tools.search.findExpiring", "Find")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={maxStrength}
          onChange={(e) => setMaxStrength(e.target.value as PasswordStrength)}
        >
          {SEARCH_STRENGTHS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setList(await run((api) => api.findWeakPasswords(dbId, maxStrength)))
          }
        >
          {t("integrations.keepass.tools.search.weak", "Weak ≤")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setList(await run((api) => api.findEntriesWithoutPassword(dbId)))
          }
        >
          {t("integrations.keepass.tools.search.noPassword", "No password")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.findDuplicates(dbId));
            if (r) {
              setDuplicates(r);
              setTags(null);
            }
          }}
        >
          {t("integrations.keepass.tools.search.duplicates", "Duplicates")}
        </button>
      </div>

      <StatusLine isLoading={isLoading} error={error} />
      {result && (
        <p className="text-xs text-[var(--color-textMuted)]">
          {result.totalMatches}{" "}
          {t("integrations.keepass.tools.search.matches", "matches")} ·{" "}
          {result.searchTimeMs}ms
        </p>
      )}
      {tags ? (
        <ResultBox value={tags} />
      ) : duplicates ? (
        <ResultBox value={duplicates} />
      ) : (
        <EntryList entries={entries} />
      )}
    </Section>
  );
}

// ─── Attachments ──────────────────────────────────────────────────────────────

function AttachmentsSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [entryUuid, setEntryUuid] = useState("");
  const [attachments, setAttachments] = useState<KeePassAttachment[]>([]);
  const [textName, setTextName] = useState("note.txt");
  const [textBody, setTextBody] = useState("");
  const [poolInfo, setPoolInfo] = useState<unknown>(null);

  const list = useCallback(async () => {
    const r = await run((api) => api.getEntryAttachments(dbId, entryUuid));
    if (r) setAttachments(r);
  }, [run, dbId, entryUuid]);

  return (
    <Section
      title={t("integrations.keepass.tools.attachments.title", "Attachments")}
      icon={Paperclip}
      testId="attachments"
    >
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={entryUuid}
          onChange={(e) => setEntryUuid(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.attachments.entryUuid",
            "Entry UUID",
          )}
        />
        <button type="button" className={btnCls} onClick={list}>
          {t("integrations.keepass.tools.attachments.list", "List")}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const selected = await openFileDialog({ multiple: false });
            if (typeof selected === "string") {
              await run((api) =>
                api.importAttachmentFromFile(dbId, entryUuid, selected),
              );
              await list();
            }
          }}
        >
          {t("integrations.keepass.tools.attachments.importFile", "Import file")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="w-32 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={textName}
          onChange={(e) => setTextName(e.target.value)}
          placeholder="filename"
        />
        <input
          className={inputCls}
          value={textBody}
          onChange={(e) => setTextBody(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.attachments.textBody",
            "Inline text content…",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            await run((api) =>
              api.addAttachment(dbId, {
                entryUuid,
                filename: textName,
                dataBase64: btoa(unescape(encodeURIComponent(textBody))),
              }),
            );
            await list();
          }}
        >
          {t("integrations.keepass.tools.attachments.addText", "Add text")}
        </button>
      </div>

      {attachments.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {attachments.map((a) => (
            <li
              key={a.refId}
              className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <span className="font-medium">{a.filename}</span>
              <span className="text-[var(--color-textMuted)]">
                {a.mimeType} · {a.size}B
              </span>
              <button
                type="button"
                className="ml-auto text-primary"
                onClick={() => run((api) => api.getAttachmentData(dbId, entryUuid, a.refId))}
              >
                {t("integrations.keepass.tools.attachments.read", "Read")}
              </button>
              <button
                type="button"
                className="text-primary"
                onClick={async () => {
                  const out = await saveFileDialog({ defaultPath: a.filename });
                  if (typeof out === "string")
                    await run((api) =>
                      api.saveAttachmentToFile(dbId, entryUuid, a.refId, out),
                    );
                }}
              >
                {t("integrations.keepass.tools.attachments.save", "Save")}
              </button>
              <button
                type="button"
                className="text-primary"
                onClick={async () => {
                  const name = window.prompt(
                    t(
                      "integrations.keepass.tools.attachments.newName",
                      "New filename",
                    ),
                    a.filename,
                  );
                  if (name) {
                    await run((api) =>
                      api.renameAttachment(dbId, entryUuid, a.refId, name),
                    );
                    await list();
                  }
                }}
              >
                {t("integrations.keepass.tools.attachments.rename", "Rename")}
              </button>
              <button
                type="button"
                className="text-red-400"
                onClick={async () => {
                  await run((api) =>
                    api.removeAttachment(dbId, entryUuid, a.refId),
                  );
                  await list();
                }}
              >
                {t("integrations.keepass.tools.attachments.remove", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setPoolInfo(await run((api) => api.getAttachmentPoolSize(dbId)))
          }
        >
          {t("integrations.keepass.tools.attachments.poolSize", "Pool size")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setPoolInfo(await run((api) => api.compactAttachmentPool(dbId)))
          }
        >
          {t("integrations.keepass.tools.attachments.compact", "Compact pool")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () =>
            setPoolInfo(await run((api) => api.verifyAttachmentIntegrity(dbId)))
          }
        >
          {t("integrations.keepass.tools.attachments.verify", "Verify integrity")}
        </button>
      </div>
      <StatusLine isLoading={isLoading} error={error} />
      <ResultBox value={poolInfo} />
    </Section>
  );
}

// ─── Password toolkit ─────────────────────────────────────────────────────────

const GEN_MODES: PasswordGenMode[] = ["CharacterSet", "Pattern", "Passphrase"];
const CHAR_SETS: CharacterSet[] = [
  "UpperCase",
  "LowerCase",
  "Digits",
  "Special",
];

function PasswordSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [mode, setMode] = useState<PasswordGenMode>("CharacterSet");
  const [length, setLength] = useState(20);
  const [sets, setSets] = useState<CharacterSet[]>([
    "UpperCase",
    "LowerCase",
    "Digits",
    "Special",
  ]);
  const [pattern, setPattern] = useState("");
  const [excludeLookalikes, setExcludeLookalikes] = useState(true);
  const [count, setCount] = useState(1);
  const [generated, setGenerated] = useState<GeneratedPassword[]>([]);
  const [analyzeInput, setAnalyzeInput] = useState("");
  const [analysis, setAnalysis] = useState<PasswordAnalysis | null>(null);
  const [health, setHealth] = useState<PasswordHealthReport | null>(null);
  const [profiles, setProfiles] = useState<PasswordProfile[] | null>(null);

  const buildReq = (): PasswordGeneratorRequest => ({
    mode,
    length,
    characterSets: mode === "CharacterSet" ? sets : undefined,
    pattern: mode === "Pattern" ? pattern : undefined,
    excludeLookalikes,
    ensureEachSet: true,
    count: count > 1 ? count : undefined,
  });

  const toggleSet = (s: CharacterSet) =>
    setSets((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );

  return (
    <Section
      title={t("integrations.keepass.tools.password.title", "Password Toolkit")}
      icon={KeyRound}
      testId="password"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={mode}
          onChange={(e) => setMode(e.target.value as PasswordGenMode)}
        >
          {GEN_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className={labelCls}>
          {t("integrations.keepass.tools.password.length", "Length")}
        </span>
        <input
          type="number"
          className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
        />
        <span className={labelCls}>
          {t("integrations.keepass.tools.password.count", "Count")}
        </span>
        <input
          type="number"
          className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </div>

      {mode === "CharacterSet" && (
        <div className="flex flex-wrap gap-3">
          {CHAR_SETS.map((s) => (
            <label
              key={s}
              className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]"
            >
              <input
                type="checkbox"
                checked={sets.includes(s)}
                onChange={() => toggleSet(s)}
              />
              {s}
            </label>
          ))}
          <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={excludeLookalikes}
              onChange={(e) => setExcludeLookalikes(e.target.checked)}
            />
            {t(
              "integrations.keepass.tools.password.excludeLookalikes",
              "No look-alikes",
            )}
          </label>
        </div>
      )}
      {mode === "Pattern" && (
        <input
          className={inputCls}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.password.patternPlaceholder",
            "e.g. Aaaa-9999",
          )}
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={btnCls}
          data-testid="keepass-tools-generate"
          onClick={async () => {
            const r = await run((api) => api.generatePassword(buildReq()));
            if (r) setGenerated([r]);
          }}
        >
          {t("integrations.keepass.tools.password.generate", "Generate")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.generatePasswords(buildReq()));
            if (r) setGenerated(r);
          }}
        >
          {t("integrations.keepass.tools.password.generateMany", "Generate ×N")}
        </button>
      </div>
      {generated.length > 0 && (
        <ul className="space-y-1">
          {generated.map((g, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 font-mono text-xs text-[var(--color-text)]"
            >
              <span className="truncate">{g.password}</span>
              <span className="ml-auto shrink-0 text-[var(--color-textMuted)]">
                {g.strength} · {g.entropyBits.toFixed(0)} bits
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={analyzeInput}
          onChange={(e) => setAnalyzeInput(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.password.analyzePlaceholder",
            "Password to analyze…",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.analyzePassword(analyzeInput));
            if (r) setAnalysis(r);
          }}
        >
          {t("integrations.keepass.tools.password.analyze", "Analyze")}
        </button>
      </div>
      {analysis && <ResultBox value={analysis} />}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.passwordHealthReport(dbId));
            if (r) setHealth(r);
          }}
        >
          {t("integrations.keepass.tools.password.health", "Health report")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.listPasswordProfiles());
            if (r) setProfiles(r);
          }}
        >
          {t("integrations.keepass.tools.password.profiles", "Profiles")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const name = window.prompt(
              t(
                "integrations.keepass.tools.password.profileName",
                "Profile name",
              ),
            );
            if (name) {
              const now = new Date().toISOString();
              const profile: PasswordProfile = {
                id: name,
                name,
                description: "",
                config: buildReq(),
                isBuiltin: false,
                createdAt: now,
                modifiedAt: now,
              };
              await run((api) => api.addPasswordProfile(profile));
              setProfiles(await run((api) => api.listPasswordProfiles()) ?? null);
            }
          }}
        >
          {t("integrations.keepass.tools.password.saveProfile", "Save profile")}
        </button>
      </div>
      {health && <ResultBox value={health} />}
      {profiles && (
        <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {profiles.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <span className="font-medium">{p.name}</span>
              {p.isBuiltin && (
                <span className="text-[var(--color-textMuted)]">
                  {t("integrations.keepass.tools.password.builtin", "built-in")}
                </span>
              )}
              {!p.isBuiltin && (
                <button
                  type="button"
                  className="ml-auto text-red-400"
                  onClick={async () => {
                    await run((api) => api.removePasswordProfile(p.name));
                    setProfiles(
                      (await run((api) => api.listPasswordProfiles())) ?? null,
                    );
                  }}
                >
                  {t("integrations.keepass.tools.password.remove", "Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <StatusLine isLoading={isLoading} error={error} />
    </Section>
  );
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

function OtpSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [entryUuid, setEntryUuid] = useState("");
  const [otp, setOtp] = useState<OtpValue | null>(null);

  return (
    <Section
      title={t("integrations.keepass.tools.otp.title", "One-Time Passwords")}
      icon={Clock3}
      testId="otp"
    >
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={entryUuid}
          onChange={(e) => setEntryUuid(e.target.value)}
          placeholder={t("integrations.keepass.tools.otp.entryUuid", "Entry UUID")}
        />
        <button
          type="button"
          className={btnCls}
          onClick={async () => {
            const r = await run((api) => api.getEntryOtp(dbId, entryUuid));
            if (r) setOtp(r);
          }}
        >
          {t("integrations.keepass.tools.otp.get", "Get code")}
        </button>
      </div>
      {otp && (
        <div className="flex items-center gap-2 font-mono text-lg text-[var(--color-text)]">
          {otp.code}
          {otp.remainingSeconds != null && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {otp.remainingSeconds}s
            </span>
          )}
        </div>
      )}
      <StatusLine isLoading={isLoading} error={error} />
    </Section>
  );
}

// ─── Auto-type ────────────────────────────────────────────────────────────────

function AutoTypeSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [sequence, setSequence] = useState("");
  const [entryUuid, setEntryUuid] = useState("");
  const [windowTitle, setWindowTitle] = useState("");
  const [tokens, setTokens] = useState<AutoTypeToken[] | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [matches, setMatches] = useState<AutoTypeMatch[] | null>(null);

  return (
    <Section
      title={t("integrations.keepass.tools.autotype.title", "Auto-Type")}
      icon={ArrowLeftRight}
      testId="autotype"
    >
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          placeholder="{USERNAME}{TAB}{PASSWORD}{ENTER}"
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.parseAutotypeSequence(sequence));
            if (r) setTokens(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.parse", "Parse")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.validateAutotypeSequence(sequence));
            if (r) setIssues(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.validate", "Validate")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.getDefaultAutotypeSequence());
            if (r) setSequence(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.default", "Default")}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={entryUuid}
          onChange={(e) => setEntryUuid(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.autotype.entryUuid",
            "Entry UUID",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) =>
              api.resolveAutotypeSequence(dbId, entryUuid, sequence || undefined),
            );
            if (r) setTokens(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.resolve", "Resolve")}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          className={inputCls}
          value={windowTitle}
          onChange={(e) => setWindowTitle(e.target.value)}
          placeholder={t(
            "integrations.keepass.tools.autotype.windowTitle",
            "Window title",
          )}
        />
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) =>
              api.findAutotypeMatches(dbId, windowTitle),
            );
            if (r) setMatches(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.match", "Match window")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.listAutotypeAssociations(dbId));
            if (r) setMatches(r);
          }}
        >
          {t("integrations.keepass.tools.autotype.associations", "Associations")}
        </button>
      </div>

      <StatusLine isLoading={isLoading} error={error} />
      {tokens && <ResultBox value={tokens} />}
      {issues && (
        <ResultBox
          value={
            issues.length
              ? issues
              : t("integrations.keepass.tools.autotype.valid", "Valid sequence")
          }
        />
      )}
      {matches && <ResultBox value={matches} />}
    </Section>
  );
}

// ─── Key files ────────────────────────────────────────────────────────────────

const KEY_FILE_FORMATS: KeyFileFormat[] = ["Xml", "Binary32", "Hex64", "Random"];

function KeyFileSection() {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [format, setFormat] = useState<KeyFileFormat>("Xml");
  const [info, setInfo] = useState<KeyFileInfo | null>(null);

  return (
    <Section
      title={t("integrations.keepass.tools.keyfile.title", "Key Files")}
      icon={FileKey2}
      testId="keyfile"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={format}
          onChange={(e) => setFormat(e.target.value as KeyFileFormat)}
        >
          {KEY_FILE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btnCls}
          onClick={async () => {
            const out = await saveFileDialog({
              filters: [{ name: "Key file", extensions: ["keyx", "key"] }],
            });
            if (typeof out === "string") {
              const r = await run((api) =>
                api.createKeyFile({ filePath: out, format }),
              );
              if (r) setInfo(r);
            }
          }}
        >
          {t("integrations.keepass.tools.keyfile.create", "Create")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const selected = await openFileDialog({ multiple: false });
            if (typeof selected === "string") {
              const r = await run((api) => api.verifyKeyFile(selected));
              if (r) setInfo(r);
            }
          }}
        >
          {t("integrations.keepass.tools.keyfile.verify", "Verify")}
        </button>
      </div>
      <StatusLine isLoading={isLoading} error={error} />
      {info && <ResultBox value={info} />}
    </Section>
  );
}

// ─── Import / export ──────────────────────────────────────────────────────────

const IMPORT_FORMATS: ImportFormat[] = [
  "KeePassXml",
  "KeePassCsv",
  "GenericCsv",
  "LastPassCsv",
  "BitwardenJson",
  "BitwardenCsv",
  "OnePasswordCsv",
  "ChromeCsv",
  "FirefoxCsv",
  "KeePassXmlV1",
  "Kdbx",
];
const EXPORT_FORMATS: ExportFormat[] = [
  "KeePassXml",
  "KeePassCsv",
  "GenericCsv",
  "Csv",
  "Json",
  "Html",
  "PlainText",
];
const DUPLICATE_MODES: DuplicateHandling[] = [
  "ImportAll",
  "Skip",
  "Replace",
  "KeepBoth",
  "Merge",
];

function ImportExportSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [importFormat, setImportFormat] = useState<ImportFormat>("KeePassCsv");
  const [dupMode, setDupMode] = useState<DuplicateHandling>("Skip");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("KeePassCsv");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportResult, setExportResult] = useState<unknown>(null);

  return (
    <Section
      title={t("integrations.keepass.tools.io.title", "Import / Export")}
      icon={ArrowLeftRight}
      testId="io"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={importFormat}
          onChange={(e) => setImportFormat(e.target.value as ImportFormat)}
        >
          {IMPORT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={dupMode}
          onChange={(e) => setDupMode(e.target.value as DuplicateHandling)}
        >
          {DUPLICATE_MODES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btnCls}
          onClick={async () => {
            const selected = await openFileDialog({ multiple: false });
            if (typeof selected === "string") {
              const config: ImportConfig = {
                format: importFormat,
                filePath: selected,
                duplicateHandling: dupMode,
              };
              const r = await run((api) => api.importEntries(dbId, config));
              if (r) setImportResult(r);
            }
          }}
        >
          {t("integrations.keepass.tools.io.import", "Import…")}
        </button>
      </div>
      {importResult && <ResultBox value={importResult} />}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const out = await saveFileDialog();
            if (typeof out === "string") {
              const config: ExportConfig = {
                format: exportFormat,
                filePath: out,
                includeRecycled: false,
                includeAttachments: true,
                includeHistory: false,
                redactPasswords: false,
              };
              setExportResult(await run((api) => api.exportEntries(dbId, config)));
            }
          }}
        >
          {t("integrations.keepass.tools.io.export", "Export…")}
        </button>
      </div>
      <StatusLine isLoading={isLoading} error={error} />
      {exportResult ? <ResultBox value={exportResult} /> : null}
    </Section>
  );
}

// ─── Recent databases ─────────────────────────────────────────────────────────

function RecentSection() {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [recents, setRecents] = useState<RecentDatabase[] | null>(null);

  const refresh = useCallback(async () => {
    setRecents((await run((api) => api.listRecentDatabases())) ?? null);
  }, [run]);

  return (
    <Section
      title={t("integrations.keepass.tools.recent.title", "Recent Databases")}
      icon={History}
      testId="recent"
    >
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnCls} onClick={refresh}>
          {t("integrations.keepass.tools.recent.list", "List")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const selected = await openFileDialog({
              multiple: false,
              filters: [{ name: "KeePass Database", extensions: ["kdbx"] }],
            });
            if (typeof selected === "string") {
              const name = selected.split(/[/\\]/).pop() ?? selected;
              await run((api) => api.addRecentDatabase(selected, name));
              await refresh();
            }
          }}
        >
          {t("integrations.keepass.tools.recent.add", "Add")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            await run((api) => api.clearRecentDatabases());
            await refresh();
          }}
        >
          {t("integrations.keepass.tools.recent.clear", "Clear all")}
        </button>
      </div>
      {recents && (
        <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {recents.map((r) => (
            <li
              key={r.filePath}
              className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <span className="font-medium">{r.name}</span>
              <span className="truncate text-[var(--color-textMuted)]">
                {r.filePath}
              </span>
              {!r.fileExists && (
                <span className="text-red-400">
                  {t("integrations.keepass.tools.recent.missing", "missing")}
                </span>
              )}
              <button
                type="button"
                className="ml-auto text-red-400"
                onClick={async () => {
                  await run((api) => api.removeRecentDatabase(r.filePath));
                  await refresh();
                }}
              >
                {t("integrations.keepass.tools.recent.remove", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <StatusLine isLoading={isLoading} error={error} />
    </Section>
  );
}

// ─── Change log · settings · service ──────────────────────────────────────────

function MaintenanceSection({ dbId }: { dbId: string }) {
  const { t } = useTranslation();
  const { run, isLoading, error } = useKeepassTools();
  const [limit, setLimit] = useState(50);
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[] | null>(null);
  const [settingsText, setSettingsText] = useState("");

  return (
    <Section
      title={t(
        "integrations.keepass.tools.maintenance.title",
        "Change Log · Settings · Service",
      )}
      icon={Settings2}
      testId="maintenance"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={labelCls}>
          {t("integrations.keepass.tools.maintenance.limit", "Limit")}
        </span>
        <input
          type="number"
          className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-sm text-[var(--color-text)]"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
        <button
          type="button"
          className={btnCls}
          onClick={async () => {
            const r = await run((api) => api.getChangeLog(dbId, limit));
            if (r) setChangeLog(r);
          }}
        >
          {t("integrations.keepass.tools.maintenance.changeLog", "Change log")}
        </button>
      </div>
      {changeLog && <ResultBox value={changeLog} />}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            const r = await run((api) => api.getSettings());
            setSettingsText(JSON.stringify(r ?? {}, null, 2));
          }}
        >
          {t("integrations.keepass.tools.maintenance.getSettings", "Get settings")}
        </button>
        <button
          type="button"
          className={ghostBtnCls}
          onClick={async () => {
            try {
              const parsed = JSON.parse(settingsText);
              await run((api) => api.updateSettings(parsed));
            } catch {
              // invalid JSON — leave the textarea as-is for the user to fix.
            }
          }}
        >
          {t(
            "integrations.keepass.tools.maintenance.updateSettings",
            "Update settings",
          )}
        </button>
      </div>
      <textarea
        className="h-32 w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] p-2 font-mono text-[11px] text-[var(--color-text)]"
        value={settingsText}
        onChange={(e) => setSettingsText(e.target.value)}
        placeholder="{ }"
      />

      <div>
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-400"
          onClick={() => run((api) => api.shutdown())}
        >
          <Power className="h-3.5 w-3.5" />
          {t("integrations.keepass.tools.maintenance.shutdown", "Shutdown service")}
        </button>
      </div>
      <StatusLine isLoading={isLoading} error={error} />
    </Section>
  );
}

// ─── Tab root ─────────────────────────────────────────────────────────────────

const KeepassToolsTab: React.FC<KeepassTabProps> = ({ dbId }) => {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      data-testid="keepass-tools-tab"
    >
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--color-textMuted)]">
        <ShieldCheck className="h-4 w-4 text-primary" />
        {t(
          "integrations.keepass.tools.subtitle",
          "Search, attachments, password health, OTP, auto-type, import/export and maintenance.",
        )}
      </div>
      <SearchSection dbId={dbId} />
      <AttachmentsSection dbId={dbId} />
      <PasswordSection dbId={dbId} />
      <OtpSection dbId={dbId} />
      <AutoTypeSection dbId={dbId} />
      <KeyFileSection />
      <ImportExportSection dbId={dbId} />
      <RecentSection />
      <MaintenanceSection dbId={dbId} />
    </div>
  );
};

export default KeepassToolsTab;
