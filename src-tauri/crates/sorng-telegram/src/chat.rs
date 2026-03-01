//! Chat management — get info, members, set title/description/photo,
//! ban/unban, restrict, promote members, invite links.

use crate::types::*;
use serde_json::json;

/// Build the JSON body for `getChat`.
pub fn build_get_chat(chat_id: &ChatId) -> serde_json::Value {
    json!({ "chat_id": chat_id_value(chat_id) })
}

/// Build the JSON body for `getChatMemberCount`.
pub fn build_get_chat_member_count(chat_id: &ChatId) -> serde_json::Value {
    json!({ "chat_id": chat_id_value(chat_id) })
}

/// Build the JSON body for `getChatMember`.
pub fn build_get_chat_member(chat_id: &ChatId, user_id: i64) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "user_id": user_id,
    })
}

/// Build the JSON body for `getChatAdministrators`.
pub fn build_get_chat_administrators(chat_id: &ChatId) -> serde_json::Value {
    json!({ "chat_id": chat_id_value(chat_id) })
}

/// Build the JSON body for `setChatTitle`.
pub fn build_set_chat_title(chat_id: &ChatId, title: &str) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "title": title,
    })
}

/// Build the JSON body for `setChatDescription`.
pub fn build_set_chat_description(
    chat_id: &ChatId,
    description: &str,
) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "description": description,
    })
}

/// Build the JSON body for `leaveChat`.
pub fn build_leave_chat(chat_id: &ChatId) -> serde_json::Value {
    json!({ "chat_id": chat_id_value(chat_id) })
}

/// Build the JSON body for `banChatMember`.
pub fn build_ban_chat_member(req: &BanChatMemberRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "user_id": req.user_id,
    });
    if let Some(ud) = req.until_date {
        body["until_date"] = json!(ud);
    }
    if req.revoke_messages {
        body["revoke_messages"] = json!(true);
    }
    body
}

/// Build the JSON body for `unbanChatMember`.
pub fn build_unban_chat_member(
    chat_id: &ChatId,
    user_id: i64,
    only_if_banned: bool,
) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "user_id": user_id,
        "only_if_banned": only_if_banned,
    })
}

/// Build the JSON body for `restrictChatMember`.
pub fn build_restrict_chat_member(req: &RestrictChatMemberRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "user_id": req.user_id,
        "permissions": serde_json::to_value(&req.permissions).unwrap_or_default(),
    });
    if let Some(ud) = req.until_date {
        body["until_date"] = json!(ud);
    }
    if req.use_independent_chat_permissions {
        body["use_independent_chat_permissions"] = json!(true);
    }
    body
}

/// Build the JSON body for `promoteChatMember`.
pub fn build_promote_chat_member(req: &PromoteChatMemberRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "user_id": req.user_id,
    });
    macro_rules! set_opt {
        ($field:ident) => {
            if let Some(v) = req.$field {
                body[stringify!($field)] = json!(v);
            }
        };
    }
    set_opt!(is_anonymous);
    set_opt!(can_manage_chat);
    set_opt!(can_post_messages);
    set_opt!(can_edit_messages);
    set_opt!(can_delete_messages);
    set_opt!(can_manage_video_chats);
    set_opt!(can_restrict_members);
    set_opt!(can_promote_members);
    set_opt!(can_change_info);
    set_opt!(can_invite_users);
    set_opt!(can_pin_messages);
    set_opt!(can_manage_topics);
    body
}

/// Build the JSON body for `setChatPermissions`.
pub fn build_set_chat_permissions(
    chat_id: &ChatId,
    permissions: &ChatPermissions,
    use_independent: bool,
) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(chat_id),
        "permissions": serde_json::to_value(permissions).unwrap_or_default(),
    });
    if use_independent {
        body["use_independent_chat_permissions"] = json!(true);
    }
    body
}

/// Build the JSON body for `exportChatInviteLink`.
pub fn build_export_chat_invite_link(chat_id: &ChatId) -> serde_json::Value {
    json!({ "chat_id": chat_id_value(chat_id) })
}

/// Build the JSON body for `createChatInviteLink`.
pub fn build_create_invite_link(
    chat_id: &ChatId,
    name: Option<&str>,
    expire_date: Option<i64>,
    member_limit: Option<i64>,
    creates_join_request: bool,
) -> serde_json::Value {
    let mut body = json!({ "chat_id": chat_id_value(chat_id) });
    if let Some(n) = name {
        body["name"] = json!(n);
    }
    if let Some(ed) = expire_date {
        body["expire_date"] = json!(ed);
    }
    if let Some(ml) = member_limit {
        body["member_limit"] = json!(ml);
    }
    if creates_join_request {
        body["creates_join_request"] = json!(true);
    }
    body
}

/// Build the JSON body for `revokeChatInviteLink`.
pub fn build_revoke_invite_link(
    chat_id: &ChatId,
    invite_link: &str,
) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "invite_link": invite_link,
    })
}

/// Build the JSON body for `setChatAdministratorCustomTitle`.
pub fn build_set_admin_custom_title(
    chat_id: &ChatId,
    user_id: i64,
    custom_title: &str,
) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "user_id": user_id,
        "custom_title": custom_title,
    })
}

