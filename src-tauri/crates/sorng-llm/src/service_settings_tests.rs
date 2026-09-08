use super::*;
use crate::provider::LlmProvider;
use std::sync::atomic::{AtomicUsize, Ordering};

fn config(id: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.into(),
        display_name: id.into(),
        base_url: Some("http://fixture.invalid/v1".into()),
        ..Default::default()
    }
}

fn request(provider: Option<&str>) -> ChatCompletionRequest {
    serde_json::from_value(serde_json::json!({
        "model": "fixture-model", "messages": [], "provider_id": provider
    }))
    .unwrap()
}

struct FakeProvider {
    config: ProviderConfig,
    calls: Arc<AtomicUsize>,
    fail: bool,
}

#[async_trait::async_trait]
impl LlmProvider for FakeProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Custom
    }
    fn display_name(&self) -> String {
        self.config.display_name.clone()
    }
    async fn chat_completion(
        &self,
        request: &ChatCompletionRequest,
    ) -> LlmResult<ChatCompletionResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(LlmError::provider_error(
                "fixture",
                "retryable fixture",
                Some(503),
            ));
        }
        Ok(ChatCompletionResponse {
            id: "fixture-response".into(),
            model: request.model.clone(),
            choices: vec![],
            usage: TokenUsage {
                prompt_tokens: 2,
                completion_tokens: 3,
                total_tokens: 5,
                ..Default::default()
            },
            created: 0,
            provider: self.config.id.clone(),
            cached: false,
            latency_ms: 0,
        })
    }
    async fn stream_chat_completion(
        &self,
        _request: &ChatCompletionRequest,
    ) -> LlmResult<tokio::sync::mpsc::Receiver<LlmResult<StreamChunk>>> {
        Err(LlmError::invalid_config("unused fixture streaming"))
    }
    async fn list_models(&self) -> LlmResult<Vec<ModelInfo>> {
        Ok(vec![])
    }
    async fn health_check(&self) -> LlmResult<bool> {
        Ok(true)
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
}

fn fake_provider(
    service: &mut LlmService,
    id: &str,
    enabled: bool,
    fail: bool,
) -> Arc<AtomicUsize> {
    let config = ProviderConfig {
        enabled,
        ..config(id)
    };
    let calls = Arc::new(AtomicUsize::new(0));
    service.add_provider(config.clone()).unwrap();
    service.registry.register(
        id,
        Arc::new(FakeProvider {
            config: config.clone(),
            calls: calls.clone(),
            fail,
        }),
        config,
    );
    calls
}

#[test]
fn default_provider_add_select_remove_and_readback_are_consistent() {
    let mut service = LlmService::new(LlmConfig::default());
    service.add_provider(config("first")).unwrap();
    assert_eq!(service.config().default_provider.as_deref(), Some("first"));
    service.add_provider(config("second")).unwrap();
    service.set_default_provider("second").unwrap();
    assert_eq!(service.config().default_provider.as_deref(), Some("second"));
    assert_eq!(service.select_provider("unmapped").unwrap(), "second");
    assert!(service.remove_provider("second"));
    assert_eq!(service.config().default_provider, None);
    assert_eq!(service.registry.default_provider_id(), None);
    assert_eq!(service.select_provider("unmapped").unwrap(), "first");
    assert!(service.set_default_provider("missing").is_err());
}

#[test]
fn metadata_and_blank_secret_edits_preserve_the_native_key_and_default() {
    let mut service = LlmService::new(LlmConfig::default());
    service
        .add_provider(ProviderConfig {
            api_key: Some("fixture-secret".into()),
            ..config("first")
        })
        .unwrap();
    service.add_provider(config("second")).unwrap();
    service.set_default_provider("first").unwrap();
    for api_key in [None, Some(String::new()), Some("  ".into())] {
        service
            .update_provider(ProviderConfig {
                api_key,
                display_name: "Renamed".into(),
                ..config("first")
            })
            .unwrap();
        assert_eq!(
            service
                .registry
                .get_config("first")
                .unwrap()
                .api_key
                .as_deref(),
            Some("fixture-secret")
        );
        assert_eq!(service.config().default_provider.as_deref(), Some("first"));
    }
    service
        .update_provider(ProviderConfig {
            api_key: Some("replacement-fixture".into()),
            ..config("first")
        })
        .unwrap();
    let saved = service.registry.get_config("first").unwrap();
    assert_eq!(saved.api_key.as_deref(), Some("replacement-fixture"));
    let serialized = serde_json::to_string(&service.list_providers()).unwrap();
    assert!(!serialized.contains("replacement-fixture"));
    assert!(!serialized.contains("api_key"));
    assert!(service.update_provider(config("missing")).is_err());
}

