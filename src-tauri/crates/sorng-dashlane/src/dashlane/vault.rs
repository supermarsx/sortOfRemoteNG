use crate::dashlane::types::{DashlaneCredential, DashlaneError, SecureNote};

/// Dashlane sync transactions are encrypted. Treating their JSON envelope as
/// plaintext would fabricate vault records and can expose malformed attacker
/// controlled data. Until authenticated decryption is implemented, parsing is
/// deliberately unavailable.
pub(crate) fn parse_vault_transactions(
    _transactions: &[serde_json::Value],
    _encryption_key: &[u8],
) -> Result<VaultData, DashlaneError> {
    Err(DashlaneError::unsupported(
        "Authenticated Dashlane vault decryption is not implemented",
    ))
}

#[derive(Default)]
pub(crate) struct VaultData {
    pub(crate) credentials: Vec<DashlaneCredential>,
    pub(crate) secure_notes: Vec<SecureNote>,
    pub(crate) credit_cards_count: u64,
    pub(crate) bank_accounts_count: u64,
    pub(crate) identities_count: u64,
}
