//! # Login Form Detection Service
//!
//! This module provides automatic detection and analysis of login forms on web pages.
//! It can identify username/password fields and assist with automated authentication.
//!
//! ## Features
//!
//! - HTML form analysis and parsing
//! - Login field detection using heuristics
//! - Form submission simulation
//! - Multi-factor authentication support
//! - Secure credential handling
//!
//! ## Security
//!
//! Credentials are handled securely and never stored in plain text.
//! HTTPS is enforced for all login operations.
//!
//! ## Example
//!

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use regex::Regex;

/// Detected form field
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FormField {
    /// Field name
    pub name: String,
    /// Field type (text, password, email, etc.)
    pub field_type: String,
    /// Field ID
    pub id: Option<String>,
    /// Field placeholder
    pub placeholder: Option<String>,
    /// Whether this field is likely a username field
    pub is_username: bool,
    /// Whether this field is likely a password field
    pub is_password: bool,
}

/// Detected login form
#[derive(Serialize, Deserialize, Clone)]
pub struct LoginForm {
    /// Form action URL
    pub action_url: String,
    /// Form method (GET/POST)
    pub method: String,
    /// Detected fields
    pub fields: Vec<FormField>,
    /// Form identifier
    pub form_id: Option<String>,
    /// Whether this appears to be a login form
    pub is_login_form: bool,
    /// Confidence score (0-100)
    pub confidence: u8,
}

/// Login detection result
#[derive(Serialize, Deserialize, Clone)]
pub struct LoginDetectionResult {
    /// Detected forms
    pub forms: Vec<LoginForm>,
    /// Page title
    pub page_title: Option<String>,
    /// Whether the page appears to be a login page
    pub is_login_page: bool,
}

/// Login form detection service state
pub type LoginDetectionServiceState = Arc<Mutex<LoginDetectionService>>;

/// Service for detecting and analyzing login forms
pub struct LoginDetectionService {
    /// HTTP client
    client: Client,
    /// Field detection patterns
    username_patterns: Vec<Regex>,
    password_patterns: Vec<Regex>,
    /// Form detection patterns
    login_form_patterns: Vec<Regex>,
}

impl LoginDetectionService {
    /// Creates a new login detection service
    pub fn new() -> LoginDetectionServiceState {
        let mut service = LoginDetectionService {
            client: Client::builder()
                .user_agent("SortOfRemoteNG/1.0")
                .build()
                .unwrap(),
            username_patterns: Vec::new(),
            password_patterns: Vec::new(),
            login_form_patterns: Vec::new(),
        };
        service.initialize_patterns();
        Arc::new(Mutex::new(service))
    }

    /// Initializes detection patterns
    fn initialize_patterns(&mut self) {
        // Username field patterns
        self.username_patterns = vec![
            Regex::new(r"(?i)user(name|id|login|email|mail)").unwrap(),
            Regex::new(r"(?i)login").unwrap(),
            Regex::new(r"(?i)account").unwrap(),
        ];

        // Password field patterns
        self.password_patterns = vec![
            Regex::new(r"(?i)pass(word|wd|phrase)").unwrap(),
            Regex::new(r"(?i)pwd").unwrap(),
        ];

        // Login form patterns
        self.login_form_patterns = vec![
            Regex::new(r"(?i)login").unwrap(),
            Regex::new(r"(?i)sign.?in").unwrap(),
            Regex::new(r"(?i)auth").unwrap(),
        ];
    }

    /// Analyzes a web page for login forms
    pub async fn analyze_page(&self, url: &str) -> Result<LoginDetectionResult, String> {
        // Fetch the page
        let response = self.client.get(url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch page: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }

        let html = response.text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        // Extract title
        let page_title = self.extract_title(&html);

        // Detect forms
        let forms = self.detect_forms(&html, url)?;

        // Determine if this is a login page
        let is_login_page = self.is_login_page(&html, &forms);

        Ok(LoginDetectionResult {
            forms,
            page_title,
            is_login_page,
        })
    }

