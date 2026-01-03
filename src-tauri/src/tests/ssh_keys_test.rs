#[cfg(test)]
mod tests {
    use crate::ssh::{SshService, SshServiceState};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn test_generate_ed25519_key() {
        let service = SshService::new();
        let mut ssh = service.lock().await;

        let result = ssh.generate_ssh_key("ed25519", None, None).await;
        assert!(result.is_ok(), "Failed to generate Ed25519 key");

        let (private_key, public_key) = result.unwrap();
        
        assert!(private_key.contains("OPENSSH PRIVATE KEY"), "Private key should be OpenSSH format");
        assert!(public_key.contains("ssh-ed25519"), "Public key should be ssh-ed25519");
    }

    #[tokio::test]
    async fn test_generate_rsa_key_fail() {
        let service = SshService::new();
        let mut ssh = service.lock().await;

        let result = ssh.generate_ssh_key("rsa", Some(2048), None).await;
        // Currently RSA generation is stubbed to error
        assert!(result.is_err(), "RSA generation should fail as it is not implemented yet");
    }
}