#[test]
fn config_updates_rebuild_live_provider_state_and_round_trip_strategy() {
    let mut service = LlmService::new(LlmConfig::default());
    service.add_provider(config("first")).unwrap();
    service.add_provider(config("second")).unwrap();
    let mut updated = service.config().clone();
    updated.default_provider = Some("second".into());
    updated.balancer.strategy = BalancerStrategy::RoundRobin;
    service.update_config(updated).unwrap();
    assert_eq!(service.registry.default_provider_id(), Some("second"));
    assert_eq!(service.balancer.health_snapshot().len(), 2);
    assert_eq!(service.select_provider("unmapped").unwrap(), "first");
    assert_eq!(service.select_provider("unmapped").unwrap(), "second");
    service.set_balancer_strategy(BalancerStrategy::Priority);
    assert_eq!(
        service.config().balancer.strategy,
        BalancerStrategy::Priority
    );
    assert_eq!(service.select_provider("unmapped").unwrap(), "second");
    let before = serde_json::to_value(service.config()).unwrap();
    let mut invalid = service.config().clone();
    invalid.default_provider = Some("missing".into());
    assert!(service.update_config(invalid).is_err());
    assert_eq!(serde_json::to_value(service.config()).unwrap(), before);
}

#[test]
fn blank_keys_never_cross_provider_endpoint_or_tenant_boundaries() {
    let mut service = LlmService::new(LlmConfig::default());
    let original = ProviderConfig {
        api_key: Some("private-fixture".into()),
        ..config("fixture")
    };
    service.add_provider(original.clone()).unwrap();
    let mut edits = vec![original.clone(); 5];
    edits[0].provider_type = ProviderType::Anthropic;
    edits[1].base_url = Some("http://different.invalid/v1".into());
    edits[2].org_id = Some("different-org".into());
    edits[3].project_id = Some("different-project".into());
    edits[4].region = Some("different-region".into());
    for mut edit in edits {
        edit.api_key = None;
        let error = service.update_provider(edit.clone()).unwrap_err();
        assert!(error.message.contains("replacement API key"));
        assert!(!error.message.contains("private-fixture"));
        let unchanged = service.registry.get_config("fixture").unwrap();
        assert_eq!(unchanged.base_url, original.base_url);
        assert_eq!(unchanged.provider_type, original.provider_type);
        assert_eq!(unchanged.api_key, original.api_key);
    }
    let replacement = ProviderConfig {
        base_url: Some("http://replacement.invalid/v1".into()),
        api_key: Some("replacement-fixture".into()),
        ..original.clone()
    };
    service.update_provider(replacement).unwrap();
    service
        .update_provider(ProviderConfig {
            provider_type: ProviderType::Ollama,
            api_key: None,
            ..original
        })
        .unwrap();
    assert_eq!(
        service.registry.get_config("fixture").unwrap().api_key,
        None
    );
}

#[test]
fn priority_default_does_not_bypass_an_open_circuit() {
    let mut service = LlmService::new(LlmConfig::default());
    service.add_provider(config("first")).unwrap();
    service.add_provider(config("second")).unwrap();
    assert_eq!(service.select_provider("unmapped").unwrap(), "first");
    for _ in 0..3 {
        service.balancer.record_failure("first");
    }
    assert_eq!(service.select_provider("unmapped").unwrap(), "second");
    service.balancer.record_success("first", 1);
    assert_eq!(service.select_provider("unmapped").unwrap(), "first");
}

