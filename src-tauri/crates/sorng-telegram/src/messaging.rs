//! Messaging — send text, media, locations, contacts, polls, dice, stickers.

use crate::types::*;
use serde_json::json;

/// Build the JSON body for `sendMessage`.
pub fn build_send_message(req: &SendMessageRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "text": req.text,
    });
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if req.disable_web_page_preview {
        body["disable_web_page_preview"] = json!(true);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref tid) = req.message_thread_id {
        body["message_thread_id"] = json!(tid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendPhoto`.
pub fn build_send_photo(req: &SendPhotoRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "photo": req.photo,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    if req.has_spoiler {
        body["has_spoiler"] = json!(true);
    }
    body
}

/// Build the JSON body for `sendDocument`.
pub fn build_send_document(req: &SendDocumentRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "document": req.document,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendVideo`.
pub fn build_send_video(req: &SendVideoRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "video": req.video,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if let Some(d) = req.duration {
        body["duration"] = json!(d);
    }
    if let Some(w) = req.width {
        body["width"] = json!(w);
    }
    if let Some(h) = req.height {
        body["height"] = json!(h);
    }
    if req.supports_streaming {
        body["supports_streaming"] = json!(true);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    if req.has_spoiler {
        body["has_spoiler"] = json!(true);
    }
    body
}

/// Build the JSON body for `sendAudio`.
pub fn build_send_audio(req: &SendAudioRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "audio": req.audio,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if let Some(d) = req.duration {
        body["duration"] = json!(d);
    }
    if let Some(ref p) = req.performer {
        body["performer"] = json!(p);
    }
    if let Some(ref t) = req.title {
        body["title"] = json!(t);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendVoice`.
pub fn build_send_voice(req: &SendVoiceRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "voice": req.voice,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if let Some(d) = req.duration {
        body["duration"] = json!(d);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendLocation`.
pub fn build_send_location(req: &SendLocationRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "latitude": req.latitude,
        "longitude": req.longitude,
    });
    if let Some(ha) = req.horizontal_accuracy {
        body["horizontal_accuracy"] = json!(ha);
    }
    if let Some(lp) = req.live_period {
        body["live_period"] = json!(lp);
    }
    if let Some(h) = req.heading {
        body["heading"] = json!(h);
    }
    if let Some(par) = req.proximity_alert_radius {
        body["proximity_alert_radius"] = json!(par);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendContact`.
pub fn build_send_contact(req: &SendContactRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "phone_number": req.phone_number,
        "first_name": req.first_name,
    });
    if let Some(ref ln) = req.last_name {
        body["last_name"] = json!(ln);
    }
    if let Some(ref vc) = req.vcard {
        body["vcard"] = json!(vc);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendPoll`.
pub fn build_send_poll(req: &SendPollRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "question": req.question,
        "options": req.options,
    });
    if let Some(anon) = req.is_anonymous {
        body["is_anonymous"] = json!(anon);
    }
    if let Some(ref pt) = req.poll_type {
        body["type"] = json!(pt);
    }
    if req.allows_multiple_answers {
        body["allows_multiple_answers"] = json!(true);
    }
    if let Some(coid) = req.correct_option_id {
        body["correct_option_id"] = json!(coid);
    }
    if let Some(ref exp) = req.explanation {
        body["explanation"] = json!(exp);
    }
    if let Some(ref epm) = req.explanation_parse_mode {
        body["explanation_parse_mode"] = json!(epm);
    }
    if let Some(op) = req.open_period {
        body["open_period"] = json!(op);
    }
    if let Some(cd) = req.close_date {
        body["close_date"] = json!(cd);
    }
    if req.is_closed {
        body["is_closed"] = json!(true);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendDice`.
pub fn build_send_dice(req: &SendDiceRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "emoji": req.emoji,
    });
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `sendSticker`.
pub fn build_send_sticker(req: &SendStickerRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "sticker": req.sticker,
    });
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    if let Some(ref e) = req.emoji {
        body["emoji"] = json!(e);
    }
    body
}

/// Build the JSON body for `sendChatAction`.
pub fn build_send_chat_action(chat_id: &ChatId, action: &ChatAction) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "action": action,
    })
}

/// Build the JSON body for `editMessageText`.
pub fn build_edit_message_text(req: &EditMessageTextRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "message_id": req.message_id,
        "text": req.text,
    });
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if req.disable_web_page_preview {
        body["disable_web_page_preview"] = json!(true);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `editMessageCaption`.
pub fn build_edit_message_caption(req: &EditMessageCaptionRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "message_id": req.message_id,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `editMessageReplyMarkup`.
pub fn build_edit_reply_markup(req: &EditMessageReplyMarkupRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "message_id": req.message_id,
    });
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `forwardMessage`.
pub fn build_forward_message(req: &ForwardMessageRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "from_chat_id": chat_id_value(&req.from_chat_id),
        "message_id": req.message_id,
    });
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    body
}

/// Build the JSON body for `copyMessage`.
pub fn build_copy_message(req: &CopyMessageRequest) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(&req.chat_id),
        "from_chat_id": chat_id_value(&req.from_chat_id),
        "message_id": req.message_id,
    });
    if let Some(ref c) = req.caption {
        body["caption"] = json!(c);
    }
    if let Some(ref pm) = req.parse_mode {
        body["parse_mode"] = json!(pm);
    }
    if req.disable_notification {
        body["disable_notification"] = json!(true);
    }
    if req.protect_content {
        body["protect_content"] = json!(true);
    }
    if let Some(mid) = req.reply_to_message_id {
        body["reply_to_message_id"] = json!(mid);
    }
    if let Some(ref rm) = req.reply_markup {
        body["reply_markup"] = serde_json::to_value(rm).unwrap_or_default();
    }
    body
}

/// Build the JSON body for `deleteMessage`.
pub fn build_delete_message(chat_id: &ChatId, message_id: i64) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
        "message_id": message_id,
    })
}

/// Build the JSON body for `pinChatMessage`.
pub fn build_pin_message(
    chat_id: &ChatId,
    message_id: i64,
    disable_notification: bool,
) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(chat_id),
        "message_id": message_id,
    });
    if disable_notification {
        body["disable_notification"] = json!(true);
    }
    body
}

/// Build the JSON body for `unpinChatMessage`.
pub fn build_unpin_message(chat_id: &ChatId, message_id: Option<i64>) -> serde_json::Value {
    let mut body = json!({
        "chat_id": chat_id_value(chat_id),
    });
    if let Some(mid) = message_id {
        body["message_id"] = json!(mid);
    }
    body
}

/// Build the JSON body for `unpinAllChatMessages`.
pub fn build_unpin_all_messages(chat_id: &ChatId) -> serde_json::Value {
    json!({
        "chat_id": chat_id_value(chat_id),
    })
}

/// Build the JSON body for `answerCallbackQuery`.
pub fn build_answer_callback_query(req: &AnswerCallbackQueryRequest) -> serde_json::Value {
    let mut body = json!({
        "callback_query_id": req.callback_query_id,
    });
    if let Some(ref t) = req.text {
        body["text"] = json!(t);
    }
    if req.show_alert {
        body["show_alert"] = json!(true);
    }
    if let Some(ref u) = req.url {
        body["url"] = json!(u);
    }
    if let Some(ct) = req.cache_time {
        body["cache_time"] = json!(ct);
    }
    body
}

/// Convert ChatId to a JSON value.
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
    fn build_send_message_minimal() {
        let req = SendMessageRequest {
            chat_id: ChatId::Numeric(12345),
            text: "Hello".to_string(),
            parse_mode: None,
            disable_web_page_preview: false,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
            message_thread_id: None,
        };
        let body = build_send_message(&req);
        assert_eq!(body["chat_id"], 12345);
        assert_eq!(body["text"], "Hello");
        assert!(body.get("parse_mode").is_none());
    }

    #[test]
    fn build_send_message_full() {
        let req = SendMessageRequest {
            chat_id: ChatId::Username("@mychannel".to_string()),
            text: "**Bold**".to_string(),
            parse_mode: Some(ParseMode::MarkdownV2),
            disable_web_page_preview: true,
            disable_notification: true,
            protect_content: true,
            reply_to_message_id: Some(42),
            reply_markup: None,
            message_thread_id: Some(7),
        };
        let body = build_send_message(&req);
        assert_eq!(body["chat_id"], "@mychannel");
        assert_eq!(body["parse_mode"], "MarkdownV2");
        assert_eq!(body["disable_web_page_preview"], true);
        assert_eq!(body["disable_notification"], true);
        assert_eq!(body["protect_content"], true);
        assert_eq!(body["reply_to_message_id"], 42);
        assert_eq!(body["message_thread_id"], 7);
    }

    #[test]
    fn build_send_photo_minimal() {
        let req = SendPhotoRequest {
            chat_id: ChatId::Numeric(1),
            photo: "AgACAgI...".to_string(),
            caption: None,
            parse_mode: None,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
            has_spoiler: false,
        };
        let body = build_send_photo(&req);
        assert_eq!(body["chat_id"], 1);
        assert_eq!(body["photo"], "AgACAgI...");
    }

    #[test]
    fn build_send_location_test() {
        let req = SendLocationRequest {
            chat_id: ChatId::Numeric(1),
            latitude: 48.8566,
            longitude: 2.3522,
            horizontal_accuracy: Some(10.0),
            live_period: None,
            heading: None,
            proximity_alert_radius: None,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_location(&req);
        assert_eq!(body["latitude"], 48.8566);
        assert_eq!(body["longitude"], 2.3522);
        assert_eq!(body["horizontal_accuracy"], 10.0);
    }

    #[test]
    fn build_send_poll_test() {
        let req = SendPollRequest {
            chat_id: ChatId::Numeric(1),
            question: "Favorite color?".to_string(),
            options: vec!["Red".to_string(), "Blue".to_string(), "Green".to_string()],
            is_anonymous: Some(true),
            poll_type: Some("quiz".to_string()),
            allows_multiple_answers: false,
            correct_option_id: Some(1),
            explanation: Some("Blue is the best".to_string()),
            explanation_parse_mode: None,
            open_period: None,
            close_date: None,
            is_closed: false,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_poll(&req);
        assert_eq!(body["question"], "Favorite color?");
        assert_eq!(body["options"].as_array().unwrap().len(), 3);
        assert_eq!(body["correct_option_id"], 1);
    }

    #[test]
    fn build_send_dice_test() {
        let req = SendDiceRequest {
            chat_id: ChatId::Numeric(1),
            emoji: "🎯".to_string(),
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_dice(&req);
        assert_eq!(body["emoji"], "🎯");
    }

    #[test]
    fn build_edit_text_test() {
        let req = EditMessageTextRequest {
            chat_id: ChatId::Numeric(1),
            message_id: 100,
            text: "Updated".to_string(),
            parse_mode: Some(ParseMode::Html),
            disable_web_page_preview: false,
            reply_markup: None,
        };
        let body = build_edit_message_text(&req);
        assert_eq!(body["message_id"], 100);
        assert_eq!(body["text"], "Updated");
        assert_eq!(body["parse_mode"], "HTML");
    }

    #[test]
    fn build_forward_test() {
        let req = ForwardMessageRequest {
            chat_id: ChatId::Numeric(1),
            from_chat_id: ChatId::Numeric(2),
            message_id: 50,
            disable_notification: true,
            protect_content: false,
        };
        let body = build_forward_message(&req);
        assert_eq!(body["from_chat_id"], 2);
        assert_eq!(body["message_id"], 50);
        assert_eq!(body["disable_notification"], true);
    }

    #[test]
    fn build_delete_test() {
        let body = build_delete_message(&ChatId::Numeric(1), 42);
        assert_eq!(body["chat_id"], 1);
        assert_eq!(body["message_id"], 42);
    }

    #[test]
    fn build_pin_test() {
        let body = build_pin_message(&ChatId::Numeric(1), 42, true);
        assert_eq!(body["message_id"], 42);
        assert_eq!(body["disable_notification"], true);
    }

    #[test]
    fn build_unpin_test() {
        let body = build_unpin_message(&ChatId::Numeric(1), Some(42));
        assert_eq!(body["message_id"], 42);
    }

    #[test]
    fn build_unpin_all_test() {
        let body = build_unpin_all_messages(&ChatId::Numeric(1));
        assert_eq!(body["chat_id"], 1);
    }

    #[test]
    fn build_answer_callback_test() {
        let req = AnswerCallbackQueryRequest {
            callback_query_id: "abc123".to_string(),
            text: Some("Done!".to_string()),
            show_alert: true,
            url: None,
            cache_time: Some(60),
        };
        let body = build_answer_callback_query(&req);
        assert_eq!(body["callback_query_id"], "abc123");
        assert_eq!(body["text"], "Done!");
        assert_eq!(body["show_alert"], true);
        assert_eq!(body["cache_time"], 60);
    }

    #[test]
    fn build_chat_action_test() {
        let body = build_send_chat_action(&ChatId::Numeric(1), &ChatAction::Typing);
        assert_eq!(body["action"], "typing");
    }

    #[test]
    fn chat_id_display() {
        assert_eq!(format!("{}", ChatId::Numeric(123)), "123");
        assert_eq!(format!("{}", ChatId::Username("@test".to_string())), "@test");
    }

    #[test]
    fn build_send_sticker_test() {
        let req = SendStickerRequest {
            chat_id: ChatId::Numeric(1),
            sticker: "CAACAgI...".to_string(),
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
            emoji: Some("😀".to_string()),
        };
        let body = build_send_sticker(&req);
        assert_eq!(body["sticker"], "CAACAgI...");
        assert_eq!(body["emoji"], "😀");
    }

    #[test]
    fn build_send_contact_test() {
        let req = SendContactRequest {
            chat_id: ChatId::Numeric(1),
            phone_number: "+1234567890".to_string(),
            first_name: "John".to_string(),
            last_name: Some("Doe".to_string()),
            vcard: None,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_contact(&req);
        assert_eq!(body["phone_number"], "+1234567890");
        assert_eq!(body["first_name"], "John");
        assert_eq!(body["last_name"], "Doe");
    }

    #[test]
    fn build_copy_message_test() {
        let req = CopyMessageRequest {
            chat_id: ChatId::Numeric(1),
            from_chat_id: ChatId::Numeric(2),
            message_id: 10,
            caption: Some("Copied!".to_string()),
            parse_mode: None,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_copy_message(&req);
        assert_eq!(body["from_chat_id"], 2);
        assert_eq!(body["message_id"], 10);
        assert_eq!(body["caption"], "Copied!");
    }

    #[test]
    fn build_send_voice_test() {
        let req = SendVoiceRequest {
            chat_id: ChatId::Numeric(1),
            voice: "AwACAgI...".to_string(),
            caption: Some("Listen".to_string()),
            parse_mode: None,
            duration: Some(30),
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_voice(&req);
        assert_eq!(body["voice"], "AwACAgI...");
        assert_eq!(body["duration"], 30);
        assert_eq!(body["caption"], "Listen");
    }

    #[test]
    fn build_send_audio_test() {
        let req = SendAudioRequest {
            chat_id: ChatId::Numeric(1),
            audio: "CQACAgI...".to_string(),
            caption: None,
            parse_mode: None,
            duration: Some(180),
            performer: Some("Artist".to_string()),
            title: Some("Song".to_string()),
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
        };
        let body = build_send_audio(&req);
        assert_eq!(body["audio"], "CQACAgI...");
        assert_eq!(body["performer"], "Artist");
        assert_eq!(body["title"], "Song");
    }

    #[test]
    fn build_send_document_test() {
        let req = SendDocumentRequest {
            chat_id: ChatId::Numeric(1),
            document: "BQACAgI...".to_string(),
            caption: Some("Here's the file".to_string()),
            parse_mode: Some(ParseMode::Markdown),
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
            file_name: None,
        };
        let body = build_send_document(&req);
        assert_eq!(body["document"], "BQACAgI...");
        assert_eq!(body["caption"], "Here's the file");
        assert_eq!(body["parse_mode"], "Markdown");
    }

    #[test]
    fn build_send_video_test() {
        let req = SendVideoRequest {
            chat_id: ChatId::Numeric(1),
            video: "BAACAgI...".to_string(),
            caption: None,
            parse_mode: None,
            duration: Some(60),
            width: Some(1920),
            height: Some(1080),
            supports_streaming: true,
            disable_notification: false,
            protect_content: false,
            reply_to_message_id: None,
            reply_markup: None,
            has_spoiler: true,
        };
        let body = build_send_video(&req);
        assert_eq!(body["video"], "BAACAgI...");
        assert_eq!(body["duration"], 60);
        assert_eq!(body["width"], 1920);
        assert_eq!(body["supports_streaming"], true);
        assert_eq!(body["has_spoiler"], true);
    }

    #[test]
    fn build_edit_caption_test() {
        let req = EditMessageCaptionRequest {
            chat_id: ChatId::Numeric(1),
            message_id: 55,
            caption: Some("New caption".to_string()),
            parse_mode: None,
            reply_markup: None,
        };
        let body = build_edit_message_caption(&req);
        assert_eq!(body["message_id"], 55);
        assert_eq!(body["caption"], "New caption");
    }

    #[test]
    fn build_edit_reply_markup_test() {
        let req = EditMessageReplyMarkupRequest {
            chat_id: ChatId::Numeric(1),
            message_id: 55,
            reply_markup: None,
        };
        let body = build_edit_reply_markup(&req);
        assert_eq!(body["message_id"], 55);
    }
}