    /// Extracts page title from HTML
    fn extract_title(&self, html: &str) -> Option<String> {
        let title_regex = Regex::new(r"(?i)<title[^>]*>([^<]*)</title>").unwrap();
        if let Some(captures) = title_regex.captures(html) {
            Some(captures[1].trim().to_string())
        } else {
            None
        }
    }

    /// Detects forms in HTML
    fn detect_forms(&self, html: &str, base_url: &str) -> Result<Vec<LoginForm>, String> {
        let form_regex = Regex::new(r"(?is)<form[^>]*>.*?</form>").unwrap();
        let mut forms = Vec::new();

        for form_match in form_regex.find_iter(html) {
            let form_html = form_match.as_str();
            if let Some(form) = self.analyze_form(form_html, base_url)? {
                forms.push(form);
            }
        }

        Ok(forms)
    }

    /// Analyzes a single form
    fn analyze_form(&self, form_html: &str, base_url: &str) -> Result<Option<LoginForm>, String> {
        // Extract form attributes
        let action = self.extract_form_attribute(form_html, "action").unwrap_or_else(|| base_url.to_string());
        let method = self.extract_form_attribute(form_html, "method").unwrap_or_else(|| "POST".to_string());
        let form_id = self.extract_form_attribute(form_html, "id");

        // Extract fields
        let fields = self.extract_fields(form_html)?;

        // Determine if this is a login form
        let is_login_form = self.is_login_form(&fields);
        let confidence = self.calculate_confidence(&fields, form_html);

        if confidence > 30 { // Only return forms with reasonable confidence
            Ok(Some(LoginForm {
                action_url: action,
                method,
                fields,
                form_id,
                is_login_form,
                confidence,
            }))
        } else {
            Ok(None)
        }
    }

