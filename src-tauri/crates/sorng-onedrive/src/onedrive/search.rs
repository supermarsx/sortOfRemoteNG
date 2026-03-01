//! Full-text and metadata search across OneDrive / SharePoint.
//!
//! Uses the Graph `/search/query` API (beta-style) as well as the simpler
//! `/drive/root/search(q='...')` endpoint.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::{DriveItem, SearchOptions};
use log::debug;

/// Search operations.
pub struct OneDriveSearch<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDriveSearch<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    /// Simple search within the current drive (KQL-compatible on SharePoint).
    pub async fn search(&self, query: &str, top: Option<i32>) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = percent_encoding::utf8_percent_encode(
            query,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let top_str = top.unwrap_or(200).to_string();
        let path = format!(
            "drives/{}/root/search(q='{}')",
            self.drive_id, encoded
        );
        let resp = self.client.get(&path, &[("$top", &top_str)]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        debug!("Search '{}' returned {} items", query, items.len());
        Ok(items)
    }

    /// Search with full `SearchOptions`.
    pub async fn search_advanced(
        &self,
        options: &SearchOptions,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = percent_encoding::utf8_percent_encode(
            &options.query,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let top_str = options.top.unwrap_or(200).to_string();
        let path = format!(
            "drives/{}/root/search(q='{}')",
            self.drive_id, encoded
        );

        let mut params: Vec<(&str, &str)> = vec![("$top", &top_str)];

        let select_str;
        if let Some(ref sel) = options.select {
            select_str = sel.join(",");
            params.push(("$select", &select_str));
        }

        let filter_str;
        if let Some(ref f) = options.filter {
            filter_str = f.clone();
            params.push(("$filter", &filter_str));
        }

        let order_str;
        if let Some(ref o) = options.order_by {
            order_str = o.clone();
            params.push(("$orderby", &order_str));
        }

        let resp = self.client.get(&path, &params).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(items)
    }

    /// Search across all drives the user has access to via `/me/drive/search`.
    pub async fn search_all_drives(
        &self,
        query: &str,
        top: Option<i32>,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = percent_encoding::utf8_percent_encode(
            query,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let top_str = top.unwrap_or(200).to_string();
        let path = format!("me/drive/search(q='{}')", encoded);
        let resp = self.client.get(&path, &[("$top", &top_str)]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(items)
    }

    /// Search within a specific folder.
    pub async fn search_in_folder(
        &self,
        folder_id: &str,
        query: &str,
        top: Option<i32>,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = percent_encoding::utf8_percent_encode(
            query,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let top_str = top.unwrap_or(200).to_string();
        let path = format!(
            "drives/{}/items/{}/search(q='{}')",
            self.drive_id, folder_id, encoded
        );
        let resp = self.client.get(&path, &[("$top", &top_str)]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(items)
    }

    /// List recently accessed files.
    pub async fn recent(&self) -> OneDriveResult<Vec<DriveItem>> {
        let resp = self.client.get("me/drive/recent", &[]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        debug!("Found {} recent items", items.len());
        Ok(items)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_options_default() {
        let opts = SearchOptions::default();
        assert!(opts.query.is_empty());
        assert_eq!(opts.top, Some(200));
        assert!(opts.scope.is_none());
    }

    #[test]
    fn test_search_options_serde() {
        let opts = SearchOptions {
            query: "budget report".into(),
            top: Some(10),
            scope: None,
            select: Some(vec!["name".into(), "size".into()]),
            filter: None,
            order_by: Some("lastModifiedDateTime desc".into()),
        };
        let v = serde_json::to_value(&opts).unwrap();
        assert_eq!(v["query"], "budget report");
        assert_eq!(v["top"], 10);
    }
}
