//! Review storage, average rating computation, and star distributions.

use std::collections::HashMap;

use crate::error::MarketplaceError;
use crate::types::MarketplaceReview;

/// Manages reviews for all marketplace listings.
pub struct RatingManager {
    /// Reviews keyed by review ID.
    reviews: HashMap<String, MarketplaceReview>,
    /// Listing ID → ordered vec of review IDs.
    by_listing: HashMap<String, Vec<String>>,
}

impl RatingManager {
    /// Create an empty rating manager.
    pub fn new() -> Self {
        Self {
            reviews: HashMap::new(),
            by_listing: HashMap::new(),
        }
    }

    /// Add a review. Rating must be 1–5.
    pub fn add_review(&mut self, review: MarketplaceReview) -> Result<(), MarketplaceError> {
        if review.rating < 1 || review.rating > 5 {
            return Err(MarketplaceError::InvalidRating(review.rating));
        }
        let review_id = review.id.clone();
        let listing_id = review.listing_id.clone();
        self.reviews.insert(review_id.clone(), review);
        self.by_listing
            .entry(listing_id)
            .or_default()
            .push(review_id);
        Ok(())
    }

    /// Get all reviews for a given listing.
    pub fn get_reviews_for_listing(&self, listing_id: &str) -> Vec<&MarketplaceReview> {
        self.by_listing
            .get(listing_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.reviews.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Compute the average rating (1.0–5.0) for a listing.
    /// Returns `0.0` if there are no reviews.
    pub fn get_average_rating(&self, listing_id: &str) -> f64 {
        let reviews = self.get_reviews_for_listing(listing_id);
        if reviews.is_empty() {
            return 0.0;
        }
        let sum: f64 = reviews.iter().map(|r| r.rating as f64).sum();
        sum / reviews.len() as f64
    }

    /// Increment the `helpful_count` for a review.
    pub fn mark_helpful(&mut self, review_id: &str) -> Result<(), MarketplaceError> {
        let review = self
            .reviews
            .get_mut(review_id)
            .ok_or_else(|| MarketplaceError::ReviewNotFound(review_id.to_string()))?;
        review.helpful_count += 1;
        Ok(())
    }

    /// Get the star distribution as an array `[1-star, 2-star, …, 5-star]`.
    pub fn get_rating_distribution(&self, listing_id: &str) -> [u32; 5] {
        let mut dist = [0u32; 5];
        for review in self.get_reviews_for_listing(listing_id) {
            let idx = (review.rating as usize).saturating_sub(1).min(4);
            dist[idx] += 1;
        }
        dist
    }
}

impl Default for RatingManager {
    fn default() -> Self {
        Self::new()
    }
}
