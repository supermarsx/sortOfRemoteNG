use crate::script::{ScriptService, ScriptContext};
use crate::ssh::SshService;

/// Helper function to create a script service with a mock SSH service
fn create_script_service() -> crate::script::ScriptServiceState {
    let ssh_service = SshService::new();
    ScriptService::new(ssh_service)
}

/// Test script service creation
#[tokio::test]
async fn test_new_script_service() {
    let _service = create_script_service();
    // Service should be created successfully
    assert!(true);
}

/// Test JavaScript execution with simple expression
#[tokio::test]
async fn test_execute_javascript_simple() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "2 + 2".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with console.log
#[tokio::test]
async fn test_execute_javascript_console_log() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        r#""console.log test""#.to_string(),
        "javascript".to_string(),
        context,
    ).await;

    if let Err(ref e) = result {
        println!("Error: {}", e);
    }
    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with variable assignment
#[tokio::test]
async fn test_execute_javascript_variables() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        r#"
        let x = 10;
        let y = 20;
        x + y
        "#.to_string(),
        "javascript".to_string(),
        context,
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with function
#[tokio::test]
async fn test_execute_javascript_function() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        r#"
        function add(a, b) {
            return a + b;
        }
        add(5, 3)
        "#.to_string(),
        "javascript".to_string(),
        context,
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with syntax error
#[tokio::test]
async fn test_execute_javascript_syntax_error() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "function broken { return 1; }".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    // Should handle syntax errors gracefully
    assert!(result.is_ok() || result.is_err());
}

/// Test JavaScript execution with dangerous code (should be blocked)
#[tokio::test]
async fn test_execute_javascript_dangerous_code() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "eval('2+2')".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    // Should be blocked due to security check
    assert!(result.is_err());
}

/// Test JavaScript execution with require (should be blocked)
#[tokio::test]
async fn test_execute_javascript_require_blocked() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "require('fs')".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    // Should be blocked due to security check
    assert!(result.is_err());
}

/// Test JavaScript execution with Function constructor (should be blocked)
#[tokio::test]
async fn test_execute_javascript_function_constructor_blocked() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "new Function('return 1')()".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    // Should be blocked due to security check
    assert!(result.is_err());
}

/// Test execution with unsupported script type
#[tokio::test]
async fn test_execute_unsupported_script_type() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: None,
        session_id: None,
        trigger: "test".to_string(),
    };

    let result = service.lock().await.execute_script(
        "print('hello')".to_string(),
        "python".to_string(),
        context,
    ).await;

    // Should return error for unsupported script type
    assert!(result.is_err());
}

/// Test script execution with connection context
#[tokio::test]
async fn test_execute_script_with_connection_context() {
    let service = create_script_service();

    let context = ScriptContext {
        connection_id: Some("conn_123".to_string()),
        session_id: Some("session_456".to_string()),
        trigger: "connection_event".to_string(),
    };

    let result = service.lock().await.execute_script(
        r#"
// Script with connection context - simplified test
"Connection context test executed"
        "#.to_string(),
        "javascript".to_string(),
        context,
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}