#[tokio::test]
async fn balancing_honors_the_selected_strategy_and_excludes_disabled_providers() {
    let mut configuration = LlmConfig::default();
    configuration.cache.enabled = false;
    configuration.balancer.strategy = BalancerStrategy::RoundRobin;
    let mut service = LlmService::new(configuration);
    let first = fake_provider(&mut service, "first", true, false);
    let second = fake_provider(&mut service, "second", true, false);
    let disabled = fake_provider(&mut service, "disabled", false, false);
    assert_eq!(
        service
            .chat_completion(request(None))
            .await
            .unwrap()
            .provider,
        "first"
    );
    assert_eq!(
        service
            .chat_completion(request(None))
            .await
            .unwrap()
            .provider,
        "second"
    );
    assert!(service
        .chat_completion(request(Some("disabled")))
        .await
        .is_err());
    assert_eq!(first.load(Ordering::SeqCst), 1);
    assert_eq!(second.load(Ordering::SeqCst), 1);
    assert_eq!(disabled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failover_opt_out_stops_after_primary_and_opt_in_skips_disabled_fallbacks() {
    let mut configuration = LlmConfig::default();
    configuration.cache.enabled = false;
    configuration.balancer.failover_enabled = false;
    configuration.fallback_chain = vec!["disabled".into(), "fallback".into()];
    let mut service = LlmService::new(configuration);
    let primary = fake_provider(&mut service, "primary", true, true);
    let disabled = fake_provider(&mut service, "disabled", false, false);
    let fallback = fake_provider(&mut service, "fallback", true, false);
    assert!(service
        .chat_completion(request(Some("primary")))
        .await
        .is_err());
    assert_eq!(primary.load(Ordering::SeqCst), 1);
    assert_eq!(fallback.load(Ordering::SeqCst), 0);
    let mut updated = service.config().clone();
    updated.balancer.failover_enabled = true;
    service.update_config(updated).unwrap();
    assert_eq!(
        service
            .chat_completion(request(Some("primary")))
            .await
            .unwrap()
            .provider,
        "fallback"
    );
    assert_eq!(disabled.load(Ordering::SeqCst), 0);
    assert_eq!(fallback.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn usage_opt_out_does_not_record_new_requests() {
    let mut configuration = LlmConfig::default();
    configuration.cache.enabled = false;
    configuration.usage_tracking_enabled = false;
    let mut service = LlmService::new(configuration);
    let calls = fake_provider(&mut service, "fixture", true, false);
    service.chat_completion(request(None)).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(service.usage_summary(None).total_requests, 0);
    let mut updated = service.config().clone();
    updated.usage_tracking_enabled = true;
    service.update_config(updated).unwrap();
    service.chat_completion(request(None)).await.unwrap();
    assert_eq!(service.usage_summary(None).total_requests, 1);
    assert_eq!(service.usage_summary(None).total_tokens, 5);
}

#[tokio::test]
async fn cache_is_provider_scoped_and_cannot_bypass_a_disabled_provider() {
    let mut service = LlmService::new(LlmConfig::default());
    let first = fake_provider(&mut service, "first", true, false);
    let second = fake_provider(&mut service, "second", true, false);
    assert_eq!(
        service
            .chat_completion(request(Some("first")))
            .await
            .unwrap()
            .provider,
        "first"
    );
    assert_eq!(
        service
            .chat_completion(request(Some("second")))
            .await
            .unwrap()
            .provider,
        "second"
    );
    assert!(
        service
            .chat_completion(request(Some("first")))
            .await
            .unwrap()
            .cached
    );
    assert_eq!(first.load(Ordering::SeqCst), 1);
    assert_eq!(second.load(Ordering::SeqCst), 1);
    service
        .update_provider(ProviderConfig {
            enabled: false,
            ..config("first")
        })
        .unwrap();
    assert!(service
        .chat_completion(request(Some("first")))
        .await
        .is_err());
    assert_eq!(first.load(Ordering::SeqCst), 1);
}
