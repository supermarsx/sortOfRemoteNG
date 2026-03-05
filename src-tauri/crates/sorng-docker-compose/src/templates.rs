// ── sorng-docker-compose/src/templates.rs ──────────────────────────────────────
//! Built-in compose templates for quick scaffolding.

use crate::error::{ComposeError, ComposeResult};
use crate::types::ComposeTemplate;

/// Provides built-in and custom compose templates.
pub struct TemplateManager;

impl TemplateManager {
    /// Get all built-in templates.
    pub fn list_templates() -> Vec<ComposeTemplate> {
        vec![
            Self::nginx_template(),
            Self::postgres_template(),
            Self::redis_template(),
            Self::mysql_template(),
            Self::mongodb_template(),
            Self::wordpress_template(),
            Self::nextcloud_template(),
            Self::gitea_template(),
            Self::traefik_template(),
            Self::prometheus_grafana_template(),
            Self::elk_template(),
            Self::minio_template(),
            Self::rabbitmq_template(),
            Self::mariadb_template(),
            Self::node_app_template(),
            Self::python_app_template(),
            Self::full_stack_template(),
        ]
    }

    /// Get a template by name.
    pub fn get_template(name: &str) -> ComposeResult<ComposeTemplate> {
        Self::list_templates()
            .into_iter()
            .find(|t| t.name == name)
            .ok_or_else(|| ComposeError::template(&format!("Template '{}' not found", name)))
    }

    /// Get templates by category.
    pub fn by_category(category: &str) -> Vec<ComposeTemplate> {
        Self::list_templates()
            .into_iter()
            .filter(|t| t.category == category)
            .collect()
    }

    /// Get all categories.
    pub fn categories() -> Vec<String> {
        let mut cats: Vec<String> = Self::list_templates()
            .iter()
            .map(|t| t.category.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        cats.sort();
        cats
    }

    // ── Built-in templates ────────────────────────────────────────

    fn nginx_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "nginx".to_string(),
            description: "Nginx web server with custom configuration".to_string(),
            category: "web-server".to_string(),
            tags: vec!["nginx".into(), "web".into(), "reverse-proxy".into()],
            content: r#"services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./html:/usr/share/nginx/html:ro
      - nginx-logs:/var/log/nginx
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  nginx-logs:
"#
            .to_string(),
        }
    }

    fn postgres_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "postgres".to_string(),
            description: "PostgreSQL database with persistent storage".to_string(),
            category: "database".to_string(),
            tags: vec!["postgres".into(), "database".into(), "sql".into()],
            content: r#"services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-mydb}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
"#
            .to_string(),
        }
    }

    fn redis_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "redis".to_string(),
            description: "Redis in-memory data store".to_string(),
            category: "database".to_string(),
            tags: vec!["redis".into(), "cache".into(), "nosql".into()],
            content: r#"services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-changeme}
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis-data:
"#
            .to_string(),
        }
    }

    fn mysql_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "mysql".to_string(),
            description: "MySQL database with persistent storage".to_string(),
            category: "database".to_string(),
            tags: vec!["mysql".into(), "database".into(), "sql".into()],
            content: r#"services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?Set MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-mydb}
      MYSQL_USER: ${MYSQL_USER:-app}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?Set MYSQL_PASSWORD}
    ports:
      - "${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql-data:/var/lib/mysql
      - ./init-scripts:/docker-entrypoint-initdb.d:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mysql-data:
"#
            .to_string(),
        }
    }

    fn mongodb_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "mongodb".to_string(),
            description: "MongoDB document database".to_string(),
            category: "database".to_string(),
            tags: vec!["mongodb".into(), "database".into(), "nosql".into()],
            content: r#"services:
  mongodb:
    image: mongo:7
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER:-admin}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD:?Set MONGO_PASSWORD}
      MONGO_INITDB_DATABASE: ${MONGO_DB:-mydb}
    ports:
      - "${MONGO_PORT:-27017}:27017"
    volumes:
      - mongo-data:/data/db
      - mongo-config:/data/configdb
    restart: unless-stopped
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh --quiet
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mongo-data:
  mongo-config:
