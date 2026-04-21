//! Sparkline data processing, statistics, and trend detection.

use serde::{Deserialize, Serialize};

/// Trend direction of a sparkline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Trend {
    Rising,
    Falling,
    Stable,
    Volatile,
}

/// Descriptive statistics for a sparkline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparklineStats {
    pub min: f64,
    pub max: f64,
    pub avg: f64,
    pub median: f64,
    pub p95: f64,
    pub p99: f64,
    pub std_dev: f64,
    pub trend: Trend,
}

/// Downsample `points` to `width` evenly-spaced values.
///
/// If the input has fewer points than `width`, the original values are
/// returned as-is.
pub fn generate_sparkline(points: &[f64], width: usize) -> Vec<f64> {
    if points.is_empty() || width == 0 {
        return vec![];
    }
    if points.len() <= width {
        return points.to_vec();
    }

    let bucket_size = points.len() as f64 / width as f64;
    let mut result = Vec::with_capacity(width);

    for i in 0..width {
        let start = (i as f64 * bucket_size).floor() as usize;
        let end = (((i + 1) as f64) * bucket_size).floor() as usize;
        let end = end.min(points.len());
        let slice = &points[start..end];
        if slice.is_empty() {
            result.push(0.0);
        } else {
            let avg = slice.iter().sum::<f64>() / slice.len() as f64;
            result.push(avg);
        }
    }

    result
}

/// Normalize points to the 0.0–1.0 range.
pub fn normalize_sparkline(points: &[f64]) -> Vec<f64> {
    if points.is_empty() {
        return vec![];
    }
    let min = points.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = points.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let range = max - min;
    if range == 0.0 {
        return vec![0.5; points.len()];
    }
    points.iter().map(|&v| (v - min) / range).collect()
}

/// Detect the overall trend of a sparkline.
pub fn get_trend(points: &[f64]) -> Trend {
    if points.len() < 2 {
        return Trend::Stable;
    }

    // Use simple linear regression slope.
    let n = points.len() as f64;
    let x_mean = (n - 1.0) / 2.0;
    let y_mean = points.iter().sum::<f64>() / n;

    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for (i, &y) in points.iter().enumerate() {
        let x = i as f64;
        numerator += (x - x_mean) * (y - y_mean);
        denominator += (x - x_mean) * (x - x_mean);
    }

    if denominator == 0.0 {
        return Trend::Stable;
    }

    let slope = numerator / denominator;

    // Determine volatility: coefficient of variation.
    let std_dev = compute_std_dev(points, y_mean);
    let cv = if y_mean.abs() > f64::EPSILON {
        std_dev / y_mean.abs()
    } else {
        0.0
    };

    if cv > 0.5 {
        return Trend::Volatile;
    }

    let slope_threshold = y_mean.abs() * 0.01; // 1% of mean per step
    if slope > slope_threshold {
        Trend::Rising
    } else if slope < -slope_threshold {
        Trend::Falling
    } else {
        Trend::Stable
    }
}

/// Calculate comprehensive statistics for a set of points.
pub fn calculate_stats(points: &[f64]) -> SparklineStats {
    if points.is_empty() {
        return SparklineStats {
            min: 0.0,
            max: 0.0,
            avg: 0.0,
            median: 0.0,
            p95: 0.0,
            p99: 0.0,
            std_dev: 0.0,
            trend: Trend::Stable,
        };
    }

    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let min = sorted[0];
    let max = sorted[sorted.len() - 1];
    let avg = sorted.iter().sum::<f64>() / sorted.len() as f64;
    let median = percentile_sorted(&sorted, 50.0);
    let p95 = percentile_sorted(&sorted, 95.0);
    let p99 = percentile_sorted(&sorted, 99.0);
    let std_dev = compute_std_dev(points, avg);
    let trend = get_trend(points);

    SparklineStats {
        min,
        max,
        avg,
        median,
        p95,
        p99,
        std_dev,
        trend,
    }
}

// ── Internal helpers ────────────────────────────────────────────────

/// Compute standard deviation given precomputed mean.
fn compute_std_dev(points: &[f64], mean: f64) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }
    let variance =
        points.iter().map(|&v| (v - mean).powi(2)).sum::<f64>() / (points.len() - 1) as f64;
    variance.sqrt()
}

/// Get a percentile from a pre-sorted slice using linear interpolation.
fn percentile_sorted(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let rank = (pct / 100.0) * (sorted.len() - 1) as f64;
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    if lower == upper {
        sorted[lower]
    } else {
        let frac = rank - lower as f64;
        sorted[lower] * (1.0 - frac) + sorted[upper] * frac
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_sparkline_downsample() {
        let points: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let result = generate_sparkline(&points, 10);
        assert_eq!(result.len(), 10);
        // First bucket should be [0..10) → avg 4.5
        assert!((result[0] - 4.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_generate_sparkline_no_downsample() {
        let points = vec![1.0, 2.0, 3.0];
        let result = generate_sparkline(&points, 10);
        assert_eq!(result, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_normalize_sparkline() {
        let points = vec![10.0, 20.0, 30.0];
        let norm = normalize_sparkline(&points);
        assert!((norm[0] - 0.0).abs() < f64::EPSILON);
        assert!((norm[1] - 0.5).abs() < f64::EPSILON);
        assert!((norm[2] - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_normalize_constant() {
        let points = vec![5.0, 5.0, 5.0];
        let norm = normalize_sparkline(&points);
        assert_eq!(norm, vec![0.5, 0.5, 0.5]);
    }

    #[test]
    fn test_trend_rising() {
        let points: Vec<f64> = (0..20).map(|i| 100.0 + i as f64 * 10.0).collect();
        assert_eq!(get_trend(&points), Trend::Rising);
    }

    #[test]
    fn test_trend_falling() {
        let points: Vec<f64> = (0..20).map(|i| 1000.0 - i as f64 * 10.0).collect();
        assert_eq!(get_trend(&points), Trend::Falling);
    }

    #[test]
    fn test_trend_stable() {
        let points = vec![50.0, 50.1, 49.9, 50.0, 50.05];
        assert_eq!(get_trend(&points), Trend::Stable);
    }

    #[test]
    fn test_calculate_stats() {
        let points = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let stats = calculate_stats(&points);
        assert!((stats.min - 10.0).abs() < f64::EPSILON);
        assert!((stats.max - 50.0).abs() < f64::EPSILON);
        assert!((stats.avg - 30.0).abs() < f64::EPSILON);
        assert!((stats.median - 30.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_percentile() {
        let sorted = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let p50 = percentile_sorted(&sorted, 50.0);
        assert!((p50 - 5.5).abs() < f64::EPSILON);
    }
}
