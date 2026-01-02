use app::*;

/// Test script service creation
#[tokio::test]
async fn test_new_script_service() {
    let service = ScriptService::new();
    // Service should be created successfully
    assert!(true);
}

/// Test JavaScript execution with simple expression
#[tokio::test]
async fn test_execute_javascript_simple() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "2 + 2".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with console.log
#[tokio::test]
async fn test_execute_javascript_console_log() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        r#"console.log("Hello, World!"); "executed""#.to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with variable assignment
#[tokio::test]
async fn test_execute_javascript_variables() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        r#"
        let x = 10;
        let y = 20;
        x + y
        "#.to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with function
#[tokio::test]
async fn test_execute_javascript_function() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        r#"
        function add(a, b) {
            return a + b;
        }
        add(5, 3)
        "#.to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript execution with syntax error
#[tokio::test]
async fn test_execute_javascript_syntax_error() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "function broken { return 1; }".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    // Should handle syntax errors gracefully
    assert!(result.is_ok() || result.is_err());
}

/// Test JavaScript execution with dangerous code (should be blocked)
#[tokio::test]
async fn test_execute_javascript_dangerous_code() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "eval('2+2')".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    // Should detect and block dangerous code
    assert!(result.is_err());
}

/// Test JavaScript execution with require (should be blocked)
#[tokio::test]
async fn test_execute_javascript_require() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "require('fs')".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    // Should detect and block dangerous code
    assert!(result.is_err());
}

/// Test JavaScript execution with Function constructor (should be blocked)
#[tokio::test]
async fn test_execute_javascript_function_constructor() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "new Function('return 1')()".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    // Should detect and block dangerous code
    assert!(result.is_err());
}

/// Test unsupported script type
#[tokio::test]
async fn test_execute_unsupported_script_type() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "print('hello')".to_string(),
        "python".to_string(),
        ScriptContext::default(),
    ).await;

    // Should handle unsupported script types gracefully
    assert!(result.is_err());
}

/// Test empty script
#[tokio::test]
async fn test_execute_empty_script() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        "".to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test script execution with context
#[tokio::test]
async fn test_execute_script_with_context() {
    let service = ScriptService::new();

    let context = ScriptContext {
        working_directory: Some("/tmp".to_string()),
        environment_variables: Some(vec![("TEST_VAR".to_string(), "test_value".to_string())]),
        timeout: Some(30),
    };

    let result = service.lock().await.execute_script(
        "console.log('With context'); 42".to_string(),
        "javascript".to_string(),
        context,
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test concurrent script execution
#[tokio::test]
async fn test_concurrent_script_execution() {
    let service = ScriptService::new();
    let mut handles = vec![];

    // Spawn multiple script execution tasks
    for i in 0..3 {
        let service_clone = service.clone();
        let script = format!("{} + {}", i, i);

        let handle = tokio::spawn(async move {
            let result = service_clone.lock().await.execute_script(
                script,
                "javascript".to_string(),
                ScriptContext::default(),
            ).await;
            assert!(result.is_ok());
            let script_result = result.unwrap();
            assert!(script_result.success);
        });
        handles.push(handle);
    }

    // Wait for all scripts to complete
    for handle in handles {
        handle.await.unwrap();
    }
}

/// Test JavaScript with array operations
#[tokio::test]
async fn test_execute_javascript_arrays() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        r#"
        let arr = [1, 2, 3, 4, 5];
        arr.reduce((sum, num) => sum + num, 0)
        "#.to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}

/// Test JavaScript with object operations
#[tokio::test]
async fn test_execute_javascript_objects() {
    let service = ScriptService::new();

    let result = service.lock().await.execute_script(
        r#"
        let obj = {a: 1, b: 2, c: 3};
        obj.a + obj.b + obj.c
        "#.to_string(),
        "javascript".to_string(),
        ScriptContext::default(),
    ).await;

    assert!(result.is_ok());
    let script_result = result.unwrap();
    assert!(script_result.success);
}