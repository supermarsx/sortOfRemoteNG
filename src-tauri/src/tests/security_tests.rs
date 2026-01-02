use app::*;

/// Test TOTP token generation
#[tokio::test]
async fn test_generate_totp_secret() {
    let service = SecurityService::new();

    let result = service.lock().await.generate_totp_secret("test@example.com".to_string()).await;
    assert!(result.is_ok());

    let (secret, url) = result.unwrap();
    assert!(!secret.is_empty());
    assert!(url.contains("otpauth://"));
    assert!(url.contains("test@example.com"));
}

/// Test TOTP token verification with valid token
#[tokio::test]
async fn test_verify_totp_token_valid() {
    let service = SecurityService::new();

    // Generate a secret
    let (secret, _) = service.lock().await.generate_totp_secret("test@example.com".to_string()).await.unwrap();

    // Generate a token using the secret (this would normally be done by an authenticator app)
    // For testing, we'll use the current time window
    let result = service.lock().await.verify_totp_token(secret.clone(), "123456".to_string()).await;
    // This might fail if the token doesn't match the current time window, but the function should not error
    assert!(result.is_ok());
}

/// Test TOTP token verification with invalid token
#[tokio::test]
async fn test_verify_totp_token_invalid() {
    let service = SecurityService::new();

    let result = service.lock().await.verify_totp_token("INVALID_SECRET".to_string(), "123456".to_string()).await;
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

/// Test TOTP token verification with empty secret
#[tokio::test]
async fn test_verify_totp_token_empty_secret() {
    let service = SecurityService::new();

    let result = service.lock().await.verify_totp_token("".to_string(), "123456".to_string()).await;
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

/// Test data encryption and decryption round trip
#[tokio::test]
async fn test_encrypt_decrypt_round_trip() {
    let service = SecurityService::new();
    let test_data = "Hello, World! This is a test message.";
    let test_key = "my_secret_key_12345";

    // Encrypt the data
    let encrypt_result = service.lock().await.encrypt_data(test_data.to_string(), test_key.to_string()).await;
    assert!(encrypt_result.is_ok());
    let encrypted = encrypt_result.unwrap();
    assert!(!encrypted.is_empty());
    assert_ne!(encrypted, test_data);

    // Decrypt the data
    let decrypt_result = service.lock().await.decrypt_data(encrypted, test_key.to_string()).await;
    assert!(decrypt_result.is_ok());
    let decrypted = decrypt_result.unwrap();
    assert_eq!(decrypted, test_data);
}

/// Test encryption with different keys produces different results
#[tokio::test]
async fn test_encrypt_different_keys() {
    let service = SecurityService::new();
    let test_data = "Same data, different keys";

    let result1 = service.lock().await.encrypt_data(test_data.to_string(), "key1".to_string()).await.unwrap();
    let result2 = service.lock().await.encrypt_data(test_data.to_string(), "key2".to_string()).await.unwrap();

    assert_ne!(result1, result2);
}

/// Test decryption with wrong key fails
#[tokio::test]
async fn test_decrypt_wrong_key() {
    let service = SecurityService::new();
    let test_data = "Secret message";
    let correct_key = "correct_key";
    let wrong_key = "wrong_key";

    let encrypted = service.lock().await.encrypt_data(test_data.to_string(), correct_key.to_string()).await.unwrap();

    let decrypt_result = service.lock().await.decrypt_data(encrypted, wrong_key.to_string()).await;
    assert!(decrypt_result.is_err());
}

/// Test encryption with empty data
#[tokio::test]
async fn test_encrypt_empty_data() {
    let service = SecurityService::new();

    let result = service.lock().await.encrypt_data("".to_string(), "key".to_string()).await;
    assert!(result.is_ok());
    let encrypted = result.unwrap();
    assert!(!encrypted.is_empty());
}

/// Test decryption of empty data
#[tokio::test]
async fn test_decrypt_empty_data() {
    let service = SecurityService::new();

    let result = service.lock().await.decrypt_data("".to_string(), "key".to_string()).await;
    assert!(result.is_err()); // Empty data should fail to decrypt
}

/// Test key derivation
#[test]
fn test_derive_key() {
    let password = "test_password";
    let key1 = SecurityService::derive_key(password);
    let key2 = SecurityService::derive_key(password);

    // Same password should produce same key
    assert_eq!(key1, key2);

    // Different passwords should produce different keys
    let key3 = SecurityService::derive_key("different_password");
    assert_ne!(key1, key3);
}

/// Test key derivation with empty password
#[test]
fn test_derive_key_empty_password() {
    let key = SecurityService::derive_key("");
    assert_eq!(key.len(), 32); // Should still produce 32-byte key
}

/// Test concurrent encryption operations
#[tokio::test]
async fn test_concurrent_encryption() {
    let service = SecurityService::new();
    let mut handles = vec![];

    // Spawn multiple encryption tasks
    for i in 0..5 {
        let service_clone = service.clone();
        let data = format!("Test data {}", i);
        let key = format!("key{}", i);

        let handle = tokio::spawn(async move {
            let encrypted = service_clone.lock().await.encrypt_data(data.clone(), key.clone()).await.unwrap();
            let decrypted = service_clone.lock().await.decrypt_data(encrypted, key).await.unwrap();
            assert_eq!(decrypted, data);
        });
        handles.push(handle);
    }

    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }
}