fn chat_id_value(cid: &ChatId) -> serde_json::Value {
    match cid {
        ChatId::Numeric(n) => json!(n),
        ChatId::Username(s) => json!(s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_get_chat_test() {
        let body = build_get_chat(&ChatId::Numeric(123));
        assert_eq!(body["chat_id"], 123);
    }

    #[test]
    fn build_get_chat_username() {
        let body = build_get_chat(&ChatId::Username("@channel".to_string()));
        assert_eq!(body["chat_id"], "@channel");
    }

    #[test]
    fn build_get_member_count() {
        let body = build_get_chat_member_count(&ChatId::Numeric(1));
        assert_eq!(body["chat_id"], 1);
    }

    #[test]
    fn build_get_member() {
        let body = build_get_chat_member(&ChatId::Numeric(1), 42);
        assert_eq!(body["user_id"], 42);
    }

    #[test]
    fn build_set_title() {
        let body = build_set_chat_title(&ChatId::Numeric(1), "New Title");
        assert_eq!(body["title"], "New Title");
    }

    #[test]
    fn build_set_description() {
        let body = build_set_chat_description(&ChatId::Numeric(1), "A cool group");
        assert_eq!(body["description"], "A cool group");
    }

    #[test]
    fn build_ban_member() {
        let req = BanChatMemberRequest {
            chat_id: ChatId::Numeric(1),
            user_id: 42,
            until_date: Some(1700000000),
            revoke_messages: true,
        };
        let body = build_ban_chat_member(&req);
        assert_eq!(body["user_id"], 42);
        assert_eq!(body["until_date"], 1700000000i64);
        assert_eq!(body["revoke_messages"], true);
    }

    #[test]
    fn build_unban_member() {
        let body = build_unban_chat_member(&ChatId::Numeric(1), 42, true);
        assert_eq!(body["user_id"], 42);
        assert_eq!(body["only_if_banned"], true);
    }

    #[test]
    fn build_restrict_member() {
        let req = RestrictChatMemberRequest {
            chat_id: ChatId::Numeric(1),
            user_id: 42,
            permissions: ChatPermissions {
                can_send_messages: Some(false),
                ..Default::default()
            },
            until_date: Some(1700000000),
            use_independent_chat_permissions: false,
        };
        let body = build_restrict_chat_member(&req);
        assert_eq!(body["user_id"], 42);
        assert_eq!(body["until_date"], 1700000000i64);
    }

    #[test]
    fn build_promote_member() {
        let req = PromoteChatMemberRequest {
            chat_id: ChatId::Numeric(1),
            user_id: 42,
            is_anonymous: Some(false),
            can_manage_chat: Some(true),
            can_post_messages: None,
            can_edit_messages: None,
            can_delete_messages: Some(true),
            can_manage_video_chats: None,
            can_restrict_members: None,
            can_promote_members: None,
            can_change_info: None,
            can_invite_users: Some(true),
            can_pin_messages: None,
            can_manage_topics: None,
        };
        let body = build_promote_chat_member(&req);
        assert_eq!(body["user_id"], 42);
        assert_eq!(body["can_manage_chat"], true);
        assert_eq!(body["can_delete_messages"], true);
        assert_eq!(body["can_invite_users"], true);
        assert!(body.get("can_post_messages").is_none());
    }

    #[test]
    fn build_set_permissions() {
        let perms = ChatPermissions {
            can_send_messages: Some(true),
            can_send_photos: Some(false),
            ..Default::default()
        };
        let body = build_set_chat_permissions(&ChatId::Numeric(1), &perms, true);
        assert_eq!(body["use_independent_chat_permissions"], true);
    }

    #[test]
    fn build_export_invite_link() {
        let body = build_export_chat_invite_link(&ChatId::Numeric(1));
        assert_eq!(body["chat_id"], 1);
    }

    #[test]
    fn build_create_invite() {
        let body = build_create_invite_link(
            &ChatId::Numeric(1),
            Some("VIP"),
            Some(1700000000),
            Some(50),
            true,
        );
        assert_eq!(body["name"], "VIP");
        assert_eq!(body["expire_date"], 1700000000i64);
        assert_eq!(body["member_limit"], 50);
        assert_eq!(body["creates_join_request"], true);
    }

    #[test]
    fn build_revoke_invite() {
        let body =
            build_revoke_invite_link(&ChatId::Numeric(1), "https://t.me/+abc123");
        assert_eq!(body["invite_link"], "https://t.me/+abc123");
    }

    #[test]
    fn build_admin_title() {
        let body =
            build_set_admin_custom_title(&ChatId::Numeric(1), 42, "Supreme Leader");
        assert_eq!(body["custom_title"], "Supreme Leader");
    }

    #[test]
    fn build_leave_chat_test() {
        let body = build_leave_chat(&ChatId::Numeric(1));
        assert_eq!(body["chat_id"], 1);
    }

    #[test]
    fn build_get_admins() {
        let body = build_get_chat_administrators(&ChatId::Numeric(1));
        assert_eq!(body["chat_id"], 1);
    }
}
