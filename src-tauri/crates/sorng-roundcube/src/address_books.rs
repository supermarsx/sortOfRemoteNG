// ── Roundcube address book management ─────────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct AddressBookManager;

impl AddressBookManager {
    /// GET /addressbooks — list all address books.
    pub async fn list(client: &RoundcubeClient) -> RoundcubeResult<Vec<RoundcubeAddressBook>> {
        debug!("ROUNDCUBE list_address_books");
        client.get("/addressbooks").await
    }

    /// GET /addressbooks/:id — get a single address book.
    pub async fn get(client: &RoundcubeClient, id: &str) -> RoundcubeResult<RoundcubeAddressBook> {
        debug!("ROUNDCUBE get_address_book id={id}");
        client.get(&format!("/addressbooks/{id}")).await
    }

    /// GET /addressbooks/:book_id/contacts — list contacts in an address book.
    pub async fn list_contacts(client: &RoundcubeClient, book_id: &str) -> RoundcubeResult<Vec<RoundcubeContact>> {
        debug!("ROUNDCUBE list_contacts book_id={book_id}");
        client.get(&format!("/addressbooks/{book_id}/contacts")).await
    }

    /// GET /addressbooks/:book_id/contacts/:contact_id — get a single contact.
    pub async fn get_contact(client: &RoundcubeClient, book_id: &str, contact_id: &str) -> RoundcubeResult<RoundcubeContact> {
        debug!("ROUNDCUBE get_contact book_id={book_id} contact_id={contact_id}");
        client.get(&format!("/addressbooks/{book_id}/contacts/{contact_id}")).await
    }

    /// POST /addressbooks/:book_id/contacts — create a contact.
    pub async fn create_contact(client: &RoundcubeClient, book_id: &str, req: &CreateContactRequest) -> RoundcubeResult<RoundcubeContact> {
        debug!("ROUNDCUBE create_contact book_id={book_id}");
        client.post(&format!("/addressbooks/{book_id}/contacts"), req).await
    }

    /// PUT /addressbooks/:book_id/contacts/:contact_id — update a contact.
    pub async fn update_contact(client: &RoundcubeClient, book_id: &str, contact_id: &str, req: &UpdateContactRequest) -> RoundcubeResult<RoundcubeContact> {
        debug!("ROUNDCUBE update_contact book_id={book_id} contact_id={contact_id}");
        client.put(&format!("/addressbooks/{book_id}/contacts/{contact_id}"), req).await
    }

    /// DELETE /addressbooks/:book_id/contacts/:contact_id — delete a contact.
    pub async fn delete_contact(client: &RoundcubeClient, book_id: &str, contact_id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE delete_contact book_id={book_id} contact_id={contact_id}");
        client.delete(&format!("/addressbooks/{book_id}/contacts/{contact_id}")).await
    }

    /// GET /addressbooks/:book_id/contacts/search?q=:query — search contacts.
    pub async fn search_contacts(client: &RoundcubeClient, book_id: &str, query: &str) -> RoundcubeResult<Vec<RoundcubeContact>> {
        debug!("ROUNDCUBE search_contacts book_id={book_id} query={query}");
        let encoded = urlencoding_encode(query);
        client.get(&format!("/addressbooks/{book_id}/contacts/search?q={encoded}")).await
    }

    /// GET /addressbooks/:book_id/contacts/:contact_id/vcard — export vCard.
    pub async fn export_vcard(client: &RoundcubeClient, book_id: &str, contact_id: &str) -> RoundcubeResult<String> {
        debug!("ROUNDCUBE export_vcard book_id={book_id} contact_id={contact_id}");
        client.get_raw(&format!("/addressbooks/{book_id}/contacts/{contact_id}/vcard")).await
    }
}

/// Minimal percent-encoding for query parameters.
fn urlencoding_encode(input: &str) -> String {
    let mut result = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push('%');
                result.push_str(&format!("{b:02X}"));
            }
        }
    }
    result
}
