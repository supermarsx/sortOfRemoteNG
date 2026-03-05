// ── sorng-docker-compose tests ─────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use sorng_docker_compose::types::*;
    use sorng_docker_compose::parser::ComposeParser;
    use sorng_docker_compose::graph::DependencyResolver;
    use sorng_docker_compose::profiles::ProfileManager;
    use sorng_docker_compose::templates::TemplateManager;
    use sorng_docker_compose::error::{ComposeError, ComposeErrorKind};
    use sorng_docker_compose::service::ComposeService;
    use std::collections::HashMap;

    // ═══════════════════════════════════════════════════════════════
    //  Parser tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn parse_minimal_yaml() {
        let yaml = r#"
services:
  web:
    image: nginx:alpine
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        assert_eq!(compose.services.len(), 1);
        assert!(compose.services.contains_key("web"));
        assert_eq!(
            compose.services["web"].image.as_deref(),
            Some("nginx:alpine")
        );
    }

    #[test]
    fn parse_complex_yaml() {
        let yaml = r#"
version: "3.8"
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      FOO: bar
      BAZ: qux
    depends_on:
      - api

  api:
    build:
      context: ./api
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
    profiles:
      - development

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db-data:

networks:
  frontend:
  backend:
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        assert_eq!(compose.services.len(), 3);
        assert_eq!(compose.volumes.len(), 1);
        assert_eq!(compose.networks.len(), 2);
        assert_eq!(compose.version.as_deref(), Some("3.8"));

        // Check web service
        let web = &compose.services["web"];
        assert_eq!(web.image.as_deref(), Some("nginx:alpine"));
        assert_eq!(web.ports.len(), 2);

        // Check api build config
        let api = &compose.services["api"];
        assert!(api.build.is_some());
        assert_eq!(api.profiles, vec!["development".to_string()]);

        // Check db healthcheck
        let db = &compose.services["db"];
        assert!(db.healthcheck.is_some());
    }

    #[test]
    fn parse_invalid_yaml_returns_error() {
        let yaml = "{{{{invalid yaml";
        let result = ComposeParser::parse_yaml(yaml);
        assert!(result.is_err());
    }

    #[test]
    fn parse_json_compose() {
        let json = r#"{
            "services": {
                "web": {
                    "image": "nginx:latest"
                }
            }
        }"#;
        let compose = ComposeParser::parse_json(json).unwrap();
        assert_eq!(compose.services.len(), 1);
        assert_eq!(
            compose.services["web"].image.as_deref(),
            Some("nginx:latest")
        );
    }

    #[test]
    fn serialize_roundtrip() {
        let yaml = r#"
services:
  web:
    image: nginx:alpine
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let yaml_out = ComposeParser::to_yaml(&compose).unwrap();
        let compose2 = ComposeParser::parse_yaml(&yaml_out).unwrap();
        assert_eq!(compose.services.len(), compose2.services.len());
        assert_eq!(
            compose.services["web"].image,
            compose2.services["web"].image
        );
    }

    #[test]
    fn json_roundtrip() {
        let yaml = r#"
services:
  app:
    image: node:20
    ports:
      - "3000:3000"
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let json = ComposeParser::to_json(&compose).unwrap();
        let compose2 = ComposeParser::parse_json(&json).unwrap();
        assert_eq!(compose.services.len(), compose2.services.len());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Interpolation tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn interpolate_simple_vars() {
        let mut vars = HashMap::new();
        vars.insert("TAG".to_string(), "latest".to_string());
        vars.insert("PORT".to_string(), "8080".to_string());

        let template = "image: nginx:${TAG}\nports:\n  - \"${PORT}:80\"";
        let result = ComposeParser::interpolate(template, &vars).unwrap();
        assert!(result.contains("nginx:latest"));
        assert!(result.contains("8080:80"));
    }

    #[test]
    fn interpolate_default_values() {
        let vars = HashMap::new();
        let template = "${MISSING:-fallback}";
        let result = ComposeParser::interpolate(template, &vars).unwrap();
        assert_eq!(result, "fallback");
    }

    #[test]
    fn interpolate_default_unset_vs_empty() {
        let mut vars = HashMap::new();
        vars.insert("EMPTY".to_string(), "".to_string());

        // ${VAR:-default} → default when empty
        let result = ComposeParser::interpolate("${EMPTY:-default}", &vars).unwrap();
        assert_eq!(result, "default");

        // ${VAR-default} → empty string (set but empty)
        let result2 = ComposeParser::interpolate("${EMPTY-default}", &vars).unwrap();
        assert_eq!(result2, "");
    }

    #[test]
    fn interpolate_substitution_operator() {
        let mut vars = HashMap::new();
        vars.insert("SET".to_string(), "hello".to_string());

        // ${VAR:+replacement} → replacement when set and non-empty
        let result = ComposeParser::interpolate("${SET:+replaced}", &vars).unwrap();
        assert_eq!(result, "replaced");

        // Missing var → empty
        let result2 = ComposeParser::interpolate("${MISSING:+replaced}", &vars).unwrap();
        assert_eq!(result2, "");
    }

    #[test]
    fn interpolate_dollar_var_syntax() {
        let mut vars = HashMap::new();
        vars.insert("TAG".to_string(), "v1".to_string());

        let template = "image: nginx:$TAG";
        let result = ComposeParser::interpolate(template, &vars).unwrap();
        assert!(result.contains("nginx:v1"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Merge tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn merge_two_files() {
        let base_yaml = r#"
services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
"#;
        let override_yaml = r#"
services:
  web:
    ports:
      - "8080:80"
    environment:
      DEBUG: "true"
  redis:
    image: redis:7
"#;
        let base = ComposeParser::parse_yaml(base_yaml).unwrap();
        let overlay = ComposeParser::parse_yaml(override_yaml).unwrap();
        let merged = ComposeParser::merge(&[base, overlay]).unwrap();

        assert_eq!(merged.services.len(), 2);
        // Ports should be replaced (not appended) per compose merge semantics
        let web = &merged.services["web"];
        assert_eq!(web.ports.len(), 1);
        // Image should remain from base
        assert_eq!(web.image.as_deref(), Some("nginx:1.25"));
        // redis should appear
        assert!(merged.services.contains_key("redis"));
    }

    #[test]
    fn merge_empty_list() {
        let merged = ComposeParser::merge(&[]).unwrap();
        assert!(merged.services.is_empty());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Validation tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn validate_missing_image_and_build() {
        let yaml = r#"
services:
  broken:
    ports:
      - "80:80"
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let validation = ComposeParser::validate(&compose);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|e| e.message.contains("image") || e.message.contains("build")));
    }

    #[test]
    fn validate_invalid_depends_on_ref() {
        let yaml = r#"
services:
  web:
    image: nginx
    depends_on:
      - nonexistent
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let validation = ComposeParser::validate(&compose);
        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|e| e.message.contains("nonexistent")));
    }

    #[test]
    fn validate_valid_compose() {
        let yaml = r#"
services:
  web:
    image: nginx:alpine
    depends_on:
      - api
  api:
    image: node:20
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let validation = ComposeParser::validate(&compose);
        assert!(validation.valid);
        assert!(validation.errors.is_empty());
    }

    #[test]
    fn validate_privileged_warning() {
        let yaml = r#"
services:
  admin:
    image: ubuntu
    privileged: true
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let validation = ComposeParser::validate(&compose);
        assert!(validation.valid); // warnings don't fail
        assert!(validation
            .warnings
            .iter()
            .any(|w| w.message.contains("privileged")));
    }

    #[test]
    fn validate_links_deprecation_warning() {
        let yaml = r#"
services:
  web:
    image: nginx
    links:
      - db
  db:
    image: postgres
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let validation = ComposeParser::validate(&compose);
        assert!(validation
            .warnings
            .iter()
            .any(|w| w.message.contains("links")));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Dependency Graph tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn dependency_graph_simple_chain() {
        let yaml = r#"
services:
  frontend:
    image: nginx
    depends_on:
      - api
  api:
    image: node
    depends_on:
      - db
  db:
    image: postgres
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let graph = DependencyResolver::build_graph(&compose).unwrap();

        assert!(!graph.has_cycle);
        assert_eq!(graph.services.len(), 3);
        assert_eq!(graph.edges.len(), 2);

        // Startup order should be: db → api → frontend
        let order = &graph.startup_order;
        let db_pos = order.iter().position(|s| s == "db").unwrap();
        let api_pos = order.iter().position(|s| s == "api").unwrap();
        let fe_pos = order.iter().position(|s| s == "frontend").unwrap();
        assert!(db_pos < api_pos);
        assert!(api_pos < fe_pos);
    }

    #[test]
    fn dependency_graph_cycle_detection() {
        let yaml = r#"
services:
  a:
    image: alpine
    depends_on:
      - b
  b:
    image: alpine
    depends_on:
      - c
  c:
    image: alpine
    depends_on:
      - a
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let graph = DependencyResolver::build_graph(&compose).unwrap();
        assert!(graph.has_cycle);
    }

    #[test]
    fn dependency_graph_no_deps() {
        let yaml = r#"
services:
  a:
    image: alpine
  b:
    image: alpine
  c:
    image: alpine
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let graph = DependencyResolver::build_graph(&compose).unwrap();
        assert!(!graph.has_cycle);
        assert_eq!(graph.startup_order.len(), 3);
        assert!(graph.edges.is_empty());
    }

    #[test]
    fn startup_order_subset() {
        let yaml = r#"
services:
  web:
    image: nginx
    depends_on:
      - api
  api:
    image: node
    depends_on:
      - db
  db:
    image: postgres
  worker:
    image: python
    depends_on:
      - db
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let order = DependencyResolver::startup_order_for(
            &compose,
            &["web".to_string()],
        )
        .unwrap();

        // Should include web + api + db (transitive deps)
        assert!(order.contains(&"web".to_string()));
        assert!(order.contains(&"api".to_string()));
        assert!(order.contains(&"db".to_string()));
        // worker is not needed
        assert!(!order.contains(&"worker".to_string()));
    }

    #[test]
    fn shutdown_order_is_reversed() {
        let yaml = r#"
services:
  web:
    image: nginx
    depends_on:
      - db
  db:
    image: postgres
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let order = DependencyResolver::shutdown_order(&compose).unwrap();

        let web_pos = order.iter().position(|s| s == "web").unwrap();
        let db_pos = order.iter().position(|s| s == "db").unwrap();
        // web should shut down before db
        assert!(web_pos < db_pos);
    }

    #[test]
    fn dependents_finds_reverse_deps() {
        let yaml = r#"
services:
  web:
    image: nginx
    depends_on:
      - api
  api:
    image: node
    depends_on:
      - db
  db:
    image: postgres
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let deps = DependencyResolver::dependents(&compose, "db");
        assert!(deps.contains(&"api".to_string()));
        // web transitively depends on db through api
        assert!(deps.contains(&"web".to_string()));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Profile tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn profile_listing() {
        let yaml = r#"
services:
  web:
    image: nginx
  debug:
    image: busybox
    profiles:
      - debug
  monitoring:
    image: prometheus
    profiles:
      - monitoring
      - debug
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let profiles = ProfileManager::list_profiles(&compose);

        assert_eq!(profiles.len(), 2);
        let debug = profiles.iter().find(|p| p.name == "debug").unwrap();
        assert!(debug.services.contains(&"debug".to_string()));
        assert!(debug.services.contains(&"monitoring".to_string()));
    }

    #[test]
    fn active_services_no_profiles() {
        let yaml = r#"
services:
  web:
    image: nginx
  debug:
    image: busybox
    profiles:
      - debug
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let active = ProfileManager::active_services(&compose, &[]);
        // Only web (no profile) should be active
        assert_eq!(active, vec!["web".to_string()]);
    }

    #[test]
    fn active_services_with_profile() {
        let yaml = r#"
services:
  web:
    image: nginx
  debug:
    image: busybox
    profiles:
      - debug
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let active = ProfileManager::active_services(&compose, &["debug".to_string()]);
        assert!(active.contains(&"web".to_string()));
        assert!(active.contains(&"debug".to_string()));
    }

    #[test]
    fn profile_only_services() {
        let yaml = r#"
services:
  web:
    image: nginx
  test:
    image: busybox
    profiles:
      - testing
  debug:
    image: busybox
    profiles:
      - debug
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let profile_only = ProfileManager::profile_only_services(&compose);
        assert!(profile_only.contains(&"test".to_string()));
        assert!(profile_only.contains(&"debug".to_string()));
        assert!(!profile_only.contains(&"web".to_string()));
    }

    #[test]
    fn validate_profile_deps() {
        let yaml = r#"
services:
  web:
    image: nginx
    depends_on:
      - debug-api
  debug-api:
    image: node
    profiles:
      - debug
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        let warnings = ProfileManager::validate_profile_deps(&compose, &[]);
        // web depends on debug-api which is not active
        assert!(!warnings.is_empty());
        assert!(warnings[0].contains("debug-api"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Template tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn list_templates_non_empty() {
        let templates = TemplateManager::list_templates();
        assert!(!templates.is_empty());
        assert!(templates.len() >= 10);
    }

    #[test]
    fn get_template_by_name() {
        let tpl = TemplateManager::get_template("postgres").unwrap();
        assert_eq!(tpl.name, "postgres");
        assert!(!tpl.content.is_empty());
        assert!(tpl.content.contains("postgres"));
    }

    #[test]
    fn get_template_not_found() {
        let result = TemplateManager::get_template("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn template_categories() {
        let cats = TemplateManager::categories();
        assert!(!cats.is_empty());
        assert!(cats.contains(&"database".to_string()));
    }

    #[test]
    fn templates_by_category() {
        let dbs = TemplateManager::by_category("database");
        assert!(!dbs.is_empty());
        for tpl in &dbs {
            assert_eq!(tpl.category, "database");
        }
    }

    #[test]
    fn template_content_is_valid_yaml() {
        for tpl in TemplateManager::list_templates() {
            let result = ComposeParser::parse_yaml(&tpl.content);
            assert!(
                result.is_ok(),
                "Template '{}' has invalid YAML: {:?}",
                tpl.name,
                result.err()
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Env file parsing tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn parse_env_file() {
        let dir = tempfile::tempdir().unwrap();
        let env_path = dir.path().join(".env");
        std::fs::write(
            &env_path,
            r#"
# Comment
FOO=bar
BAZ="quoted value"
EMPTY=
BARE_VAR
NUMBER=42
"#,
        )
        .unwrap();

        let env_file = ComposeParser::parse_env_file(&env_path).unwrap();
        assert_eq!(env_file.variables.len(), 5);

        let foo = env_file.variables.iter().find(|v| v.key == "FOO").unwrap();
        assert_eq!(foo.value.as_deref(), Some("bar"));

        let baz = env_file.variables.iter().find(|v| v.key == "BAZ").unwrap();
        assert_eq!(baz.value.as_deref(), Some("quoted value"));

        let empty = env_file.variables.iter().find(|v| v.key == "EMPTY").unwrap();
        assert_eq!(empty.value.as_deref(), Some(""));

        let bare = env_file.variables.iter().find(|v| v.key == "BARE_VAR").unwrap();
        assert_eq!(bare.value, None);
    }

    // ═══════════════════════════════════════════════════════════════
    //  File discovery tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn discover_compose_files() {
        let dir = tempfile::tempdir().unwrap();
        // Create standard compose files
        std::fs::write(dir.path().join("docker-compose.yml"), "services: {}").unwrap();
        std::fs::write(
            dir.path().join("docker-compose.override.yml"),
            "services: {}",
        )
        .unwrap();

        let found = ComposeParser::discover_files(dir.path());
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn discover_no_files() {
        let dir = tempfile::tempdir().unwrap();
        let found = ComposeParser::discover_files(dir.path());
        assert!(found.is_empty());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Error type tests
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn error_display() {
        let err = ComposeError::command("up failed");
        assert_eq!(err.to_string(), "up failed");

        let err2 = ComposeError::with_details(
            ComposeErrorKind::CommandFailed,
            "down failed",
            "exit code 1",
        );
        assert!(err2.to_string().contains("down failed"));
        assert!(err2.to_string().contains("exit code 1"));
    }

    #[test]
    fn error_with_exit_code() {
        let err = ComposeError::command("failed").with_exit_code(127);
        assert_eq!(err.exit_code, Some(127));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Service facade tests (unit-level, no CLI needed)
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn service_not_initialized() {
        let svc = ComposeService::new();
        assert!(!svc.is_available());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Complex compose file test
    // ═══════════════════════════════════════════════════════════════

    #[test]
    fn parse_full_featured_compose() {
        let yaml = r#"
name: myproject
services:
  proxy:
    image: traefik:v3.0
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - frontend
    restart: unless-stopped
    labels:
      com.example.description: "Reverse proxy"
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/mydb
      REDIS_URL: redis://cache:6379
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    networks:
      - frontend
      - backend
    secrets:
      - db_password
    configs:
      - app_config
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    profiles:
      - production

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID

  cache:
    image: redis:7-alpine
    networks:
      - backend
    volumes:
      - cache-data:/data

  worker:
    build:
      context: .
      target: worker
    depends_on:
      - db
      - cache
    profiles:
      - workers

volumes:
  db-data:
    driver: local
  cache-data:

networks:
  frontend:
  backend:
    internal: true

secrets:
  db_password:
    file: ./secrets/db_password.txt

configs:
  app_config:
    file: ./config/app.yml
"#;
        let compose = ComposeParser::parse_yaml(yaml).unwrap();
        assert_eq!(compose.name.as_deref(), Some("myproject"));
        assert_eq!(compose.services.len(), 5);
        assert_eq!(compose.volumes.len(), 2);
        assert_eq!(compose.networks.len(), 2);
        assert_eq!(compose.secrets.len(), 1);
        assert_eq!(compose.configs.len(), 1);

        // Validate
        let validation = ComposeParser::validate(&compose);
        assert!(validation.valid, "Errors: {:?}", validation.errors);

        // Graph
        let graph = DependencyResolver::build_graph(&compose).unwrap();
        assert!(!graph.has_cycle);
        assert!(graph.edges.len() >= 3);

        // Profiles
        let profiles = ProfileManager::profile_names(&compose);
        assert!(profiles.contains(&"production".to_string()));
        assert!(profiles.contains(&"workers".to_string()));

        // Active services without profiles
        let active = ProfileManager::active_services(&compose, &[]);
        assert!(active.contains(&"proxy".to_string()));
        assert!(active.contains(&"db".to_string()));
        assert!(active.contains(&"cache".to_string()));
        assert!(!active.contains(&"app".to_string())); // production profile
        assert!(!active.contains(&"worker".to_string())); // workers profile

        // Active with production profile
        let active_prod =
            ProfileManager::active_services(&compose, &["production".to_string()]);
        assert!(active_prod.contains(&"app".to_string()));

        // Deploy config
        let proxy = &compose.services["proxy"];
        assert!(proxy.deploy.is_some());
        let deploy = proxy.deploy.as_ref().unwrap();
        assert_eq!(deploy.replicas, Some(1));

        // Capabilities
        let db = &compose.services["db"];
        assert!(!db.cap_drop.is_empty());
        assert!(!db.cap_add.is_empty());
    }
}
