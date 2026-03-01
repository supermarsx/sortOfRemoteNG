use super::service::RustDeskService;
use super::types::*;

/// Address book management operations that delegate to the API client.
impl RustDeskService {
    // ─── Address Books ──────────────────────────────────────────────

    pub async fn api_list_address_books(
        &self,
        name: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_address_books(name.as_deref()).await
    }

    pub async fn api_get_personal_address_book(&self) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.get_personal_address_book().await
    }

    pub async fn api_create_address_book(
        &self,
        name: &str,
        note: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.create_address_book(name, note.as_deref()).await
    }

    pub async fn api_update_address_book(
        &self,
        guid: &str,
        name: Option<String>,
        note: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .update_address_book(guid, name.as_deref(), note.as_deref())
            .await
    }

    pub async fn api_delete_address_book(
        &self,
        guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_address_book(guid).await
    }

    // ─── Peers ──────────────────────────────────────────────────────

    pub async fn api_list_address_book_peers(
        &self,
        ab_guid: &str,
        peer_id: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_ab_peers(ab_guid, peer_id.as_deref()).await
    }

    pub async fn api_add_peer_to_address_book(
        &self,
        ab_guid: &str,
        peer: AddressBookPeer,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .add_ab_peer(
                ab_guid,
                &peer.id,
                peer.alias.as_deref(),
                peer.note.as_deref(),
                Some(&peer.tags),
            )
            .await
    }

    pub async fn api_update_address_book_peer(
        &self,
        ab_guid: &str,
        peer_id: &str,
        alias: Option<String>,
        note: Option<String>,
        tags: Option<Vec<String>>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .update_ab_peer(
                ab_guid,
                peer_id,
                alias.as_deref(),
                note.as_deref(),
                tags.as_deref(),
            )
            .await
    }

    pub async fn api_remove_peer_from_address_book(
        &self,
        ab_guid: &str,
        peer_id: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_ab_peer(ab_guid, peer_id).await
    }

    // ─── Tags ───────────────────────────────────────────────────────

    pub async fn api_list_address_book_tags(
        &self,
        ab_guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_ab_tags(ab_guid).await
    }

    pub async fn api_add_address_book_tag(
        &self,
        ab_guid: &str,
        name: &str,
        color: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.add_ab_tag(ab_guid, name, color.as_deref()).await
    }

    pub async fn api_delete_address_book_tag(
        &self,
        ab_guid: &str,
        tag_name: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_ab_tag(ab_guid, tag_name).await
    }

    // ─── Rules ──────────────────────────────────────────────────────

    pub async fn api_list_address_book_rules(
        &self,
        ab_guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_ab_rules(ab_guid).await
    }

    pub async fn api_add_address_book_rule(
        &self,
        ab_guid: &str,
        rule: AddressBookRule,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        let rule_type_str = match rule.rule_type {
            AddressBookRuleType::User => "user",
            AddressBookRuleType::Group => "group",
            AddressBookRuleType::Everyone => "everyone",
        };
        let permission_str = match rule.permission {
            AddressBookPermission::ReadOnly => "read",
            AddressBookPermission::ReadWrite => "read_write",
            AddressBookPermission::Full => "full",
        };
        client
            .add_ab_rule(
                ab_guid,
                rule_type_str,
                rule.user.as_deref(),
                rule.group.as_deref(),
                permission_str,
            )
            .await
    }

    pub async fn api_delete_address_book_rule(
        &self,
        rule_guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_ab_rule(rule_guid).await
    }

    // ─── Helpers ────────────────────────────────────────────────────

    pub async fn api_import_peers(
        &self,
        ab_guid: &str,
        peers: Vec<AddressBookPeer>,
    ) -> Result<Vec<Result<serde_json::Value, String>>, String> {
        let client = self.get_api_client()?;
        let mut results = Vec::new();
        for peer in peers {
            let result = client
                .add_ab_peer(
                    ab_guid,
                    &peer.id,
                    peer.alias.as_deref(),
                    peer.note.as_deref(),
                    Some(&peer.tags),
                )
                .await;
            results.push(result);
        }
        Ok(results)
    }
}
