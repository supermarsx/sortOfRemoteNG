//! In-memory listing store and installation tracking.

use std::collections::HashMap;

use crate::error::MarketplaceError;
use crate::search;
use crate::types::*;

/// Central in-memory registry of marketplace listings and installed extensions.
pub struct MarketplaceRegistry {
    /// All known listings keyed by `listing.id`.
    pub listings: HashMap<String, MarketplaceListing>,
    /// Currently installed extensions keyed by `listing_id`.
    pub installed: HashMap<String, InstalledExtension>,
}

impl MarketplaceRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            listings: HashMap::new(),
            installed: HashMap::new(),
        }
    }

    // ── Listing CRUD ────────────────────────────────────────────

    /// Add or replace a listing in the registry. Returns an error if a
    /// listing with the same ID already exists (use `upsert` semantics
    /// by calling `remove_listing` first when intentional).
    pub fn add_listing(&mut self, listing: MarketplaceListing) -> Result<(), MarketplaceError> {
        if self.listings.contains_key(&listing.id) {
            return Err(MarketplaceError::DuplicateListing(listing.id.clone()));
        }
        self.listings.insert(listing.id.clone(), listing);
        Ok(())
    }

    /// Remove a listing by its ID, returning it.
    pub fn remove_listing(&mut self, id: &str) -> Result<MarketplaceListing, MarketplaceError> {
        self.listings
            .remove(id)
            .ok_or_else(|| MarketplaceError::ListingNotFound(id.to_string()))
    }

    /// Get a reference to a listing by its ID.
    pub fn get_listing(&self, id: &str) -> Result<&MarketplaceListing, MarketplaceError> {
        self.listings
            .get(id)
            .ok_or_else(|| MarketplaceError::ListingNotFound(id.to_string()))
    }

    // ── Search ──────────────────────────────────────────────────

    /// Full-text search with filtering, scoring, sorting, and pagination.
    pub fn search(&self, query: &SearchQuery) -> SearchResults {
        // 1. Collect candidates that pass filters.
        let mut candidates: Vec<(&MarketplaceListing, f64)> = self
            .listings
            .values()
            .filter(|l| self.passes_filters(l, query))
            .map(|l| {
                let score = match &query.query {
                    Some(q) if !q.is_empty() => search::calculate_relevance(l, q),
                    _ => 0.0,
                };
                (l, score)
            })
            .collect();

        // 2. Sort.
        match query.sort_by {
            SearchSort::Relevance => {
                candidates
                    .sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            }
            SearchSort::Downloads => {
                candidates.sort_by(|a, b| b.0.downloads.cmp(&a.0.downloads));
            }
            SearchSort::Rating => {
                candidates.sort_by(|a, b| {
                    b.0.rating
                        .partial_cmp(&a.0.rating)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
            }
            SearchSort::RecentlyUpdated => {
                candidates.sort_by(|a, b| b.0.updated_at.cmp(&a.0.updated_at));
            }
            SearchSort::Name => {
                candidates.sort_by(|a, b| a.0.display_name.cmp(&b.0.display_name));
            }
        }

        let total_count = candidates.len() as u64;
        let page = query.page.max(1);
        let page_size = query.page_size.max(1);
        let start = ((page - 1) * page_size) as usize;
        let page_listings: Vec<MarketplaceListing> = candidates
            .into_iter()
            .skip(start)
            .take(page_size as usize)
            .map(|(l, _)| l.clone())
            .collect();

        let has_more = (start + page_listings.len()) < total_count as usize;

        SearchResults {
            listings: page_listings,
            total_count,
            page,
            page_size,
            has_more,
        }
    }

    // ── Install tracking ────────────────────────────────────────

    /// Record an extension as installed.
    pub fn mark_installed(&mut self, ext: InstalledExtension) {
        self.installed.insert(ext.listing_id.clone(), ext);
    }

    /// Remove an extension from the installed set.
    pub fn mark_uninstalled(&mut self, listing_id: &str) -> Result<(), MarketplaceError> {
        self.installed
            .remove(listing_id)
            .map(|_| ())
            .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))
    }

    /// List all installed extensions.
    pub fn get_installed(&self) -> Vec<&InstalledExtension> {
        self.installed.values().collect()
    }

    /// Check whether a listing is currently installed.
    pub fn is_installed(&self, listing_id: &str) -> bool {
        self.installed.contains_key(listing_id)
    }

    /// Return listings where the installed version is older than the
    /// registry version.
    pub fn get_updates_available(&self) -> Vec<(&MarketplaceListing, &InstalledExtension)> {
        self.installed
            .values()
            .filter_map(|inst| {
                self.listings.get(&inst.listing_id).and_then(|listing| {
                    if listing.version != inst.version {
                        Some((listing, inst))
                    } else {
                        None
                    }
                })
            })
            .collect()
    }

    // ── Private helpers ─────────────────────────────────────────

    fn passes_filters(&self, listing: &MarketplaceListing, q: &SearchQuery) -> bool {
        // Full-text match.
        if let Some(ref text) = q.query {
            if !text.is_empty() && !search::matches_query(listing, text) {
                return false;
            }
        }

        // Category filter.
        if let Some(ref cat) = q.category {
            if &listing.category != cat {
                return false;
            }
        }

        // Tag filter (listing must contain ALL requested tags).
        if let Some(ref tags) = q.tags {
            let listing_tags_lower: Vec<String> =
                listing.tags.iter().map(|t| t.to_lowercase()).collect();
            for tag in tags {
                if !listing_tags_lower.contains(&tag.to_lowercase()) {
                    return false;
                }
            }
        }

        // Author filter.
        if let Some(ref author) = q.author {
            if !listing
                .author
                .name
                .to_lowercase()
                .contains(&author.to_lowercase())
            {
                return false;
            }
        }

        // Verified-only filter.
        if q.verified_only && !listing.verified {
            return false;
        }

        // Minimum rating filter.
        if let Some(min) = q.min_rating {
            if listing.rating < min {
                return false;
            }
        }

        true
    }
}

impl Default for MarketplaceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