"#
            .to_string(),
        }
    }

    fn wordpress_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "wordpress".to_string(),
            description: "WordPress with MySQL backend".to_string(),
            category: "application".to_string(),
            tags: vec!["wordpress".into(), "cms".into(), "php".into(), "mysql".into()],
            content: r#"services:
  wordpress:
    image: wordpress:latest
    ports:
      - "${WP_PORT:-8080}:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: ${DB_USER:-wordpress}
      WORDPRESS_DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
      WORDPRESS_DB_NAME: ${DB_NAME:-wordpress}
    volumes:
      - wp-content:/var/www/html
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:?Set DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME:-wordpress}
      MYSQL_USER: ${DB_USER:-wordpress}
      MYSQL_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - db-data:/var/lib/mysql
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  wp-content:
  db-data:
"#
            .to_string(),
        }
    }

    fn nextcloud_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "nextcloud".to_string(),
            description: "Nextcloud with PostgreSQL and Redis".to_string(),
            category: "application".to_string(),
            tags: vec!["nextcloud".into(), "cloud".into(), "storage".into()],
            content: r#"services:
  nextcloud:
    image: nextcloud:latest
    ports:
      - "${NC_PORT:-8080}:80"
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_HOST_PASSWORD: ${REDIS_PASSWORD:-changeme}
    volumes:
      - nextcloud-data:/var/www/html
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nextcloud"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD:-changeme}
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  nextcloud-data:
  db-data:
  redis-data:
"#
            .to_string(),
        }
    }

    fn gitea_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "gitea".to_string(),
            description: "Gitea self-hosted Git service with PostgreSQL".to_string(),
            category: "devtools".to_string(),
            tags: vec!["gitea".into(), "git".into(), "devops".into()],
            content: r#"services:
  gitea:
    image: gitea/gitea:latest
    ports:
      - "${GITEA_HTTP_PORT:-3000}:3000"
      - "${GITEA_SSH_PORT:-2222}:22"
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - gitea-data:/data
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: gitea
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitea"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  gitea-data:
  db-data:
"#
            .to_string(),
        }
    }

    fn traefik_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "traefik".to_string(),
            description: "Traefik reverse proxy with dashboard".to_string(),
            category: "infrastructure".to_string(),
            tags: vec!["traefik".into(), "reverse-proxy".into(), "load-balancer".into()],
            content: r#"services:
  traefik:
    image: traefik:v3.0
    command:
      - "--api.dashboard=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/certs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "traefik", "healthcheck"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  traefik-certs:
"#
            .to_string(),
        }
    }

    fn prometheus_grafana_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "prometheus-grafana".to_string(),
            description: "Prometheus + Grafana monitoring stack".to_string(),
            category: "monitoring".to_string(),
            tags: vec!["prometheus".into(), "grafana".into(), "monitoring".into(), "metrics".into()],
            content: r#"services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "${PROMETHEUS_PORT:-9090}:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=30d"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "${GRAFANA_PORT:-3000}:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
    volumes:
      - grafana-data:/var/lib/grafana
    depends_on:
      - prometheus
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    command:
      - "--path.procfs=/host/proc"
      - "--path.sysfs=/host/sys"
    restart: unless-stopped
    profiles:
      - exporters

volumes:
  prometheus-data:
  grafana-data:
"#
            .to_string(),
        }
    }

    fn elk_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "elk".to_string(),
            description: "Elasticsearch + Logstash + Kibana stack".to_string(),
            category: "monitoring".to_string(),
            tags: vec!["elasticsearch".into(), "logstash".into(), "kibana".into(), "logging".into()],
            content: r#"services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    environment:
      discovery.type: single-node
      ES_JAVA_OPTS: "-Xms512m -Xmx512m"
      xpack.security.enabled: "false"
    ports:
      - "${ES_PORT:-9200}:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  kibana:
    image: docker.elastic.co/kibana/kibana:8.12.0
    ports:
      - "${KIBANA_PORT:-5601}:5601"
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    depends_on:
      elasticsearch:
        condition: service_healthy
    restart: unless-stopped

  logstash:
    image: docker.elastic.co/logstash/logstash:8.12.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf:ro
    depends_on:
      elasticsearch:
        condition: service_healthy
    restart: unless-stopped
    profiles:
      - logstash

volumes:
  es-data:
