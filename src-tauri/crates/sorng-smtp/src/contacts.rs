//! Contact / address-book management + group operations + import/export.

use chrono::Utc;
use log::debug;

use crate::types::*;

/// In-memory contact store.
pub struct ContactStore {
    contacts: Vec<Contact>,
    groups: Vec<ContactGroup>,
}

impl ContactStore {
    pub fn new() -> Self {
        Self {
            contacts: Vec::new(),
            groups: Vec::new(),
        }
    }

    // ── Contacts ────────────────────────────────────────────────

    /// Add a new contact.
    pub fn add_contact(&mut self, contact: Contact) -> SmtpResult<String> {
        // Check for duplicate email
        if self.contacts.iter().any(|c| c.email == contact.email) {
            return Err(SmtpError::contact(format!(
                "Contact with email {} already exists",
                contact.email
            )));
        }
        let id = contact.id.clone();
        debug!("Adding contact: {} ({})", contact.email, id);
        self.contacts.push(contact);
        Ok(id)
    }

    /// Update an existing contact.
    pub fn update_contact(&mut self, contact: Contact) -> SmtpResult<()> {
        let existing = self
            .contacts
            .iter_mut()
            .find(|c| c.id == contact.id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", contact.id)))?;
        *existing = Contact {
            updated_at: Utc::now(),
            ..contact
        };
        Ok(())
    }

    /// Delete a contact by ID.
    pub fn delete_contact(&mut self, id: &str) -> SmtpResult<()> {
        let pos = self
            .contacts
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", id)))?;
        self.contacts.remove(pos);
        Ok(())
    }

    /// Get a contact by ID.
    pub fn get_contact(&self, id: &str) -> Option<&Contact> {
        self.contacts.iter().find(|c| c.id == id)
    }

    /// Find a contact by email.
    pub fn find_by_email(&self, email: &str) -> Option<&Contact> {
        self.contacts.iter().find(|c| c.email == email)
    }

    /// Search contacts by name or email.
    pub fn search(&self, query: &str) -> Vec<&Contact> {
        let q = query.to_lowercase();
        self.contacts
            .iter()
            .filter(|c| {
                c.email.to_lowercase().contains(&q)
                    || c.name
                        .as_ref()
                        .map(|n| n.to_lowercase().contains(&q))
                        .unwrap_or(false)
                    || c.organization
                        .as_ref()
                        .map(|o| o.to_lowercase().contains(&q))
                        .unwrap_or(false)
            })
            .collect()
    }

    /// List all contacts.
    pub fn list_contacts(&self) -> &[Contact] {
        &self.contacts
    }

    /// List contacts in a specific group.
    pub fn list_contacts_in_group(&self, group_name: &str) -> Vec<&Contact> {
        self.contacts
            .iter()
            .filter(|c| c.groups.iter().any(|g| g == group_name))
            .collect()
    }

    /// List contacts by tag.
    pub fn list_contacts_by_tag(&self, tag: &str) -> Vec<&Contact> {
        self.contacts
            .iter()
            .filter(|c| c.tags.iter().any(|t| t == tag))
            .collect()
    }

    /// Add a contact to a group.
    pub fn add_to_group(&mut self, contact_id: &str, group_name: &str) -> SmtpResult<()> {
        let contact = self
            .contacts
            .iter_mut()
            .find(|c| c.id == contact_id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", contact_id)))?;
        if !contact.groups.contains(&group_name.to_string()) {
            contact.groups.push(group_name.to_string());
            contact.updated_at = Utc::now();
        }
        Ok(())
    }

    /// Remove a contact from a group.
    pub fn remove_from_group(&mut self, contact_id: &str, group_name: &str) -> SmtpResult<()> {
        let contact = self
            .contacts
            .iter_mut()
            .find(|c| c.id == contact_id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", contact_id)))?;
        contact.groups.retain(|g| g != group_name);
        contact.updated_at = Utc::now();
        Ok(())
    }

    /// Tag a contact.
    pub fn add_tag(&mut self, contact_id: &str, tag: &str) -> SmtpResult<()> {
        let contact = self
            .contacts
            .iter_mut()
            .find(|c| c.id == contact_id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", contact_id)))?;
        if !contact.tags.contains(&tag.to_string()) {
            contact.tags.push(tag.to_string());
            contact.updated_at = Utc::now();
        }
        Ok(())
    }

    /// Remove a tag from a contact.
    pub fn remove_tag(&mut self, contact_id: &str, tag: &str) -> SmtpResult<()> {
        let contact = self
            .contacts
            .iter_mut()
            .find(|c| c.id == contact_id)
            .ok_or_else(|| SmtpError::contact(format!("Contact not found: {}", contact_id)))?;
        contact.tags.retain(|t| t != tag);
        contact.updated_at = Utc::now();
        Ok(())
    }

    /// Convert contacts to email addresses.
    pub fn to_email_addresses(&self, contact_ids: &[&str]) -> Vec<EmailAddress> {
        contact_ids
            .iter()
            .filter_map(|id| self.get_contact(id))
            .map(|c| c.to_email_address())
            .collect()
    }

    /// Convert all contacts in a group to email addresses.
    pub fn group_to_email_addresses(&self, group_name: &str) -> Vec<EmailAddress> {
        self.list_contacts_in_group(group_name)
            .iter()
            .map(|c| c.to_email_address())
            .collect()
    }

    // ── Groups ──────────────────────────────────────────────────

    /// Create a group.
    pub fn create_group(&mut self, group: ContactGroup) -> SmtpResult<String> {
        if self.groups.iter().any(|g| g.name == group.name) {
            return Err(SmtpError::contact(format!(
                "Group '{}' already exists",
                group.name
            )));
        }
        let id = group.id.clone();
        self.groups.push(group);
        Ok(id)
    }

    /// Delete a group by ID (does NOT remove contacts from the group).
    pub fn delete_group(&mut self, id: &str) -> SmtpResult<()> {
        let pos = self
            .groups
            .iter()
            .position(|g| g.id == id)
            .ok_or_else(|| SmtpError::contact(format!("Group not found: {}", id)))?;

        let group_name = self.groups[pos].name.clone();

        // Remove group membership from all contacts
        for contact in &mut self.contacts {
            contact.groups.retain(|g| g != &group_name);
        }

        self.groups.remove(pos);
        Ok(())
    }

    /// Rename a group.
    pub fn rename_group(&mut self, id: &str, new_name: &str) -> SmtpResult<()> {
        let group = self
            .groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| SmtpError::contact(format!("Group not found: {}", id)))?;

        let old_name = group.name.clone();
        group.name = new_name.to_string();
        group.updated_at = Utc::now();

        // Update group membership in contacts
        for contact in &mut self.contacts {
            for g in &mut contact.groups {
                if *g == old_name {
                    *g = new_name.to_string();
                }
            }
        }
        Ok(())
    }

    /// List all groups.
    pub fn list_groups(&self) -> &[ContactGroup] {
        &self.groups
    }

    /// Get a group by ID.
    pub fn get_group(&self, id: &str) -> Option<&ContactGroup> {
        self.groups.iter().find(|g| g.id == id)
    }

    /// Get a group by name.
    pub fn find_group_by_name(&self, name: &str) -> Option<&ContactGroup> {
        self.groups.iter().find(|g| g.name == name)
    }

    // ── Import / Export ─────────────────────────────────────────

    /// Export contacts to CSV.
    pub fn export_csv(&self) -> String {
        let mut csv = String::from("email,name,organization,phone,tags,groups\n");
        for c in &self.contacts {
            csv.push_str(&format!(
                "{},{},{},{},{},{}\n",
                escape_csv(&c.email),
                escape_csv(c.name.as_deref().unwrap_or("")),
                escape_csv(c.organization.as_deref().unwrap_or("")),
                escape_csv(c.phone.as_deref().unwrap_or("")),
                escape_csv(&c.tags.join(";")),
                escape_csv(&c.groups.join(";")),
            ));
        }
        csv
    }

    /// Import contacts from CSV.
    pub fn import_csv(&mut self, csv: &str) -> SmtpResult<usize> {
        let mut imported = 0;
        let mut lines = csv.lines();
        // Skip header
        let header = lines.next().unwrap_or("");
        if !header.to_lowercase().contains("email") {
            return Err(SmtpError::contact("CSV header must contain 'email' column"));
        }

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }
            let fields: Vec<&str> = line.split(',').collect();
            if fields.is_empty() {
                continue;
            }
            let email = fields[0].trim().trim_matches('"');
            if email.is_empty() {
                continue;
            }
            let mut contact = Contact::new(email);
            if let Some(name) = fields.get(1) {
                let n = name.trim().trim_matches('"');
                if !n.is_empty() {
                    contact.name = Some(n.to_string());
                }
            }
            if let Some(org) = fields.get(2) {
                let o = org.trim().trim_matches('"');
                if !o.is_empty() {
                    contact.organization = Some(o.to_string());
                }
            }
            if let Some(phone) = fields.get(3) {
                let p = phone.trim().trim_matches('"');
                if !p.is_empty() {
                    contact.phone = Some(p.to_string());
                }
            }
            if let Some(tags) = fields.get(4) {
                let t = tags.trim().trim_matches('"');
                if !t.is_empty() {
                    contact.tags = t.split(';').map(|s| s.trim().to_string()).collect();
                }
            }
            if let Some(groups) = fields.get(5) {
                let g = groups.trim().trim_matches('"');
                if !g.is_empty() {
                    contact.groups = g.split(';').map(|s| s.trim().to_string()).collect();
                }
            }
            // Skip duplicates
            if self.contacts.iter().any(|c| c.email == contact.email) {
                continue;
            }
            self.contacts.push(contact);
            imported += 1;
        }
        Ok(imported)
    }

    /// Export contacts to JSON.
    pub fn export_json(&self) -> SmtpResult<String> {
        serde_json::to_string_pretty(&self.contacts)
            .map_err(|e| SmtpError::contact(format!("JSON export failed: {}", e)))
    }

    /// Import contacts from JSON.
    pub fn import_json(&mut self, json: &str) -> SmtpResult<usize> {
        let contacts: Vec<Contact> = serde_json::from_str(json)
            .map_err(|e| SmtpError::contact(format!("JSON import failed: {}", e)))?;
        let mut imported = 0;
        for c in contacts {
            if !self
                .contacts
                .iter()
                .any(|existing| existing.email == c.email)
            {
                self.contacts.push(c);
                imported += 1;
            }
        }
        Ok(imported)
    }

    /// Count contacts.
    pub fn count(&self) -> usize {
        self.contacts.len()
    }

    /// Count groups.
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }

