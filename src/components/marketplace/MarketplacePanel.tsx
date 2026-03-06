import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMarketplace } from "../../hooks/marketplace/useMarketplace";
import type {
  MarketplaceListing,
  InstalledPlugin,
  PluginCategory,
} from "../../types/marketplace/marketplace";

type Tab = "browse" | "installed" | "updates" | "repositories";

const CATEGORIES: { value: PluginCategory | ""; label: string }[] = [
  { value: "", label: "All Categories" },
  { value: "connection", label: "Connection" },
  { value: "security", label: "Security" },
  { value: "monitoring", label: "Monitoring" },
  { value: "automation", label: "Automation" },
  { value: "theme", label: "Theme" },
  { value: "integration", label: "Integration" },
  { value: "tool", label: "Tool" },
  { value: "widget", label: "Widget" },
  { value: "import_export", label: "Import/Export" },
  { value: "other", label: "Other" },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="sor-star-rating" aria-label={`${rating.toFixed(1)} stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={s <= Math.round(rating) ? "sor-star-filled" : "sor-star-empty"}>
          ★
        </span>
      ))}
    </span>
  );
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export default function MarketplacePanel() {
  const { t } = useTranslation();
  const mkt = useMarketplace();

  const [tab, setTab] = useState<Tab>("browse");
  const [featured, setFeatured] = useState<MarketplaceListing[]>([]);
  const [updatable, setUpdatable] = useState<InstalledPlugin[]>([]);
  const [detailPlugin, setDetailPlugin] = useState<MarketplaceListing | null>(null);
  const [repoName, setRepoName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewRating, setReviewRating] = useState(5);

  /* ---- bootstrap ---- */
  useEffect(() => {
    mkt.fetchStats();
    mkt.fetchInstalled();
    mkt.fetchRepositories();
    mkt.loadConfig();
    mkt.getFeatured().then(setFeatured);
    mkt.search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- derived ---- */
  const installedIds = new Set(mkt.installed.map((p) => p.id));

  /* ---- handlers ---- */
  const handleSearch = useCallback(
    (q: string) => {
      mkt.setSearchQuery(q);
      const cat = mkt.selectedCategory ?? undefined;
      mkt.search(q, cat);
    },
    [mkt],
  );

  const handleCategoryChange = useCallback(
    (cat: string) => {
      const category = cat === "" ? null : (cat as PluginCategory);
      mkt.setSelectedCategory(category);
      mkt.search(mkt.searchQuery, category ?? undefined);
    },
    [mkt],
  );

  const handleRefresh = useCallback(() => {
    mkt.search(mkt.searchQuery, mkt.selectedCategory ?? undefined);
    mkt.fetchStats();
    mkt.getFeatured().then(setFeatured);
  }, [mkt]);

  const handleTabChange = useCallback(
    (next: Tab) => {
      setTab(next);
      if (next === "updates") {
        mkt.checkUpdates().then(setUpdatable);
      }
    },
    [mkt],
  );

  const openDetail = useCallback(
    async (pluginId: string) => {
      const listing = await mkt.getListing(pluginId);
      if (listing) {
        setDetailPlugin(listing);
        mkt.fetchReviews(pluginId);
      }
    },
    [mkt],
  );

  const handleAddRepo = useCallback(async () => {
    if (!repoName.trim() || !repoUrl.trim()) return;
    await mkt.addRepository(repoName.trim(), repoUrl.trim());
    setRepoName("");
    setRepoUrl("");
  }, [mkt, repoName, repoUrl]);

  const handleAddReview = useCallback(async () => {
    if (!detailPlugin || !reviewTitle.trim()) return;
    await mkt.addReview(detailPlugin.id, reviewRating, reviewTitle.trim(), reviewBody.trim());
    setReviewTitle("");
    setReviewBody("");
    setReviewRating(5);
  }, [mkt, detailPlugin, reviewRating, reviewTitle, reviewBody]);

  const handleUpdateAll = useCallback(async () => {
    for (const p of updatable) {
      await mkt.updatePlugin(p.id);
    }
    const fresh = await mkt.checkUpdates();
    setUpdatable(fresh);
  }, [mkt, updatable]);

  /* ---- render helpers ---- */
  const renderPluginCard = (p: MarketplaceListing) => (
    <div
      key={p.id}
      className="sor-plugin-card"
      onClick={() => openDetail(p.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && openDetail(p.id)}
    >
      <div className="sor-plugin-icon">
        {p.iconUrl ? <img src={p.iconUrl} alt="" /> : <span className="sor-plugin-icon-placeholder">🧩</span>}
      </div>
      <div className="sor-plugin-card-body">
        <h3 className="sor-plugin-name">
          {p.name}
          {p.verified && <span className="sor-verified-badge" title={t("marketplace.verified")}>✓</span>}
        </h3>
        <p className="sor-plugin-description">{truncate(p.description, 100)}</p>
        <span className="sor-plugin-author">{p.author}</span>
        <div className="sor-plugin-meta">
          <StarRating rating={p.rating} />
          <span className="sor-download-count">↓ {formatDownloads(p.downloads)}</span>
        </div>
      </div>
      <div className="sor-plugin-card-action">
        {installedIds.has(p.id) ? (
          <span className="sor-badge sor-badge-installed">{t("marketplace.installed")}</span>
        ) : (
          <button
            className="sor-btn sor-btn-primary sor-btn-sm"
            disabled={mkt.installing === p.id}
            onClick={(e) => {
              e.stopPropagation();
              mkt.install(p.id);
            }}
          >
            {mkt.installing === p.id ? t("marketplace.installing") : t("marketplace.install")}
          </button>
        )}
      </div>
    </div>
  );

  /* ================ BROWSE TAB ================ */
  const renderBrowse = () => (
    <div className="sor-browse-tab">
      {/* featured row */}
      {!mkt.searchQuery && featured.length > 0 && (
        <section className="sor-featured-section">
          <h2 className="sor-section-title">{t("marketplace.featured")}</h2>
          <div className="sor-featured-row">
            {featured.map((p) => renderPluginCard(p))}
          </div>
        </section>
      )}

      {/* category pills */}
      <div className="sor-category-pills">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            className={`sor-pill ${(mkt.selectedCategory ?? "") === c.value ? "sor-pill-active" : ""}`}
            onClick={() => handleCategoryChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* grid */}
      {mkt.loading ? (
        <div className="sor-loading">{t("marketplace.loading")}</div>
      ) : mkt.listings.length === 0 ? (
        <div className="sor-empty-state">{t("marketplace.noResults")}</div>
      ) : (
        <div className="sor-plugin-grid">
          {mkt.listings.map((p) => renderPluginCard(p))}
        </div>
      )}
    </div>
  );

  /* ================ INSTALLED TAB ================ */
  const renderInstalled = () => (
    <div className="sor-installed-tab">
      {mkt.installed.length === 0 ? (
        <div className="sor-empty-state">
          <p>{t("marketplace.noInstalled")}</p>
          <button className="sor-btn sor-btn-primary" onClick={() => setTab("browse")}>
            {t("marketplace.browsePlugins")}
          </button>
        </div>
      ) : (
        <ul className="sor-installed-list">
          {mkt.installed.map((p) => (
            <li key={p.id} className="sor-installed-item">
              <div className="sor-installed-info">
                <span className="sor-plugin-name">{p.name}</span>
                <span className="sor-plugin-version">v{p.installedVersion}</span>
                <span className={`sor-status ${p.enabled ? "sor-status-enabled" : "sor-status-disabled"}`}>
                  {p.enabled ? t("marketplace.enabled") : t("marketplace.disabled")}
                </span>
              </div>
              <div className="sor-installed-actions">
                <label className="sor-toggle">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() =>
                      p.enabled ? mkt.uninstall(p.id) : mkt.install(p.id)
                    }
                  />
                  <span className="sor-toggle-slider" />
                </label>
                {p.hasUpdate && (
                  <button
                    className="sor-btn sor-btn-sm sor-btn-accent"
                    disabled={mkt.installing === p.id}
                    onClick={() => mkt.updatePlugin(p.id)}
                  >
                    {mkt.installing === p.id ? t("marketplace.updating") : t("marketplace.update")}
                  </button>
                )}
                <button
                  className="sor-btn sor-btn-sm sor-btn-danger"
                  onClick={() => mkt.uninstall(p.id)}
                >
                  {t("marketplace.uninstall")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* ================ UPDATES TAB ================ */
  const renderUpdates = () => (
    <div className="sor-updates-tab">
      {updatable.length > 0 && (
        <div className="sor-updates-header">
          <span>
            {updatable.length} {t("marketplace.updatesAvailable")}
          </span>
          <button className="sor-btn sor-btn-primary" onClick={handleUpdateAll}>
            {t("marketplace.updateAll")}
          </button>
        </div>
      )}

      {mkt.loading ? (
        <div className="sor-loading">{t("marketplace.checkingUpdates")}</div>
      ) : updatable.length === 0 ? (
        <div className="sor-empty-state">{t("marketplace.allUpToDate")}</div>
      ) : (
        <ul className="sor-updates-list">
          {updatable.map((p) => (
            <li key={p.id} className="sor-update-item">
              <div className="sor-update-info">
                <span className="sor-plugin-name">{p.name}</span>
                <span className="sor-version-change">
                  v{p.installedVersion} → v{p.latestVersion}
                </span>
              </div>
              <button
                className="sor-btn sor-btn-sm sor-btn-accent"
                disabled={mkt.installing === p.id}
                onClick={() => mkt.updatePlugin(p.id)}
              >
                {mkt.installing === p.id ? t("marketplace.updating") : t("marketplace.update")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /* ================ REPOSITORIES TAB ================ */
  const renderRepositories = () => (
    <div className="sor-repos-tab">
      <div className="sor-repos-actions">
        <button className="sor-btn sor-btn-secondary" onClick={mkt.refreshRepositories} disabled={mkt.loading}>
          {mkt.loading ? t("marketplace.refreshing") : t("marketplace.refreshAll")}
        </button>
      </div>

      <ul className="sor-repos-list">
        {mkt.repositories.map((r) => (
          <li key={r.id} className="sor-repo-item">
            <div className="sor-repo-info">
              <span className="sor-repo-name">{r.name}</span>
              <span className="sor-repo-url">{r.url}</span>
              <span className="sor-repo-meta">
                {r.pluginCount} {t("marketplace.plugins")} ·{" "}
                {r.lastRefreshed
                  ? t("marketplace.lastRefreshed", { date: new Date(r.lastRefreshed).toLocaleString() })
                  : t("marketplace.neverRefreshed")}
              </span>
            </div>
            <div className="sor-repo-actions">
              {!r.isDefault && (
                <button
                  className="sor-btn sor-btn-sm sor-btn-danger"
                  onClick={() => mkt.removeRepository(r.id)}
                >
                  {t("marketplace.remove")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* add repository form */}
      <form
        className="sor-add-repo-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleAddRepo();
        }}
      >
        <h3 className="sor-section-title">{t("marketplace.addRepository")}</h3>
        <div className="sor-form-row">
          <input
            className="sor-input"
            placeholder={t("marketplace.repoNamePlaceholder")}
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
          />
          <input
            className="sor-input sor-input-wide"
            placeholder={t("marketplace.repoUrlPlaceholder")}
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <button className="sor-btn sor-btn-primary" type="submit" disabled={!repoName || !repoUrl}>
            {t("marketplace.add")}
          </button>
        </div>
      </form>
    </div>
  );

  /* ================ DETAIL MODAL ================ */
  const renderDetailModal = () => {
    if (!detailPlugin) return null;
    const p = detailPlugin;
    const isInstalled = installedIds.has(p.id);

    return (
      <div className="sor-modal-overlay" onClick={() => setDetailPlugin(null)}>
        <div className="sor-modal sor-plugin-detail-modal" onClick={(e) => e.stopPropagation()} role="dialog">
          <button className="sor-modal-close" onClick={() => setDetailPlugin(null)} aria-label={t("common.close")}>
            ✕
          </button>

          <div className="sor-detail-header">
            <div className="sor-plugin-icon-lg">
              {p.iconUrl ? <img src={p.iconUrl} alt="" /> : <span className="sor-plugin-icon-placeholder">🧩</span>}
            </div>
            <div>
              <h2 className="sor-detail-title">
                {p.name}
                {p.verified && <span className="sor-verified-badge">✓</span>}
              </h2>
              <span className="sor-plugin-author">{p.author}</span>
              <div className="sor-plugin-meta">
                <StarRating rating={p.rating} />
                <span>({p.reviewCount})</span>
                <span className="sor-download-count">↓ {formatDownloads(p.downloads)}</span>
                <span className="sor-plugin-license">{p.license}</span>
              </div>
            </div>
          </div>

          <div className="sor-detail-body">
            <p className="sor-detail-description">{p.longDescription || p.description}</p>

            {/* screenshots placeholder */}
            {p.screenshotUrls.length > 0 && (
              <div className="sor-screenshots">
                {p.screenshotUrls.map((url, i) => (
                  <img key={i} src={url} alt={`${p.name} screenshot ${i + 1}`} className="sor-screenshot" />
                ))}
              </div>
            )}

            {/* info table */}
            <dl className="sor-detail-info">
              <dt>{t("marketplace.version")}</dt>
              <dd>{p.version}</dd>
              <dt>{t("marketplace.category")}</dt>
              <dd>{p.category}</dd>
              <dt>{t("marketplace.fileSize")}</dt>
              <dd>{(p.fileSize / 1024).toFixed(0)} KB</dd>
              <dt>{t("marketplace.published")}</dt>
              <dd>{new Date(p.publishedAt).toLocaleDateString()}</dd>
              <dt>{t("marketplace.updated")}</dt>
              <dd>{new Date(p.updatedAt).toLocaleDateString()}</dd>
              {p.homepage && (
                <>
                  <dt>{t("marketplace.homepage")}</dt>
                  <dd>
                    <a href={p.homepage} target="_blank" rel="noreferrer">{p.homepage}</a>
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* reviews */}
          <div className="sor-reviews-section">
            <h3 className="sor-section-title">{t("marketplace.reviews")}</h3>
            {mkt.reviews.length === 0 ? (
              <p className="sor-empty-state">{t("marketplace.noReviews")}</p>
            ) : (
              <ul className="sor-reviews-list">
                {mkt.reviews.map((r) => (
                  <li key={r.id} className="sor-review-item">
                    <div className="sor-review-header">
                      <StarRating rating={r.rating} />
                      <strong>{r.title}</strong>
                      <span className="sor-review-author">{r.author}</span>
                    </div>
                    <p className="sor-review-body">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}

            {/* add review form */}
            <form
              className="sor-add-review-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleAddReview();
              }}
            >
              <h4>{t("marketplace.addReview")}</h4>
              <div className="sor-form-row">
                <select
                  className="sor-select"
                  value={reviewRating}
                  onChange={(e) => setReviewRating(Number(e.target.value))}
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>{"★".repeat(v)}</option>
                  ))}
                </select>
                <input
                  className="sor-input"
                  placeholder={t("marketplace.reviewTitlePlaceholder")}
                  value={reviewTitle}
                  onChange={(e) => setReviewTitle(e.target.value)}
                />
              </div>
              <textarea
                className="sor-textarea"
                placeholder={t("marketplace.reviewBodyPlaceholder")}
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={3}
              />
              <button className="sor-btn sor-btn-primary sor-btn-sm" type="submit" disabled={!reviewTitle.trim()}>
                {t("marketplace.submitReview")}
              </button>
            </form>
          </div>

          {/* install / uninstall */}
          <div className="sor-detail-footer">
            {isInstalled ? (
              <button className="sor-btn sor-btn-danger" onClick={() => mkt.uninstall(p.id)}>
                {t("marketplace.uninstall")}
              </button>
            ) : (
              <button
                className="sor-btn sor-btn-primary"
                disabled={mkt.installing === p.id}
                onClick={() => mkt.install(p.id)}
              >
                {mkt.installing === p.id ? t("marketplace.installing") : t("marketplace.install")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ================ MAIN RENDER ================ */
  return (
    <div className="sor-marketplace-panel">
      {/* error banner */}
      {mkt.error && (
        <div className="sor-error-banner" role="alert">
          <span>{mkt.error}</span>
          <button className="sor-btn sor-btn-sm" onClick={() => mkt.search(mkt.searchQuery)}>
            {t("common.dismiss")}
          </button>
        </div>
      )}

      {/* header */}
      <header className="sor-marketplace-header">
        <h1 className="sor-panel-title">{t("marketplace.title")}</h1>
        <div className="sor-header-controls">
          <input
            className="sor-search-input"
            type="search"
            placeholder={t("marketplace.searchPlaceholder")}
            value={mkt.searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <select
            className="sor-select sor-category-filter"
            value={mkt.selectedCategory ?? ""}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button className="sor-btn sor-btn-icon" onClick={handleRefresh} title={t("marketplace.refresh")}>
            ↻
          </button>
        </div>
      </header>

      {/* tab bar */}
      <nav className="sor-tab-bar" role="tablist">
        {(["browse", "installed", "updates", "repositories"] as Tab[]).map((t_) => (
          <button
            key={t_}
            role="tab"
            aria-selected={tab === t_}
            className={`sor-tab ${tab === t_ ? "sor-tab-active" : ""}`}
            onClick={() => handleTabChange(t_)}
          >
            {t(`marketplace.tabs.${t_}`)}
            {t_ === "updates" && updatable.length > 0 && (
              <span className="sor-badge sor-badge-count">{updatable.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* tab content */}
      <div className="sor-tab-content">
        {tab === "browse" && renderBrowse()}
        {tab === "installed" && renderInstalled()}
        {tab === "updates" && renderUpdates()}
        {tab === "repositories" && renderRepositories()}
      </div>

      {/* stats footer */}
      {mkt.stats && (
        <footer className="sor-marketplace-footer">
          <span>{mkt.stats.totalListings} {t("marketplace.available")}</span>
          <span>{mkt.stats.installedCount} {t("marketplace.installedLabel")}</span>
          <span>{mkt.stats.updatesAvailable} {t("marketplace.updatesPending")}</span>
          <span>{mkt.stats.repositoryCount} {t("marketplace.repos")}</span>
        </footer>
      )}

      {/* detail modal */}
      {renderDetailModal()}
    </div>
  );
}