"#
            .to_string(),
        }
    }

    fn minio_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "minio".to_string(),
            description: "MinIO S3-compatible object storage".to_string(),
            category: "storage".to_string(),
            tags: vec!["minio".into(), "s3".into(), "storage".into(), "object-storage".into()],
            content: r#"services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_API_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:?Set MINIO_PASSWORD}
    volumes:
      - minio-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  minio-data:
"#
            .to_string(),
        }
    }

    fn rabbitmq_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "rabbitmq".to_string(),
            description: "RabbitMQ message broker with management UI".to_string(),
            category: "messaging".to_string(),
            tags: vec!["rabbitmq".into(), "messaging".into(), "amqp".into(), "queue".into()],
            content: r#"services:
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "${RABBITMQ_PORT:-5672}:5672"
      - "${RABBITMQ_MGMT_PORT:-15672}:15672"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-admin}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:?Set RABBITMQ_PASSWORD}
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    restart: unless-stopped
    healthcheck:
      test: rabbitmq-diagnostics -q ping
      interval: 30s
      timeout: 10s
      retries: 5

volumes:
  rabbitmq-data:
"#
            .to_string(),
        }
    }

    fn mariadb_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "mariadb".to_string(),
            description: "MariaDB database with persistent storage".to_string(),
            category: "database".to_string(),
            tags: vec!["mariadb".into(), "database".into(), "sql".into(), "mysql".into()],
            content: r#"services:
  mariadb:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD:?Set MARIADB_ROOT_PASSWORD}
      MARIADB_DATABASE: ${MARIADB_DATABASE:-mydb}
      MARIADB_USER: ${MARIADB_USER:-app}
      MARIADB_PASSWORD: ${MARIADB_PASSWORD:?Set MARIADB_PASSWORD}
    ports:
      - "${MARIADB_PORT:-3306}:3306"
    volumes:
      - mariadb-data:/var/lib/mysql
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mariadb-data:
"#
            .to_string(),
        }
    }

    fn node_app_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "node-app".to_string(),
            description: "Node.js application with hot reload".to_string(),
            category: "application".to_string(),
            tags: vec!["node".into(), "javascript".into(), "typescript".into()],
            content: r#"services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${APP_PORT:-3000}:3000"
    environment:
      NODE_ENV: ${NODE_ENV:-development}
    volumes:
      - .:/app
      - /app/node_modules
    command: npm run dev
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-app}
      POSTGRES_USER: ${DB_USER:-app}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-app}"]
      interval: 10s
      timeout: 5s
      retries: 5
    profiles:
      - with-db

volumes:
  db-data:
"#
            .to_string(),
        }
    }

    fn python_app_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "python-app".to_string(),
            description: "Python application with hot reload".to_string(),
            category: "application".to_string(),
            tags: vec!["python".into(), "django".into(), "flask".into()],
            content: r#"services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${APP_PORT:-8000}:8000"
    environment:
      PYTHONUNBUFFERED: 1
      DATABASE_URL: postgres://${DB_USER:-app}:${DB_PASSWORD:-secret}@db:5432/${DB_NAME:-app}
    volumes:
      - .:/app
    command: python manage.py runserver 0.0.0.0:8000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-app}
      POSTGRES_USER: ${DB_USER:-app}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-app}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    restart: unless-stopped
    profiles:
      - with-cache

volumes:
  db-data:
"#
            .to_string(),
        }
    }

    fn full_stack_template() -> ComposeTemplate {
        ComposeTemplate {
            name: "full-stack".to_string(),
            description: "Full-stack app: frontend + API + database + cache + reverse proxy".to_string(),
            category: "application".to_string(),
            tags: vec!["fullstack".into(), "nginx".into(), "api".into(), "postgres".into(), "redis".into()],
            content: r#"services:
  proxy:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - api
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    expose:
      - "3000"
    environment:
      API_URL: http://api:8000
    restart: unless-stopped

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    expose:
      - "8000"
    environment:
      DATABASE_URL: postgres://${DB_USER:-app}:${DB_PASSWORD:-secret}@db:5432/${DB_NAME:-app}
      REDIS_URL: redis://cache:6379
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-app}
      POSTGRES_USER: ${DB_USER:-app}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
    volumes:
      - db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-app}"]
      interval: 10s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    volumes:
      - cache-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db-data:
  cache-data:
"#
            .to_string(),
        }
    }
}