    /// Get all unique tags.
    pub fn all_tags(&self) -> Vec<String> {
        let mut tags: Vec<String> = self
            .contacts
            .iter()
            .flat_map(|c| c.tags.iter().cloned())
            .collect();
        tags.sort();
        tags.dedup();
        tags
    }
}

impl Default for ContactStore {
    fn default() -> Self {
        Self::new()
    }
}

fn escape_csv(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_get_contact() {
        let mut store = ContactStore::new();
        let c = Contact::new("alice@example.com");
        let id = store.add_contact(c).unwrap();
        assert!(store.get_contact(&id).is_some());
        assert_eq!(store.count(), 1);
    }

    #[test]
    fn duplicate_email_rejected() {
        let mut store = ContactStore::new();
        store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        assert!(store
            .add_contact(Contact::new("alice@example.com"))
            .is_err());
    }

    #[test]
    fn delete_contact() {
        let mut store = ContactStore::new();
        let id = store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        store.delete_contact(&id).unwrap();
        assert_eq!(store.count(), 0);
    }

    #[test]
    fn find_by_email() {
        let mut store = ContactStore::new();
        store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        assert!(store.find_by_email("alice@example.com").is_some());
        assert!(store.find_by_email("bob@example.com").is_none());
    }

    #[test]
    fn search_contacts() {
        let mut store = ContactStore::new();
        let mut c1 = Contact::new("alice@example.com");
        c1.name = Some("Alice Smith".into());
        let mut c2 = Contact::new("bob@example.com");
        c2.name = Some("Bob Jones".into());
        c2.organization = Some("Acme Corp".into());

        store.add_contact(c1).unwrap();
        store.add_contact(c2).unwrap();

        assert_eq!(store.search("alice").len(), 1);
        assert_eq!(store.search("example").len(), 2);
        assert_eq!(store.search("acme").len(), 1);
    }

    #[test]
    fn groups_crud() {
        let mut store = ContactStore::new();
        let gid = store.create_group(ContactGroup::new("Team")).unwrap();
        assert_eq!(store.group_count(), 1);
        assert!(store.get_group(&gid).is_some());
        assert!(store.find_group_by_name("Team").is_some());

        store.rename_group(&gid, "Engineering").unwrap();
        assert!(store.find_group_by_name("Engineering").is_some());
        assert!(store.find_group_by_name("Team").is_none());

        store.delete_group(&gid).unwrap();
        assert_eq!(store.group_count(), 0);
    }

    #[test]
    fn duplicate_group_rejected() {
        let mut store = ContactStore::new();
        store.create_group(ContactGroup::new("Team")).unwrap();
        assert!(store.create_group(ContactGroup::new("Team")).is_err());
    }

    #[test]
    fn contact_group_membership() {
        let mut store = ContactStore::new();
        let cid = store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        store.create_group(ContactGroup::new("Team")).unwrap();

        store.add_to_group(&cid, "Team").unwrap();
        assert_eq!(store.list_contacts_in_group("Team").len(), 1);

        store.remove_from_group(&cid, "Team").unwrap();
        assert_eq!(store.list_contacts_in_group("Team").len(), 0);
    }

    #[test]
    fn contact_tags() {
        let mut store = ContactStore::new();
        let cid = store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();

        store.add_tag(&cid, "vip").unwrap();
        store.add_tag(&cid, "customer").unwrap();
        assert_eq!(store.list_contacts_by_tag("vip").len(), 1);
        assert_eq!(store.all_tags().len(), 2);

        store.remove_tag(&cid, "vip").unwrap();
        assert_eq!(store.list_contacts_by_tag("vip").len(), 0);
    }

    #[test]
    fn to_email_addresses() {
        let mut store = ContactStore::new();
        let mut c = Contact::new("alice@example.com");
        c.name = Some("Alice".into());
        let cid = store.add_contact(c).unwrap();

        let addrs = store.to_email_addresses(&[&cid]);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].address, "alice@example.com");
        assert_eq!(addrs[0].name, Some("Alice".into()));
    }

    #[test]
    fn group_to_email_addresses() {
        let mut store = ContactStore::new();
        let cid1 = store.add_contact(Contact::new("a@x.com")).unwrap();
        let cid2 = store.add_contact(Contact::new("b@x.com")).unwrap();
        store.add_to_group(&cid1, "team").unwrap();
        store.add_to_group(&cid2, "team").unwrap();

        let addrs = store.group_to_email_addresses("team");
        assert_eq!(addrs.len(), 2);
    }

    #[test]
    fn export_import_csv() {
        let mut store = ContactStore::new();
        let mut c = Contact::new("alice@example.com");
        c.name = Some("Alice".into());
        c.tags = vec!["vip".into()];
        store.add_contact(c).unwrap();

        let csv = store.export_csv();
        assert!(csv.contains("alice@example.com"));

        let mut store2 = ContactStore::new();
        let imported = store2.import_csv(&csv).unwrap();
        assert_eq!(imported, 1);
        assert_eq!(store2.count(), 1);
    }

    #[test]
    fn export_import_json() {
        let mut store = ContactStore::new();
        store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        store.add_contact(Contact::new("bob@example.com")).unwrap();

        let json = store.export_json().unwrap();
        assert!(json.contains("alice@example.com"));

        let mut store2 = ContactStore::new();
        let imported = store2.import_json(&json).unwrap();
        assert_eq!(imported, 2);
    }

    #[test]
    fn import_csv_skips_duplicates() {
        let mut store = ContactStore::new();
        store
            .add_contact(Contact::new("alice@example.com"))
            .unwrap();
        let csv = "email,name\nalice@example.com,Alice\nbob@example.com,Bob\n";
        let imported = store.import_csv(csv).unwrap();
        assert_eq!(imported, 1); // Only bob
        assert_eq!(store.count(), 2);
    }

    #[test]
    fn delete_group_removes_memberships() {
        let mut store = ContactStore::new();
        let cid = store.add_contact(Contact::new("a@x.com")).unwrap();
        let gid = store.create_group(ContactGroup::new("team")).unwrap();
        store.add_to_group(&cid, "team").unwrap();
        store.delete_group(&gid).unwrap();
        let contact = store.get_contact(&cid).unwrap();
        assert!(!contact.groups.contains(&"team".to_string()));
    }

    #[test]
    fn rename_group_updates_memberships() {
        let mut store = ContactStore::new();
        let cid = store.add_contact(Contact::new("a@x.com")).unwrap();
        let gid = store.create_group(ContactGroup::new("old")).unwrap();
        store.add_to_group(&cid, "old").unwrap();
        store.rename_group(&gid, "new").unwrap();
        let contact = store.get_contact(&cid).unwrap();
        assert!(contact.groups.contains(&"new".to_string()));
        assert!(!contact.groups.contains(&"old".to_string()));
    }

    #[test]
    fn escape_csv_special_chars() {
        assert_eq!(escape_csv("normal"), "normal");
        assert_eq!(escape_csv("has,comma"), "\"has,comma\"");
        assert_eq!(escape_csv("has\"quote"), "\"has\"\"quote\"");
    }
}