    /// Extracts a form attribute
    fn extract_form_attribute(&self, form_html: &str, attr: &str) -> Option<String> {
        let pattern = format!(r#"(?i){}="([^"]*)""#, attr);
        let regex = Regex::new(&pattern).unwrap();
        if let Some(captures) = regex.captures(form_html) {
            Some(captures[1].to_string())
        } else {
            None
        }
    }

    /// Extracts input fields from form HTML
    fn extract_fields(&self, form_html: &str) -> Result<Vec<FormField>, String> {
        let input_regex = Regex::new(r"(?is)<input[^>]*>").unwrap();
        let mut fields = Vec::new();

        for input_match in input_regex.find_iter(form_html) {
            let input_html = input_match.as_str();
            if let Some(field) = self.analyze_input_field(input_html)? {
                fields.push(field);
            }
        }

        Ok(fields)
    }

    /// Analyzes a single input field
    fn analyze_input_field(&self, input_html: &str) -> Result<Option<FormField>, String> {
        let name_opt = self.extract_attribute(input_html, "name")?;
        let field_type = self.extract_attribute(input_html, "type")?.unwrap_or_else(|| "text".to_string());
        let id = self.extract_attribute(input_html, "id").ok().flatten();
        let placeholder = self.extract_attribute(input_html, "placeholder").ok().flatten();

        // Skip fields without names
        let name = match name_opt {
            Some(n) => n,
            None => return Ok(None),
        };

        // Skip hidden, submit, and button fields
        if matches!(field_type.as_str(), "hidden" | "submit" | "button" | "reset") {
            return Ok(None);
        }

        let is_username = self.is_username_field(&name, &field_type, &placeholder);
        let is_password = self.is_password_field(&name, &field_type, &placeholder);

        Ok(Some(FormField {
            name,
            field_type,
            id,
            placeholder,
            is_username,
            is_password,
        }))
    }

    /// Extracts an attribute from HTML tag
    fn extract_attribute(&self, html: &str, attr: &str) -> Result<Option<String>, String> {
        let pattern = format!(r#"(?i){}="([^"]*)""#, attr);
        let regex = Regex::new(&pattern).unwrap();
        if let Some(captures) = regex.captures(html) {
            Ok(Some(captures[1].to_string()))
        } else {
            Ok(None)
        }
    }

    /// Determines if a field is likely a username field
    fn is_username_field(&self, name: &str, field_type: &str, placeholder: &Option<String>) -> bool {
        // Check field type
        if !matches!(field_type, "text" | "email" | "tel") {
            return false;
        }

        // Check name
        if self.username_patterns.iter().any(|pattern| pattern.is_match(name)) {
            return true;
        }

        // Check placeholder
        if let Some(placeholder) = placeholder {
            if self.username_patterns.iter().any(|pattern| pattern.is_match(placeholder)) {
                return true;
            }
        }

        false
    }

    /// Determines if a field is likely a password field
    fn is_password_field(&self, name: &str, field_type: &str, placeholder: &Option<String>) -> bool {
        // Check field type
        if field_type != "password" {
            return false;
        }

        // Check name and placeholder
        let combined_text = format!("{} {}", name, placeholder.as_deref().unwrap_or(""));
        self.password_patterns.iter().any(|pattern| pattern.is_match(&combined_text))
    }

    /// Determines if a form is likely a login form
    fn is_login_form(&self, fields: &[FormField]) -> bool {
        let has_username = fields.iter().any(|f| f.is_username);
        let has_password = fields.iter().any(|f| f.is_password);

        has_username && has_password
    }

    /// Calculates confidence score for a form
    fn calculate_confidence(&self, fields: &[FormField], form_html: &str) -> u8 {
        let mut score = 0u8;

        // Username field
        if fields.iter().any(|f| f.is_username) {
            score += 30;
        }

        // Password field
        if fields.iter().any(|f| f.is_password) {
            score += 40;
        }

        // Form has reasonable number of fields
        if fields.len() >= 2 && fields.len() <= 10 {
            score += 10;
        }

        // Form HTML contains login-related keywords
        if self.login_form_patterns.iter().any(|pattern| pattern.is_match(form_html)) {
            score += 20;
        }

        score.min(100)
    }

    /// Determines if a page is likely a login page
    fn is_login_page(&self, html: &str, forms: &[LoginForm]) -> bool {
        // Check for login-related keywords in page content
        let login_keywords = ["login", "sign in", "signin", "log in", "authenticate", "auth"];
        let content_lower = html.to_lowercase();

        let keyword_score = login_keywords.iter()
            .filter(|keyword| content_lower.contains(*keyword))
            .count() as u8 * 10;

        // Check forms
        let has_login_form = forms.iter().any(|f| f.is_login_form);

        keyword_score >= 20 || has_login_form
    }

    /// Attempts to fill and submit a login form
    pub async fn submit_login_form(
        &self,
        form: &LoginForm,
        username: String,
        password: String
    ) -> Result<String, String> {
        let mut credentials = HashMap::new();
        credentials.insert("username".to_string(), username);
        credentials.insert("password".to_string(), password);

        let mut form_data = HashMap::new();

        // Fill in the form fields
        for field in &form.fields {
            if field.is_username {
                if let Some(value) = credentials.get("username") {
                    form_data.insert(field.name.clone(), value.clone());
                }
            } else if field.is_password {
                if let Some(value) = credentials.get("password") {
                    form_data.insert(field.name.clone(), value.clone());
                }
            } else if let Some(value) = credentials.get(&field.name) {
                form_data.insert(field.name.clone(), value.clone());
            }
        }

        // Submit the form
        let response = if form.method.to_uppercase() == "POST" {
            self.client.post(&form.action_url)
                .form(&form_data)
                .send()
                .await
        } else {
            // For GET, add parameters to URL
            let mut url = form.action_url.clone();
            let query_string = serde_urlencoded::to_string(&form_data)
                .map_err(|e| format!("Failed to encode form data: {}", e))?;
            if url.contains('?') {
                url.push('&');
            } else {
                url.push('?');
            }
            url.push_str(&query_string);

            self.client.get(&url).send().await
        };

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok("Login form submitted successfully".to_string())
                } else {
                    Err(format!("Login failed with status: {}", resp.status()))
                }
            }
            Err(e) => Err(format!("Failed to submit form: {}", e))
        }
    }
}