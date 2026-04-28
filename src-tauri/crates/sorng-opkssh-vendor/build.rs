use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_CHECKOUT_PATH: &str = "C:/Users/Mariana/AppData/Local/Temp/opkssh-copilot";
const DEFAULT_GO_BINARY_PATH: &str = "C:/Users/Mariana/scoop/apps/go/current/bin/go.exe";
const DEFAULT_GO_SHIM_PATH: &str = "C:/Users/Mariana/scoop/shims/go.exe";
const CHECKOUT_ENV: &str = "SORNG_OPKSSH_VENDOR_CHECKOUT";
const DISABLE_ENV: &str = "SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE";
const GO_BINARY_ENV: &str = "SORNG_OPKSSH_VENDOR_GO";
const EMBEDDED_RUNTIME_ENV: &str = "SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME";
const CHECKOUT_USED_ENV: &str = "SORNG_OPKSSH_VENDOR_CHECKOUT_USED";
const PINNED_UPSTREAM_REV: &str = "193d79871f3bad3cd27cfb94734c265773a99c9b";
const OVERLAY_WORKDIR: &str = "opkssh-overlay-source";

const OVERLAY_FILES: &[(&str, &str)] = &[
    ("libopkssh_cabi.go", OPKSSH_CABI_GO),
    ("commands/embedded_login.go", OPKSSH_COMMANDS_EMBEDDED_LOGIN_GO),
    ("commands/login.go", OPKSSH_COMMANDS_LOGIN_GO),
    ("libopkssh/config.go", OPKSSH_LIB_CONFIG_GO),
    ("libopkssh/host.go", OPKSSH_LIB_HOST_GO),
    ("libopkssh/login.go", OPKSSH_LIB_LOGIN_GO),
    ("libopkssh/poc_login.go", OPKSSH_LIB_POC_LOGIN_GO),
    ("libopkssh/types.go", OPKSSH_LIB_TYPES_GO),
];

fn main() {
    println!("cargo:rustc-check-cfg=cfg(sorng_opkssh_vendor_bridge)");
    println!("cargo:rerun-if-env-changed={CHECKOUT_ENV}");
    println!("cargo:rerun-if-env-changed={DISABLE_ENV}");
    println!("cargo:rerun-if-env-changed={GO_BINARY_ENV}");
    println!("cargo:rerun-if-env-changed=PATH");
    println!("cargo:rerun-if-env-changed=Path");

    if bridge_disabled() {
        emit_stub_runtime("OPKSSH vendor bridge disabled by environment");
        return;
    }

    let host = env::var("HOST").ok();
    let target = env::var("TARGET").ok();
    if host != target {
        emit_stub_runtime("OPKSSH vendor bridge skipped for cross-compilation");
        return;
    }

    if target.as_deref().is_some_and(|triple| triple.contains("msvc")) {
        emit_stub_runtime("OPKSSH vendor bridge is not wired for MSVC targets yet");
        return;
    }

    let Some(checkout_path) = discover_checkout_path() else {
        emit_stub_runtime("OPKSSH checkout not found; leaving vendor wrapper metadata-only");
        return;
    };

    println!("cargo:rerun-if-changed={}", checkout_path.join("go.mod").display());
    println!("cargo:rerun-if-changed={}", checkout_path.join("commands").display());
    println!("cargo:rerun-if-changed={}", checkout_path.join("libopkssh").display());

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    let build_checkout = match prepare_checkout_for_build(&checkout_path, &out_dir) {
        Ok(path) => path,
        Err(error) => {
            emit_stub_runtime(&error);
            return;
        }
    };

    let checkout_entrypoint = checkout_path.join("libopkssh_cabi.go");
    if checkout_entrypoint.is_file() {
        println!("cargo:rerun-if-changed={}", checkout_entrypoint.display());
    }

    let go_entrypoint = build_checkout.join("libopkssh_cabi.go");
    if !go_entrypoint.is_file() {
        emit_stub_runtime("OPKSSH checkout is missing libopkssh_cabi.go after overlay preparation");
        return;
    }

    let archive_path = out_dir.join("libopkssh_cabi.a");
    let go_binary = discover_go_binary().unwrap_or_else(|| PathBuf::from("go"));

    let output = match Command::new(&go_binary)
        .arg("build")
        .arg("-buildmode=c-archive")
        .arg("-o")
        .arg(&archive_path)
        .arg(&go_entrypoint)
        .current_dir(&build_checkout)
        .env("CGO_ENABLED", "1")
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            emit_stub_runtime(&format!("failed to invoke Go toolchain for OPKSSH bridge: {error}"));
            return;
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        emit_stub_runtime(&format!(
            "failed to build embedded OPKSSH bridge: {}",
            stderr.trim()
        ));
        return;
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=opkssh_cabi");
    emit_platform_link_libs();
    println!("cargo:rustc-cfg=sorng_opkssh_vendor_bridge");
    println!("cargo:rustc-env={EMBEDDED_RUNTIME_ENV}=1");
    println!(
        "cargo:rustc-env={CHECKOUT_USED_ENV}={}",
        checkout_path.display()
    );
}

fn bridge_disabled() -> bool {
    env::var(DISABLE_ENV)
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn discover_checkout_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os(CHECKOUT_ENV) {
        if path.is_empty() {
            return None;
        }

        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }

        println!(
            "cargo:warning=OPKSSH checkout from {CHECKOUT_ENV} does not exist: {}",
            path.display()
        );
        return None;
    }

    let default_path = Path::new(DEFAULT_CHECKOUT_PATH);
    default_path.exists().then(|| default_path.to_path_buf())
}

fn discover_go_binary() -> Option<PathBuf> {
    if let Some(path) = env::var_os(GO_BINARY_ENV) {
        if path.is_empty() {
            return None;
        }

        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }

        println!(
            "cargo:warning=OPKSSH Go binary from {GO_BINARY_ENV} does not exist: {}",
            path.display()
        );
    }

    for candidate in [DEFAULT_GO_BINARY_PATH, DEFAULT_GO_SHIM_PATH] {
        let path = Path::new(candidate);
        if path.is_file() {
            return Some(path.to_path_buf());
        }
    }

    None
}

fn prepare_checkout_for_build(checkout_path: &Path, out_dir: &Path) -> Result<PathBuf, String> {
    if !checkout_requires_overlay(checkout_path) {
        return Ok(checkout_path.to_path_buf());
    }

    let work_dir = out_dir.join(OVERLAY_WORKDIR);
    if work_dir.exists() {
        fs::remove_dir_all(&work_dir).map_err(|error| {
            format!(
                "failed to clear OPKSSH overlay workdir {}: {error}",
                work_dir.display()
            )
        })?;
    }

    copy_dir_recursive(checkout_path, &work_dir)?;

    for (relative_path, contents) in OVERLAY_FILES {
        write_overlay_file(&work_dir.join(relative_path), contents)?;
    }

    println!(
        "cargo:warning=Applying repo-owned OPKSSH bridge overlay for openpubkey/opkssh@{PINNED_UPSTREAM_REV}"
    );

    Ok(work_dir)
}

fn checkout_requires_overlay(checkout_path: &Path) -> bool {
    !checkout_path.join("libopkssh_cabi.go").is_file()
        || !checkout_path.join("commands").join("embedded_login.go").is_file()
        || !checkout_path.join("libopkssh").join("login.go").is_file()
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create OPKSSH overlay directory {}: {error}",
            destination.display()
        )
    })?;

    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "failed to read OPKSSH checkout directory {}: {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read entry from OPKSSH checkout {}: {error}",
                source.display()
            )
        })?;

        let file_name = entry.file_name();
        if file_name.to_string_lossy() == ".git" {
            continue;
        }

        let source_path = entry.path();
        let destination_path = destination.join(&file_name);
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to inspect OPKSSH checkout entry {}: {error}",
                source_path.display()
            )
        })?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
            continue;
        }

        if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy OPKSSH checkout file {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn write_overlay_file(destination: &Path, contents: &str) -> Result<(), String> {
    let parent = destination.parent().ok_or_else(|| {
        format!(
            "failed to determine parent directory for OPKSSH overlay file {}",
            destination.display()
        )
    })?;

    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create parent directory for OPKSSH overlay file {}: {error}",
            destination.display()
        )
    })?;

    fs::write(destination, contents).map_err(|error| {
        format!(
            "failed to write OPKSSH overlay file {}: {error}",
            destination.display()
        )
    })
}

fn emit_platform_link_libs() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        for library in [
            "advapi32",
            "bcrypt",
            "crypt32",
            "iphlpapi",
            "netapi32",
            "secur32",
            "userenv",
            "ws2_32",
        ] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
}

fn emit_stub_runtime(reason: &str) {
    println!("cargo:warning={reason}");
    println!("cargo:rustc-env={EMBEDDED_RUNTIME_ENV}=0");
    println!("cargo:rustc-env={CHECKOUT_USED_ENV}=");
}

const OPKSSH_CABI_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package main

/*
#include <stdlib.h>
*/
import "C"

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "log/slog"
    "net"
    "net/http"
    "net/http/cookiejar"
    "net/http/httptest"
    "net/url"
    "os"
    "strings"
    "sync"
    "time"
    "unsafe"

    "github.com/jeremija/gosubmit"
    "github.com/openpubkey/openpubkey/providers"
    "github.com/openpubkey/opkssh/commands"
    "github.com/openpubkey/opkssh/libopkssh"
    "github.com/spf13/afero"
    "github.com/zitadel/oidc/v3/example/server/exampleop"
    "github.com/zitadel/oidc/v3/example/server/storage"
)

const libopksshCabiVersion = 2

const (
    deterministicFakeOidcEnv         = "SORNG_OPKSSH_TEST_FAKE_OIDC_LOGIN"
    deterministicFakeOidcUsernameEnv = "SORNG_OPKSSH_TEST_FAKE_OIDC_USERNAME"
    deterministicFakeOidcPasswordEnv = "SORNG_OPKSSH_TEST_FAKE_OIDC_PASSWORD"
    deterministicFakeOidcDefaultUser = "test-user@localhost"
    deterministicFakeOidcDefaultPass = "verysecure"
)

type clientConfigEnvelope struct {
    OK     bool               `json:"ok"`
    Error  string             `json:"error,omitempty"`
    Config *clientConfigModel `json:"config,omitempty"`
}

type clientConfigModel struct {
    ConfigPath      string                `json:"configPath"`
    DefaultProvider string                `json:"defaultProvider,omitempty"`
    Providers       []providerConfigModel `json:"providers,omitempty"`
}

type providerConfigModel struct {
    Aliases           []string `json:"aliases,omitempty"`
    Issuer            string   `json:"issuer"`
    ClientID          string   `json:"clientId"`
    ClientSecret      string   `json:"clientSecret,omitempty"`
    Scopes            []string `json:"scopes,omitempty"`
    AccessType        string   `json:"accessType,omitempty"`
    Prompt            string   `json:"prompt,omitempty"`
    RedirectURIs      []string `json:"redirectUris,omitempty"`
    RemoteRedirectURI string   `json:"remoteRedirectUri,omitempty"`
    SendAccessToken   bool     `json:"sendAccessToken,omitempty"`
}

type loginEnvelope struct {
    OK     bool              `json:"ok"`
    Error  string            `json:"error,omitempty"`
    Result *loginResultModel `json:"result,omitempty"`
}

type loginRequestModel struct {
    ConfigPath        string `json:"configPath,omitempty"`
    CreateConfig      bool   `json:"createConfig,omitempty"`
    KeyPath           string `json:"keyPath,omitempty"`
    Provider          string `json:"provider,omitempty"`
    Issuer            string `json:"issuer,omitempty"`
    ClientID          string `json:"clientId,omitempty"`
    ClientSecret      string `json:"clientSecret,omitempty"`
    Scopes            string `json:"scopes,omitempty"`
    KeyType           string `json:"keyType,omitempty"`
    RemoteRedirectURI string `json:"remoteRedirectUri,omitempty"`
}

type loginResultModel struct {
    Success   bool   `json:"success"`
    Provider  string `json:"provider,omitempty"`
    Identity  string `json:"identity,omitempty"`
    KeyPath   string `json:"keyPath,omitempty"`
    ExpiresAt string `json:"expiresAt,omitempty"`
    Message   string `json:"message"`
}

type deterministicFakeOidcServer struct {
    *storage.Storage
    *httptest.Server
}

func configEnvelopeJSON(configPath string) *C.char {
    config, err := libopkssh.LoadClientConfig(configPath, afero.NewOsFs())
    if err != nil {
        return marshalEnvelope(clientConfigEnvelope{OK: false, Error: err.Error()})
    }

    resolvedPath, err := libopkssh.ResolveClientConfigPath(configPath)
    if err != nil {
        return marshalEnvelope(clientConfigEnvelope{OK: false, Error: err.Error()})
    }

    providers := make([]providerConfigModel, 0, len(config.Providers))
    for _, provider := range config.Providers {
        providers = append(providers, providerConfigModel{
            Aliases:           append([]string(nil), provider.AliasList...),
            Issuer:            provider.Issuer,
            ClientID:          provider.ClientID,
            ClientSecret:      provider.ClientSecret,
            Scopes:            append([]string(nil), provider.Scopes...),
            AccessType:        provider.AccessType,
            Prompt:            provider.Prompt,
            RedirectURIs:      append([]string(nil), provider.RedirectURIs...),
            RemoteRedirectURI: provider.RemoteRedirectURI,
            SendAccessToken:   provider.SendAccessToken,
        })
    }

    return marshalEnvelope(clientConfigEnvelope{
        OK: true,
        Config: &clientConfigModel{
            ConfigPath:      resolvedPath,
            DefaultProvider: config.DefaultProvider,
            Providers:       providers,
        },
    })
}

func marshalEnvelope(envelope clientConfigEnvelope) *C.char {
    payload, err := json.Marshal(envelope)
    if err != nil {
        payload = []byte(`{"ok":false,"error":"failed to marshal client-config response"}`)
    }
    return C.CString(string(payload))
}

func marshalLoginEnvelope(envelope loginEnvelope) *C.char {
    payload, err := json.Marshal(envelope)
    if err != nil {
        payload = []byte(`{"ok":false,"error":"failed to marshal login response"}`)
    }
    return C.CString(string(payload))
}

func loginEnvelopeJSON(requestJSON string) *C.char {
    var request loginRequestModel
    if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
        return marshalLoginEnvelope(loginEnvelope{
            OK:    false,
            Error: fmt.Sprintf("failed to parse embedded login request: %v", err),
        })
    }

    if result, handled, err := maybeRunDeterministicFakeOidcLogin(context.Background(), request); handled {
        if err != nil {
            return marshalLoginEnvelope(loginEnvelope{
                OK: true,
                Result: &loginResultModel{
                    Success:  false,
                    Provider: requestedProviderName(request),
                    KeyPath:  request.KeyPath,
                    Message:  err.Error(),
                },
            })
        }

        return marshalLoginEnvelope(loginEnvelope{
            OK:     true,
            Result: result,
        })
    }

    result, err := runEmbeddedLoginRequest(context.Background(), request)
    if err != nil {
        return marshalLoginEnvelope(loginEnvelope{
            OK: true,
            Result: &loginResultModel{
                Success:  false,
                Provider: requestedProviderName(request),
                KeyPath:  request.KeyPath,
                Message:  err.Error(),
            },
        })
    }

    return marshalLoginEnvelope(loginEnvelope{
        OK:     true,
        Result: result,
    })
}

func runEmbeddedLoginRequest(ctx context.Context, request loginRequestModel) (*loginResultModel, error) {
    if request.KeyPath == "" {
        return nil, fmt.Errorf("key path is required")
    }

    keyType, err := parseKeyType(request.KeyType)
    if err != nil {
        return nil, err
    }

    embedded, err := commands.LoginEmbeddedWithConfig(ctx, commands.EmbeddedLoginRequest{
        ProviderArg:       providerArgumentFromRequest(request),
        ProviderAlias:     providerAliasFromRequest(request),
        KeyPath:           request.KeyPath,
        ConfigPath:        request.ConfigPath,
        CreateConfig:      request.CreateConfig,
        KeyType:           keyType,
        RemoteRedirectURI: request.RemoteRedirectURI,
        Fs:                afero.NewOsFs(),
    })
    if err != nil {
        return nil, err
    }

    expiresAt := ""
    if !embedded.ExpiresAt.IsZero() {
        expiresAt = embedded.ExpiresAt.Format(time.RFC3339)
    }

    return &loginResultModel{
        Success:   embedded.Success,
        Provider:  embedded.Provider,
        Identity:  embedded.Identity,
        KeyPath:   embedded.KeyPath,
        ExpiresAt: expiresAt,
        Message:   embedded.Message,
    }, nil
}

func maybeRunDeterministicFakeOidcLogin(ctx context.Context, request loginRequestModel) (*loginResultModel, bool, error) {
    if !envFlagEnabled(os.Getenv(deterministicFakeOidcEnv)) {
        return nil, false, nil
    }

    result, err := runDeterministicFakeOidcLogin(ctx, request)
    return result, true, err
}

func runDeterministicFakeOidcLogin(ctx context.Context, request loginRequestModel) (*loginResultModel, error) {
    if request.KeyPath == "" {
        return nil, fmt.Errorf("key path is required")
    }

    keyType, err := parseKeyType(request.KeyType)
    if err != nil {
        return nil, err
    }

    server, err := newDeterministicFakeOidcServer()
    if err != nil {
        return nil, err
    }
    defer server.Close()

    provider, err := server.provider()
    if err != nil {
        return nil, err
    }

    username := envOrDefault(deterministicFakeOidcUsernameEnv, deterministicFakeOidcDefaultUser)
    password := envOrDefault(deterministicFakeOidcPasswordEnv, deterministicFakeOidcDefaultPass)

    loginCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
    defer cancel()

    var browserErrMu sync.Mutex
    var browserErr error

    host := &libopkssh.Host{
        OpenBrowser: func(loginURL string) error {
            if err := completeDeterministicFakeOidcLogin(loginURL, username, password); err != nil {
                browserErrMu.Lock()
                browserErr = err
                browserErrMu.Unlock()
                cancel()
                return err
            }
            return nil
        },
        Logger: libopkssh.NewWriterLogger(io.Discard),
    }

    embedded, err := commands.LoginEmbedded(loginCtx, commands.EmbeddedLoginRequest{
        Provider:          provider,
        KeyPath:           request.KeyPath,
        ConfigPath:        request.ConfigPath,
        CreateConfig:      request.CreateConfig,
        KeyType:           keyType,
        RemoteRedirectURI: request.RemoteRedirectURI,
        Fs:                afero.NewOsFs(),
        Host:              host,
        Stdout:            &bytes.Buffer{},
    })
    if err != nil {
        if deterministicBrowserErr := currentDeterministicBrowserErr(&browserErrMu, &browserErr); deterministicBrowserErr != nil {
            return nil, fmt.Errorf("deterministic fake OIDC login failed: %w", deterministicBrowserErr)
        }
        return nil, err
    }

    if deterministicBrowserErr := currentDeterministicBrowserErr(&browserErrMu, &browserErr); deterministicBrowserErr != nil {
        return nil, fmt.Errorf("deterministic fake OIDC login failed: %w", deterministicBrowserErr)
    }

    expiresAt := ""
    if !embedded.ExpiresAt.IsZero() {
        expiresAt = embedded.ExpiresAt.Format(time.RFC3339)
    }

    return &loginResultModel{
        Success:   embedded.Success,
        Provider:  embedded.Provider,
        Identity:  embedded.Identity,
        KeyPath:   embedded.KeyPath,
        ExpiresAt: expiresAt,
        Message:   embedded.Message,
    }, nil
}

func currentDeterministicBrowserErr(mu *sync.Mutex, current *error) error {
    mu.Lock()
    defer mu.Unlock()
    return *current
}

func envFlagEnabled(raw string) bool {
    switch strings.ToLower(strings.TrimSpace(raw)) {
    case "1", "true", "yes", "on":
        return true
    default:
        return false
    }
}

func envOrDefault(key string, fallback string) string {
    if value := strings.TrimSpace(os.Getenv(key)); value != "" {
        return value
    }
    return fallback
}

func newDeterministicFakeOidcServer() (*deterministicFakeOidcServer, error) {
    exampleStorage := storage.NewStorage(storage.NewUserStore("http://localhost"))

    var deferred struct{ http.Handler }
    server := httptest.NewServer(&deferred)
    logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
    deferred.Handler = exampleop.SetupServer(server.URL, exampleStorage, logger, false)

    return &deterministicFakeOidcServer{
        Storage: exampleStorage,
        Server:  server,
    }, nil
}

func (s *deterministicFakeOidcServer) provider() (providers.OpenIdProvider, error) {
    redirectPort, err := deterministicAvailablePort()
    if err != nil {
        return nil, err
    }

    redirectURI := fmt.Sprintf("http://localhost:%d/login-callback", redirectPort)
    nativeClient := storage.NativeClient("native", redirectURI)
    clientSecret := "secret"
    webClient := storage.WebClient("web", clientSecret, redirectURI)
    storage.RegisterClients(nativeClient, webClient)

    return providers.NewGoogleOpWithOptions(&providers.GoogleOptions{
        Issuer:       s.URL,
        ClientID:     webClient.GetID(),
        ClientSecret: clientSecret,
        RedirectURIs: []string{redirectURI},
        Scopes:       []string{"openid", "profile", "email", "offline_access"},
        OpenBrowser:  false,
    }), nil
}

func deterministicAvailablePort() (int, error) {
    listener, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        return 0, fmt.Errorf("failed to find available port: %w", err)
    }
    defer listener.Close()

    return listener.Addr().(*net.TCPAddr).Port, nil
}

func completeDeterministicFakeOidcLogin(loginURL string, username string, password string) error {
    jar, err := cookiejar.New(nil)
    if err != nil {
        return fmt.Errorf("create cookie jar: %w", err)
    }

    httpClient := &http.Client{
        Timeout: 5 * time.Second,
        CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
            return http.ErrUseLastResponse
        },
        Jar: jar,
    }

    startURL, err := url.Parse(loginURL)
    if err != nil {
        return fmt.Errorf("parse login URL: %w", err)
    }

    loginPageURL, err := deterministicGetRedirect(httpClient, startURL)
    if err != nil {
        return err
    }
    loginPageURL, err = deterministicGetRedirect(httpClient, loginPageURL)
    if err != nil {
        return err
    }

    form, err := deterministicGetForm(httpClient, loginPageURL)
    if err != nil {
        return err
    }

    postLoginRedirectURL, err := deterministicFillForm(httpClient, form, loginPageURL, username, password)
    if err != nil {
        return err
    }

    callbackURL, err := deterministicGetRedirect(httpClient, postLoginRedirectURL)
    if err != nil {
        return err
    }

    response, err := httpClient.Get(callbackURL.String())
    if err != nil {
        return fmt.Errorf("complete callback GET %s: %w", callbackURL.String(), err)
    }
    defer response.Body.Close()

    if response.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(response.Body)
        return fmt.Errorf("unexpected callback status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
    }

    return nil
}

func deterministicGetRedirect(httpClient *http.Client, target *url.URL) (*url.URL, error) {
    request := &http.Request{
        Method: http.MethodGet,
        URL:    target,
        Header: make(http.Header),
    }

    response, err := httpClient.Do(request)
    if err != nil {
        return nil, fmt.Errorf("GET %s: %w", target.String(), err)
    }
    defer response.Body.Close()

    redirect, err := response.Location()
    if err != nil {
        body, _ := io.ReadAll(response.Body)
        return nil, fmt.Errorf("resolve redirect for %s: %w (body: %s)", target.String(), err, strings.TrimSpace(string(body)))
    }

    return redirect, nil
}

func deterministicGetForm(httpClient *http.Client, target *url.URL) ([]byte, error) {
    request := &http.Request{
        Method: http.MethodGet,
        URL:    target,
        Header: make(http.Header),
    }

    response, err := httpClient.Do(request)
    if err != nil {
        return nil, fmt.Errorf("GET login form %s: %w", target.String(), err)
    }
    defer response.Body.Close()

    body, err := io.ReadAll(response.Body)
    if err != nil {
        return nil, fmt.Errorf("read login form %s: %w", target.String(), err)
    }

    return body, nil
}

func deterministicFillForm(httpClient *http.Client, body []byte, target *url.URL, username string, password string) (*url.URL, error) {
    request, err := gosubmit.ParseWithURL(io.NopCloser(bytes.NewReader(body)), target.String()).FirstForm().NewTestRequest(
        gosubmit.AutoFill(),
        gosubmit.Set("username", username),
        gosubmit.Set("password", password),
    )
    if err != nil {
        return nil, fmt.Errorf("build login form request for %s: %w", target.String(), err)
    }
    if request.URL.Scheme == "" {
        request.URL = target
    }
    request.RequestURI = ""

    response, err := httpClient.Do(request)
    if err != nil {
        return nil, fmt.Errorf("POST login form %s: %w", target.String(), err)
    }
    defer response.Body.Close()

    redirect, err := response.Location()
    if err != nil {
        responseBody, _ := io.ReadAll(response.Body)
        return nil, fmt.Errorf("resolve POST redirect for %s: %w (body: %s)", target.String(), err, strings.TrimSpace(string(responseBody)))
    }

    return redirect, nil
}

func requestedProviderName(request loginRequestModel) string {
    if alias := strings.TrimSpace(request.Provider); alias != "" {
        return alias
    }
    return strings.TrimSpace(request.Issuer)
}

func providerAliasFromRequest(request loginRequestModel) string {
    if strings.TrimSpace(request.Issuer) != "" {
        return ""
    }
    return strings.TrimSpace(request.Provider)
}

func providerArgumentFromRequest(request loginRequestModel) string {
    issuer := strings.TrimSpace(request.Issuer)
    if issuer == "" {
        return ""
    }

    clientID := strings.TrimSpace(request.ClientID)
    if clientID == "" {
        return issuer
    }

    parts := []string{issuer, clientID}
    if request.ClientSecret != "" || request.Scopes != "" {
        parts = append(parts, request.ClientSecret)
    }
    if request.Scopes != "" {
        parts = append(parts, request.Scopes)
    }

    return strings.Join(parts, ",")
}

func parseKeyType(raw string) (commands.KeyType, error) {
    switch strings.ToLower(strings.TrimSpace(raw)) {
    case "", "ecdsa":
        return commands.ECDSA, nil
    case "ed25519":
        return commands.ED25519, nil
    default:
        return 0, fmt.Errorf("unsupported embedded login key type %q", raw)
    }
}

//export libopkssh_abi_version
func libopkssh_abi_version() C.uint {
    return C.uint(libopksshCabiVersion)
}

//export libopkssh_load_client_config_json
func libopkssh_load_client_config_json(configPath *C.char) *C.char {
    path := ""
    if configPath != nil {
        path = C.GoString(configPath)
    }
    return configEnvelopeJSON(path)
}

//export libopkssh_login_json
func libopkssh_login_json(requestJSON *C.char) *C.char {
    if requestJSON == nil {
        return marshalLoginEnvelope(loginEnvelope{
            OK:    false,
            Error: "embedded login request must not be null",
        })
    }

    return loginEnvelopeJSON(C.GoString(requestJSON))
}

//export libopkssh_free_string
func libopkssh_free_string(value *C.char) {
    if value == nil {
        return
    }
    C.free(unsafe.Pointer(value))
}

func main() {}
"####;

const OPKSSH_COMMANDS_EMBEDDED_LOGIN_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package commands

import (
    "context"
    "fmt"
    "io"
    "path/filepath"
    "time"

    "github.com/openpubkey/openpubkey/providers"
    config "github.com/openpubkey/opkssh/commands/config"
    "github.com/openpubkey/opkssh/libopkssh"
    "github.com/spf13/afero"
)

// EmbeddedLoginRequest is the narrow host-driven input used by the Phase 0 spike.
// The caller owns provider construction, key path selection, and config path ownership.
type EmbeddedLoginRequest struct {
    Provider          providers.OpenIdProvider
    ProviderArg       string
    ProviderAlias     string
    KeyPath           string
    ConfigPath        string
    CreateConfig      bool
    KeyType           KeyType
    RemoteRedirectURI string
    Fs                afero.Fs
    Host              *libopkssh.Host
    Stdout            io.Writer
}

// EmbeddedLoginResult is the structured result returned by the in-process login spike.
type EmbeddedLoginResult struct {
    Success    bool
    Provider   string
    Identity   string
    KeyPath    string
    ConfigPath string
    ExpiresAt  time.Time
    Message    string
}

// LoginEmbedded performs login without Cobra command execution or subprocess spawning.
// It intentionally requires explicit config and key paths so host-owned paths stay visible.
func LoginEmbedded(ctx context.Context, req EmbeddedLoginRequest) (*EmbeddedLoginResult, error) {
    if req.Provider == nil {
        return nil, fmt.Errorf("provider is required")
    }

    loginCmd, err := prepareEmbeddedLoginCommand(req)
    if err != nil {
        return nil, err
    }

    return executeEmbeddedLogin(ctx, loginCmd, req.Provider)
}

// LoginEmbeddedWithConfig performs embedded login while reusing the same
// config/provider resolution flow as the CLI login command.
func LoginEmbeddedWithConfig(ctx context.Context, req EmbeddedLoginRequest) (*EmbeddedLoginResult, error) {
    loginCmd, err := prepareEmbeddedLoginCommand(req)
    if err != nil {
        return nil, err
    }

    provider, err := resolveEmbeddedLoginProvider(ctx, loginCmd, req)
    if err != nil {
        return nil, err
    }

    return executeEmbeddedLogin(ctx, loginCmd, provider)
}

func prepareEmbeddedLoginCommand(req EmbeddedLoginRequest) (*LoginCmd, error) {
    if req.KeyPath == "" {
        return nil, fmt.Errorf("key path is required")
    }

    fs := req.Fs
    if fs == nil {
        fs = afero.NewOsFs()
    }

    loginCmd := &LoginCmd{
        Fs:                fs,
        ConfigPathArg:     req.ConfigPath,
        CreateConfigArg:   req.CreateConfig,
        KeyPathArg:        req.KeyPath,
        ProviderArg:       req.ProviderArg,
        ProviderAliasArg:  req.ProviderAlias,
        KeyTypeArg:        req.KeyType,
        RemoteRedirectURI: req.RemoteRedirectURI,
        OutWriter:         req.Stdout,
        Host:              req.Host,
    }

    if err := ensureEmbeddedClientConfig(loginCmd); err != nil {
        return nil, err
    }

    if isGitHubEnvironment() {
        loginCmd.Config.Providers = append(loginCmd.Config.Providers, config.GitHubProviderConfig())
    }

    return loginCmd, nil
}

func ensureEmbeddedClientConfig(loginCmd *LoginCmd) error {
    if loginCmd.Config != nil {
        return nil
    }

    if loginCmd.ConfigPathArg == "" {
        homeDir, err := loginCmd.homeDir()
        if err != nil {
            return fmt.Errorf("failed to get user config dir: %w", err)
        }
        loginCmd.ConfigPathArg = filepath.Join(homeDir, ".opk", "config.yml")
    }

    if _, err := loginCmd.Fs.Stat(loginCmd.ConfigPathArg); err == nil {
        clientConfig, err := config.GetClientConfigFromFile(loginCmd.ConfigPathArg, loginCmd.Fs)
        if err != nil {
            return err
        }
        loginCmd.Config = clientConfig
        return nil
    }

    if loginCmd.CreateConfigArg {
        if err := loginCmd.createDefaultClientConfig(loginCmd.ConfigPathArg); err != nil {
            return err
        }

        clientConfig, err := config.GetClientConfigFromFile(loginCmd.ConfigPathArg, loginCmd.Fs)
        if err != nil {
            return err
        }
        loginCmd.Config = clientConfig
        return nil
    }

    loginCmd.logf("failed to find client config file to generate a default config, run `opkssh login --create-config` to create a default config file")
    clientConfig, err := config.NewClientConfig(config.DefaultClientConfig)
    if err != nil {
        return fmt.Errorf("failed to parse default config file: %w", err)
    }
    loginCmd.Config = clientConfig
    return nil
}

func resolveEmbeddedLoginProvider(
    ctx context.Context,
    loginCmd *LoginCmd,
    req EmbeddedLoginRequest,
) (providers.OpenIdProvider, error) {
    if req.Provider != nil {
        return req.Provider, nil
    }

    op, chooser, err := loginCmd.determineProvider()
    if err != nil {
        return nil, err
    }

    var provider providers.OpenIdProvider
    if chooser != nil {
        provider, err = chooser.ChooseOp(ctx)
        if err != nil {
            return nil, fmt.Errorf("error choosing provider: %w", err)
        }
    } else if op != nil {
        provider = op
    } else {
        return nil, fmt.Errorf("no provider found")
    }

    if !loginCmd.SendAccessTokenArg {
        if opConfig, ok := loginCmd.Config.GetByIssuer(provider.Issuer()); !ok {
            loginCmd.logf("Warning: could not find issuer %s in client config providers", provider.Issuer())
        } else {
            loginCmd.SendAccessTokenArg = opConfig.SendAccessToken
        }
    }

    return provider, nil
}

func executeEmbeddedLogin(
    ctx context.Context,
    loginCmd *LoginCmd,
    provider providers.OpenIdProvider,
) (*EmbeddedLoginResult, error) {
    loginResult, err := loginCmd.login(ctx, provider, false, loginCmd.KeyPathArg)
    if err != nil {
        return nil, err
    }

    identity := ""
    if loginResult.loginCore != nil {
        identity = loginResult.loginCore.Identity
    }
    if identity == "" {
        identity, err = IdentityString(*loginResult.pkt)
        if err != nil {
            return nil, fmt.Errorf("failed to derive identity: %w", err)
        }
    }

    var expiresAt time.Time
    if loginResult.loginCore != nil {
        expiresAt = loginResult.loginCore.ExpiresAt
    }

    return &EmbeddedLoginResult{
        Success:    true,
        Provider:   provider.Issuer(),
        Identity:   identity,
        KeyPath:    loginCmd.KeyPathArg,
        ConfigPath: loginCmd.ConfigPathArg,
        ExpiresAt:  expiresAt,
        Message:    "Login successful",
    }, nil
}
"####;

const OPKSSH_COMMANDS_LOGIN_GO: &str = r####"// Copyright 2025 OpenPubkey
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package commands

import (
    "bytes"
    "context"
    "crypto"
    "errors"
    "fmt"
    "io"
    "log"
    "os"
    "path/filepath"
    "regexp"
    "slices"
    "strings"
    "time"

    "github.com/openpubkey/openpubkey/client"
    "github.com/openpubkey/openpubkey/client/choosers"
    "github.com/openpubkey/openpubkey/jose"
    "github.com/openpubkey/openpubkey/pktoken"
    "github.com/openpubkey/openpubkey/providers"
    "github.com/openpubkey/opkssh/commands/config"
    "github.com/openpubkey/opkssh/libopkssh"
    "github.com/spf13/afero"
    "github.com/thediveo/enumflag/v2"
    "golang.org/x/crypto/ssh"
)

// KeyType is the algorithm to use for the user's key pair. This is used both by OpenPubkey as algorithm for upk (user public key) and by SSH for public key in the SSH certificate generated by opkssh.
type KeyType enumflag.Flag

const (
    ECDSA KeyType = iota
    ED25519
)

func (k KeyType) String() string {
    switch k {
    case ECDSA:
        return "ecdsa"
    case ED25519:
        return "ed25519"
    default:
        return "unknown"
    }
}

func (k KeyType) toLibopksshKeyType() (libopkssh.KeyType, error) {
    switch k {
    case ECDSA:
        return libopkssh.ECDSA, nil
    case ED25519:
        return libopkssh.ED25519, nil
    default:
        return 0, fmt.Errorf("unsupported key type (%s); use -t <%s|%s>", k.String(), ECDSA.String(), ED25519.String())
    }
}

// DefaultSSHKeyFileNames are the file names ssh key pairs that opkssh may
// write to in ~/.ssh/ during login. These are used by both login and logout
// so that if a new key type is added, logout will automatically pick it up.
var DefaultSSHKeyFileNames = map[KeyType][]string{
    ECDSA:   {"id_ecdsa", "id_ecdsa_sk"},
    ED25519: {"id_ed25519", "id_ed25519_sk"},
}

// LoginCmd represents the login command that performs OIDC authentication and generates SSH certificates.
type LoginCmd struct {
    // Inputs
    Fs                    afero.Fs
    AutoRefreshArg        bool   // Automatically refresh PK token after login
    ConfigPathArg         string // Path to the client config file.
    CreateConfigArg       bool   // Creates a client config file if it does not exist
    ConfigureArg          bool   // Apply changes to ssh config and create ~/.ssh/opkssh directory
    LogDirArg             string // Directory to write output logs
    SendAccessTokenArg    bool   // Send the Access Token as well as the PK Token in the SSH cert. The Access Token is used to call the userinfo endpoint to get claims not included in the ID Token
    DisableBrowserOpenArg bool   // Disable opening the browser. Useful for choosing the browser you want to use
    PrintIdTokenArg       bool   // Print out the contents of the id_token. Useful for inspecting claims and troubleshooting
    KeyPathArg            string // Path where SSH private key is written
    ProviderArg           string // OpenID Provider specification in the format: <issuer>,<client_id> or <issuer>,<client_id>,<client_secret> or <issuer>,<client_id>,<client_secret>,<scopes>
    ProviderAliasArg      string
    KeyTypeArg            KeyType
    PrintKeyArg           bool // Print the raw private key and SSH cert to stdout instead of writing them to the filesystem
    InspectCertArg        bool // Display a human-readable inspection of the generated SSH certificate (public information only)
    SSHConfigured         bool
    Verbosity             int // Default verbosity is 0, 1 is verbose, 2 is debug
    RemoteRedirectURI     string

    overrideProvider *providers.OpenIdProvider // Used in tests to override the provider to inject a mock provider
    // State
    Config *config.ClientConfig

    // Outputs
    pkt        *pktoken.PKToken
    signer     crypto.Signer
    alg        jose.KeyAlgorithm
    client     *client.OpkClient
    principals []string
    loginCore  *libopkssh.LoginResult
    logger     libopkssh.Logger
    Host       *libopkssh.Host

    // For testing
    OutWriter io.Writer // Captures non-logged output that would normally be written to stdout
}

// NewLogin creates a new LoginCmd instance with the provided arguments.
func NewLogin(autoRefreshArg bool, configPathArg string, createConfigArg bool, configureArg bool, logDirArg string,
    sendAccessTokenArg bool, disableBrowserOpenArg bool, printIdTokenArg bool,
    providerArg string, printKeyArg bool, keyPathArg string, providerAliasArg string, keyTypeArg KeyType,
    remoteRedirectUri string, inspectCertArg bool,
) *LoginCmd {
    return &LoginCmd{
        Fs:                    afero.NewOsFs(),
        AutoRefreshArg:        autoRefreshArg,
        ConfigPathArg:         configPathArg,
        CreateConfigArg:       createConfigArg,
        ConfigureArg:          configureArg,
        LogDirArg:             logDirArg,
        SendAccessTokenArg:    sendAccessTokenArg,
        DisableBrowserOpenArg: disableBrowserOpenArg,
        PrintIdTokenArg:       printIdTokenArg,
        KeyPathArg:            keyPathArg,
        ProviderArg:           providerArg,
        PrintKeyArg:           printKeyArg,
        InspectCertArg:        inspectCertArg,
        ProviderAliasArg:      providerAliasArg,
        KeyTypeArg:            keyTypeArg,
        RemoteRedirectURI:     remoteRedirectUri,
    }
}

func (l *LoginCmd) Run(ctx context.Context) error {
    logCloser := l.configureLogger()
    if logCloser != nil {
        defer logCloser.Close()
    }

    if l.Verbosity >= 2 {
        l.logf("DEBUG: running login command with args: %+v", *l)
    }

    // If the Config has been set in the struct don't replace it. This is useful for testing
    if l.Config == nil {
        if l.ConfigPathArg == "" {
            homeDir, err := l.homeDir()
            if err != nil {
                return fmt.Errorf("failed to get user config dir: %w", err)
            }
            l.ConfigPathArg = filepath.Join(homeDir, ".opk", "config.yml")
        }
        if _, err := l.Fs.Stat(l.ConfigPathArg); err == nil {
            if l.CreateConfigArg {
                l.logf("--create-config=true but config file already exists at %s", l.ConfigPathArg)
            }

            if client_config, err := config.GetClientConfigFromFile((l.ConfigPathArg), l.Fs); err != nil {
                return err
            } else {
                l.Config = client_config
            }
        } else {
            if l.CreateConfigArg {
                return l.createDefaultClientConfig(l.ConfigPathArg)
            } else {
                l.logf("failed to find client config file to generate a default config, run `opkssh login --create-config` to create a default config file")
            }
            l.Config, err = config.NewClientConfig(config.DefaultClientConfig)
            if err != nil {
                return fmt.Errorf("failed to parse default config file: %w", err)
            }
        }
    }

    if l.ConfigureArg {
        err := l.configureSSH()
        if err != nil {
            return fmt.Errorf("failed to configure SSH: %w", err)
        }
        return nil
    } else {
        l.checkSSHConfigured()
    }

    if isGitHubEnvironment() {
        l.Config.Providers = append(l.Config.Providers, config.GitHubProviderConfig())
    }

    var provider providers.OpenIdProvider
    if l.overrideProvider != nil {
        provider = *l.overrideProvider
    } else {
        op, chooser, err := l.determineProvider()
        if err != nil {
            return err
        }
        if chooser != nil {
            provider, err = chooser.ChooseOp(ctx)
            if err != nil {
                return fmt.Errorf("error choosing provider: %w", err)
            }
        } else if op != nil {
            provider = op
        } else {
            return fmt.Errorf("no provider found")
        }
    }

    if !l.SendAccessTokenArg {
        if opConfig, ok := l.Config.GetByIssuer(provider.Issuer()); !ok {
            l.logf("Warning: could not find issuer %s in client config providers", provider.Issuer())
        } else {
            l.SendAccessTokenArg = opConfig.SendAccessToken
        }
    }

    if l.AutoRefreshArg {
        if providerRefreshable, ok := provider.(providers.RefreshableOpenIdProvider); ok {
            err := l.LoginWithRefresh(ctx, providerRefreshable, l.PrintIdTokenArg, l.KeyPathArg)
            if err != nil {
                return fmt.Errorf("error logging in: %w", err)
            }
        } else {
            return fmt.Errorf("supplied OpenID Provider (%v) does not support auto-refresh and auto-refresh argument set to true", provider.Issuer())
        }
    } else {
        err := l.Login(ctx, provider, l.PrintIdTokenArg, l.KeyPathArg)
        if err != nil {
            return fmt.Errorf("error logging in: %w", err)
        }
    }
    return nil
}

func (l *LoginCmd) configureSSH() error {

    userhomeDir, err := l.homeDir()
    if err != nil {
        return fmt.Errorf("failed to get user config dir: %v", err)
    }

    const includeDirective = "Include ~/.ssh/opkssh/config"
    const opkSshDir = ".ssh/opkssh"
    var userSshConfig = filepath.Join(userhomeDir, ".ssh/config")
    var userOpkSshDir = filepath.Join(userhomeDir, opkSshDir)
    var userOpkSshConfig = filepath.Join(userOpkSshDir, "config")

    if _, err := l.Fs.Stat(userOpkSshConfig); err == nil {
        l.logf("--configure but already configured")
    }

    l.logf("Creating config directory at %s", userOpkSshDir)

    afs := &afero.Afero{Fs: l.Fs}
    err = afs.MkdirAll(userOpkSshDir, 0o0700)
    if err != nil {
        return fmt.Errorf("failed to create opkssh SSH directory: %w", err)
    }

    l.logf("Creating config file at %s", userOpkSshConfig)

    file, err := afs.OpenFile(userOpkSshConfig, os.O_CREATE, 0o0600)
    if err != nil {
        return fmt.Errorf("failed to create opkssh SSH directory: %w", err)
    }
    defer file.Close()

    l.logf("Adding include directive to SSH config at %s", "~/.ssh/config")

    content, err := afs.ReadFile(userSshConfig)
    if err != nil && !errors.Is(err, os.ErrNotExist) {
        return fmt.Errorf("failed to read SSH config file: %w", err)
    }

    if strings.Contains(string(content), includeDirective) {
        l.logf("Found include directive file in SSH config, skipping...")
    } else {
        content = slices.Concat([]byte(includeDirective+"\n\n"), content)

        err = afs.WriteFile(userSshConfig, content, 0o0600)
        if err != nil {
            return fmt.Errorf("failed to write SSH config file: %w", err)
        }
    }

    l.SSHConfigured = true
    l.logf("Configured SSH identity directory")
    return nil
}

func (l *LoginCmd) checkSSHConfigured() {

    userhomeDir, err := l.homeDir()
    if err != nil {
        l.logf("Failed to get user config dir: %v", err)
        return
    }

    const includeDirective = "Include ~/.ssh/opkssh/config"
    const opkSshDir = ".ssh/opkssh"
    var userSshConfig = filepath.Join(userhomeDir, ".ssh/config")
    var userOpkSshDir = filepath.Join(userhomeDir, opkSshDir)
    var userOpkSshConfig = filepath.Join(userOpkSshDir, "config")

    afs := &afero.Afero{Fs: l.Fs}

    content, err := afs.ReadFile(userSshConfig)
    if err != nil {
        return
    }

    if !strings.Contains(string(content), includeDirective) {
        return
    }

    _, err = afs.Stat(userOpkSshConfig)
    if err != nil {
        return
    }

    fmt.Fprintln(l.out(), "OPK SSH identity directory is configured")

    l.SSHConfigured = true
}

func (l *LoginCmd) determineProvider() (providers.OpenIdProvider, *choosers.WebChooser, error) {
    openBrowser := !l.DisableBrowserOpenArg

    var defaultProviderAlias string
    var providerConfigs []config.ProviderConfig
    var provider providers.OpenIdProvider
    var err error

    if l.ProviderArg != "" {
        providerConfig, err := config.NewProviderConfigFromString(l.ProviderArg, false)
        if err != nil {
            return nil, nil, fmt.Errorf("error parsing provider argument: %w", err)
        }

        if l.RemoteRedirectURI != "" {
            providerConfig.RemoteRedirectURI = l.RemoteRedirectURI
        }

        if provider, err = providerConfig.ToProvider(openBrowser); err != nil {
            return nil, nil, fmt.Errorf("error creating provider from config: %w", err)
        } else {
            return provider, nil, nil
        }
    }

    defaultProviderEnv, _ := os.LookupEnv(config.OPKSSH_DEFAULT_ENVVAR)
    providerConfigsEnv, err := config.GetProvidersConfigFromEnv()
    if err != nil {
        return nil, nil, fmt.Errorf("error getting provider config from env: %w", err)
    }

    if l.ProviderAliasArg != "" {
        defaultProviderAlias = l.ProviderAliasArg
    } else if defaultProviderEnv != "" {
        defaultProviderAlias = defaultProviderEnv
    } else if l.Config.DefaultProvider != "" {
        defaultProviderAlias = l.Config.DefaultProvider
    } else {
        defaultProviderAlias = config.WEBCHOOSER_ALIAS
    }

    if providerConfigsEnv != nil {
        providerConfigs = providerConfigsEnv
    } else if len(l.Config.Providers) > 0 {
        providerConfigs = l.Config.Providers
    } else {
        return nil, nil, fmt.Errorf("no providers specified")
    }

    if strings.ToUpper(defaultProviderAlias) != config.WEBCHOOSER_ALIAS {
        providerMap, err := config.CreateProvidersMap(providerConfigs)
        if err != nil {
            return nil, nil, fmt.Errorf("error creating provider map: %w", err)
        }
        providerConfig, ok := providerMap[defaultProviderAlias]
        if !ok {
            return nil, nil, fmt.Errorf("error getting provider config for alias %s", defaultProviderAlias)
        }
        if l.RemoteRedirectURI != "" {
            providerConfig.RemoteRedirectURI = l.RemoteRedirectURI
        }

        provider, err = providerConfig.ToProvider(openBrowser)
        if err != nil {
            return nil, nil, fmt.Errorf("error creating provider from config: %w", err)
        }
        return provider, nil, nil
    } else {
        var providerList []providers.BrowserOpenIdProvider
        for _, providerConfig := range providerConfigs {
            if l.RemoteRedirectURI != "" {
                providerConfig.RemoteRedirectURI = l.RemoteRedirectURI
            }
            op, err := providerConfig.ToProvider(openBrowser)
            if err != nil {
                return nil, nil, fmt.Errorf("error creating provider from config: %w", err)
            }
            providerList = append(providerList, op.(providers.BrowserOpenIdProvider))
        }

        chooser := choosers.NewWebChooser(
            providerList, openBrowser,
        )
        return nil, chooser, nil
    }
}

func (l *LoginCmd) login(ctx context.Context, provider providers.OpenIdProvider, printIdToken bool, seckeyPath string) (*LoginCmd, error) {
    keyType, err := l.KeyTypeArg.toLibopksshKeyType()
    if err != nil {
        return nil, err
    }

    loginResult, err := libopkssh.RunLoginWithHost(ctx, libopkssh.LoginRequest{
        Provider:        provider,
        KeyType:         keyType,
        SendAccessToken: l.SendAccessTokenArg,
    }, l.Host)
    if err != nil {
        return nil, err
    }

    l.pkt = loginResult.Session.PKToken

    if l.PrintKeyArg {
        w := l.out()
        fmt.Fprintln(w, string(loginResult.Certificate))
        fmt.Fprintln(w, string(loginResult.PrivateKeyPEM))
    } else if seckeyPath != "" {
        if err := l.writeKeys(seckeyPath, seckeyPath+"-cert.pub", loginResult.PrivateKeyPEM, loginResult.Certificate); err != nil {
            return nil, fmt.Errorf("failed to write SSH keys to filesystem: %w", err)
        }
    } else if l.SSHConfigured {
        if err := l.writeKeysToOpkSSHDir(loginResult.PrivateKeyPEM, loginResult.Certificate); err != nil {
            return nil, fmt.Errorf("failed to write SSH keys to OPK SSH dir: %w", err)
        }
    } else {
        if err := l.writeKeysToSSHDir(loginResult.PrivateKeyPEM, loginResult.Certificate); err != nil {
            return nil, fmt.Errorf("failed to write SSH keys to filesystem: %w", err)
        }
    }

    if printIdToken {
        idTokenStr, err := libopkssh.PrettyIDToken(*loginResult.Session.PKToken)
        if err != nil {
            return nil, fmt.Errorf("failed to format ID Token: %w", err)
        }

        fmt.Fprintf(l.out(), "id_token:\n%s\n", idTokenStr)
    }

    if l.InspectCertArg {
        inspect := NewInspectCmd(string(loginResult.Certificate), l.out())
        if err := inspect.Run(); err != nil {
            return nil, fmt.Errorf("failed to inspect SSH cert: %w", err)
        }
    }

    fmt.Fprintf(l.out(), "Keys generated for identity\n%s\n", loginResult.Identity)

    return &LoginCmd{
        pkt:        loginResult.Session.PKToken,
        signer:     loginResult.Session.Signer,
        client:     loginResult.Session.Client,
        alg:        loginResult.Session.Algorithm,
        principals: loginResult.Session.Principals,
        loginCore:  loginResult,
    }, nil
}

func (l *LoginCmd) Login(ctx context.Context, provider providers.OpenIdProvider, printIdToken bool, seckeyPath string) error {
    _, err := l.login(ctx, provider, printIdToken, seckeyPath)
    return err
}

func (l *LoginCmd) LoginWithRefresh(ctx context.Context, provider providers.RefreshableOpenIdProvider, printIdToken bool, seckeyPath string) error {
    if loginResult, err := l.login(ctx, provider, printIdToken, seckeyPath); err != nil {
        return err
    } else {
        for {
            untilExpired := time.Until(loginResult.loginCore.ExpiresAt) - time.Minute
            l.logf("Waiting for %v before attempting to refresh id_token...", untilExpired)
            select {
            case <-time.After(untilExpired):
                l.logf("Refreshing id_token...")
            case <-ctx.Done():
                return ctx.Err()
            }

            refreshedResult, err := libopkssh.RefreshLogin(ctx, loginResult.loginCore.Session, l.SendAccessTokenArg)
            if err != nil {
                return err
            }
            loginResult.loginCore = refreshedResult
            loginResult.pkt = refreshedResult.Session.PKToken
            loginResult.signer = refreshedResult.Session.Signer
            loginResult.client = refreshedResult.Session.Client
            loginResult.alg = refreshedResult.Session.Algorithm
            loginResult.principals = refreshedResult.Session.Principals

            if seckeyPath != "" {
                if err := l.writeKeys(seckeyPath, seckeyPath+"-cert.pub", refreshedResult.PrivateKeyPEM, refreshedResult.Certificate); err != nil {
                    return fmt.Errorf("failed to write SSH keys to filesystem: %w", err)
                }
            } else {
                if err := l.writeKeysToSSHDir(refreshedResult.PrivateKeyPEM, refreshedResult.Certificate); err != nil {
                    return fmt.Errorf("failed to write SSH keys to filesystem: %w", err)
                }
            }
        }
    }
}

func (l *LoginCmd) out() io.Writer {
    if l.OutWriter != nil {
        return l.OutWriter
    }
    return os.Stdout
}

func createSSHCert(pkt *pktoken.PKToken, signer crypto.Signer, principals []string) ([]byte, []byte, error) {
    return libopkssh.CreateSSHCert(pkt, signer, principals)
}

func createSSHCertWithAccessToken(pkt *pktoken.PKToken, accessToken []byte, signer crypto.Signer, principals []string) ([]byte, []byte, error) {
    return libopkssh.CreateSSHCertWithAccessToken(pkt, accessToken, signer, principals)
}

func (l *LoginCmd) writeKeysToOpkSSHDir(secKeyPem []byte, certBytes []byte) error {

    const (
        opkSshPath     = ".ssh/opkssh"
        configFileName = "config"
    )

    userhomeDir, err := l.homeDir()
    if err != nil {
        return err
    }

    opkSshUserPath := filepath.Join(userhomeDir, opkSshPath)
    opkSshConfigPath := filepath.Join(opkSshUserPath, configFileName)

    sshKeyName := l.makeSSHKeyFileName(l.pkt)

    privKeyPath := filepath.Join(opkSshUserPath, sshKeyName)
    pubKeyPath := filepath.Join(privKeyPath + "-cert.pub")

    issuer, err := l.pkt.Issuer()
    if err != nil {
        issuer = "unknown"
    }

    audience, err := l.pkt.Audience()
    if err != nil {
        audience = "unknown"
    }

    comment := " openpubkey: " + issuer + " " + audience

    afs := &afero.Afero{Fs: l.Fs}
    configContent, err := afs.ReadFile(opkSshConfigPath)
    if err != nil {
        return fmt.Errorf("failed to read opk ssh config file (%s): %w", opkSshConfigPath, err)
    }

    if !strings.Contains(string(configContent), privKeyPath) {
        configContent = slices.Concat(
            []byte("IdentityFile "+privKeyPath+"\n"),
            configContent,
        )
    }

    err = afs.WriteFile(opkSshConfigPath, configContent, 0600)
    if err != nil {
        return fmt.Errorf("failed to write opk ssh config file (%s): %w", opkSshConfigPath, err)
    }

    return l.writeKeysComment(privKeyPath, pubKeyPath, secKeyPem, certBytes, comment)
}

func (l *LoginCmd) writeKeysToSSHDir(seckeySshPem []byte, certBytes []byte) error {
    homePath, err := l.homeDir()
    if err != nil {
        return err
    }
    sshPath := filepath.Join(homePath, ".ssh")

    err = l.Fs.MkdirAll(sshPath, os.ModePerm)
    if err != nil {
        return err
    }

    keyFileNames, ok := DefaultSSHKeyFileNames[l.KeyTypeArg]
    if !ok {
        return fmt.Errorf("key type (%s) has no default output file name; use -i <filePath>", l.KeyTypeArg.String())
    }

    for _, keyFilename := range keyFileNames {
        seckeyPath := filepath.Join(sshPath, keyFilename)
        pubkeyPath := seckeyPath + "-cert.pub"

        if !l.fileExists(seckeyPath) {
            return l.writeKeys(seckeyPath, pubkeyPath, seckeySshPem, certBytes)
        } else if !l.fileExists(pubkeyPath) {
            continue
        } else {
            afs := &afero.Afero{Fs: l.Fs}
            sshPubkey, err := afs.ReadFile(pubkeyPath)
            if err != nil {
                l.logf("Failed to read: %s", pubkeyPath)
                continue
            }
            _, comment, _, _, err := ssh.ParseAuthorizedKey(sshPubkey)
            if err != nil {
                l.logf("Failed to parse: %s", pubkeyPath)
                continue
            }

            if comment == "openpubkey" {
                return l.writeKeys(seckeyPath, pubkeyPath, seckeySshPem, certBytes)
            }
        }
    }
    return fmt.Errorf("no default ssh key file free for openpubkey")
}

func (l *LoginCmd) writeKeys(seckeyPath string, pubkeyPath string, seckeySshPem []byte, certBytes []byte) error {
    afs := &afero.Afero{Fs: l.Fs}
    if err := afs.WriteFile(seckeyPath, seckeySshPem, 0o600); err != nil {
        return err
    }

    fmt.Fprintf(l.out(), "Writing opk ssh public key to %s and corresponding secret key to %s\n", pubkeyPath, seckeyPath)

    certBytes = append(certBytes, []byte(" openpubkey")...)
    return afs.WriteFile(pubkeyPath, certBytes, 0o644)
}

func (l *LoginCmd) writeKeysComment(seckeyPath string, pubkeyPath string, seckeySshPem []byte, certBytes []byte, pubKeyComment string) error {
    afs := &afero.Afero{Fs: l.Fs}
    if err := afs.WriteFile(seckeyPath, seckeySshPem, 0o600); err != nil {
        return err
    }

    fmt.Fprintf(l.out(), "Writing opk ssh public key to %s and corresponding secret key to %s\n", pubkeyPath, seckeyPath)

    certBytes = append(certBytes, ' ')
    certBytes = append(certBytes, pubKeyComment...)
    return afs.WriteFile(pubkeyPath, certBytes, 0o644)
}

func (l *LoginCmd) makeSSHKeyFileName(pkt *pktoken.PKToken) string {

    regex := regexp.MustCompile(`[^a-zA-Z0-9_\-.]+`)

    issuer, err := pkt.Issuer()
    if err != nil {
        issuer = "unknown"
    }

    issuer, _ = strings.CutPrefix(issuer, "https://")

    audience, err := pkt.Audience()
    if err != nil {
        audience = "unknown"
    }

    if len(audience) > 20 {
        audience = audience[:20]
    }

    keyName := issuer + "-" + audience
    keyName = regex.ReplaceAllString(keyName, "_")

    return keyName
}

func (l *LoginCmd) fileExists(fPath string) bool {
    _, err := l.Fs.Open(fPath)
    return !errors.Is(err, os.ErrNotExist)
}

func IdentityString(pkt pktoken.PKToken) (string, error) {
    return libopkssh.IdentityString(pkt)
}

func PrettyIdToken(pkt pktoken.PKToken) (string, error) {
    return libopkssh.PrettyIDToken(pkt)
}

func isGitHubEnvironment() bool {
    return os.Getenv("ACTIONS_ID_TOKEN_REQUEST_URL") != "" &&
        os.Getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN") != ""
}

func (l *LoginCmd) configureLogger() io.Closer {
    if l.Host != nil && l.Host.Logger != nil {
        l.logger = l.Host.Logger
        return nil
    }

    writer := io.Writer(os.Stdout)
    if l.Host != nil {
        writer = io.Discard
    }
    var closer io.Closer

    if l.LogDirArg != "" {
        logFilePath := filepath.Join(l.LogDirArg, "opkssh.log")
        logFile, err := l.Fs.OpenFile(logFilePath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o660)
        if err != nil {
            fmt.Fprintf(l.out(), "Failed to open log for writing: %v\n", err)
        } else {
            closer = logFile
            writer = io.MultiWriter(writer, logFile)
        }
    }

    l.logger = libopkssh.NewWriterLogger(writer)
    if l.Host != nil && l.Host.Logger == nil {
        l.Host.Logger = l.logger
    }

    return closer
}

func (l *LoginCmd) logf(format string, args ...any) {
    if l.logger != nil {
        l.logger.Printf(format, args...)
        return
    }
    if l.Host != nil && l.Host.Logger != nil {
        l.Host.Logger.Printf(format, args...)
        return
    }
    log.Printf(format, args...)
}

func (l *LoginCmd) homeDir() (string, error) {
    if l.Host != nil {
        return l.Host.HomeDir()
    }
    return os.UserHomeDir()
}

func (l *LoginCmd) createDefaultClientConfig(configPath string) error {
    afs := &afero.Afero{Fs: l.Fs}
    if err := afs.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
        return fmt.Errorf("failed to create config directory: %w", err)
    }
    if err := afs.WriteFile(configPath, config.DefaultClientConfig, 0o644); err != nil {
        return fmt.Errorf("failed to write default config file: %w", err)
    }
    l.logf("created client config file at %s", configPath)
    return nil
}

func payloadFromCompactPkt(compactPkt []byte) []byte {
    parts := bytes.Split(compactPkt, []byte("."))
    return parts[1]
}
"####;

const OPKSSH_LIB_CONFIG_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package libopkssh

import (
    commandconfig "github.com/openpubkey/opkssh/commands/config"
    "github.com/spf13/afero"
)

// ClientConfig mirrors ~/.opk/config.yml.
// If client_secret is stored in the YAML file, it remains plaintext on disk.
type ClientConfig = commandconfig.ClientConfig

// ProviderConfig mirrors a single provider stanza in ~/.opk/config.yml.
// If client_secret is present, the value is still plaintext YAML.
type ProviderConfig = commandconfig.ProviderConfig

// DefaultClientConfigBytes returns a copy of the embedded default client configuration.
func DefaultClientConfigBytes() []byte {
    return append([]byte(nil), commandconfig.DefaultClientConfig...)
}

// LoadDefaultClientConfig parses the embedded default client configuration.
func LoadDefaultClientConfig() (*ClientConfig, error) {
    return commandconfig.NewClientConfig(DefaultClientConfigBytes())
}

// NewClientConfig parses the client YAML into the typed client configuration.
func NewClientConfig(configBytes []byte) (*ClientConfig, error) {
    return commandconfig.NewClientConfig(configBytes)
}

// ResolveClientConfigPath resolves the default client config path when configPath is empty.
func ResolveClientConfigPath(configPath string) (string, error) {
    if err := commandconfig.ResolveClientConfigPath(&configPath); err != nil {
        return "", err
    }
    return configPath, nil
}

// LoadClientConfig loads the typed client config from disk.
func LoadClientConfig(configPath string, fs afero.Fs) (*ClientConfig, error) {
    if fs == nil {
        fs = afero.NewOsFs()
    }
    return commandconfig.GetClientConfigFromFile(configPath, fs)
}

// CreateDefaultClientConfig writes the embedded default client configuration to disk.
func CreateDefaultClientConfig(configPath string, fs afero.Fs) error {
    if fs == nil {
        fs = afero.NewOsFs()
    }

    resolvedPath, err := ResolveClientConfigPath(configPath)
    if err != nil {
        return err
    }

    return commandconfig.CreateDefaultClientConfig(resolvedPath, fs)
}

// CreateProvidersMap validates provider aliases and returns the lookup map used by login flows.
func CreateProvidersMap(providers []ProviderConfig) (map[string]ProviderConfig, error) {
    return commandconfig.CreateProvidersMap(providers)
}
"####;

const OPKSSH_LIB_HOST_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package libopkssh

import (
    "context"
    "fmt"
    "io"
    "os"
    "strings"
    "sync"

    "github.com/openpubkey/openpubkey/providers"
    "github.com/sirupsen/logrus"
)

// Logger is the narrow log sink used by embedders and the CLI wrapper.
type Logger interface {
    Printf(format string, args ...any)
}

// WriterLogger adapts an io.Writer to the Logger interface.
type WriterLogger struct {
    writer io.Writer
    mu     sync.Mutex
}

// NewWriterLogger returns a Logger that writes formatted lines to writer.
func NewWriterLogger(writer io.Writer) *WriterLogger {
    return &WriterLogger{writer: writer}
}

// Printf writes a formatted log line.
func (l *WriterLogger) Printf(format string, args ...any) {
    if l == nil || l.writer == nil {
        return
    }

    l.mu.Lock()
    defer l.mu.Unlock()

    _, _ = fmt.Fprintf(l.writer, format+"\n", args...)
}

// Host owns the host-side seams needed to embed the login flow.
type Host struct {
    UserHomeDir       func() (string, error)
    Logger            Logger
    CaptureBrowserURL bool
    OpenBrowser       func(string) error
}

// HostSession describes the browser/callback ownership in effect for a login.
type HostSession struct {
    LoginURLs                       <-chan string
    CallbackListenerOwnedByProvider bool
    CallbackShutdownOwnedByProvider bool
}

type loginOutcome struct {
    result *LoginResult
    err    error
}

// LoginOperation is a host-driven handle for an in-flight login.
type LoginOperation struct {
    HostSession *HostSession
    done        <-chan loginOutcome
}

// Await waits for the in-flight login to complete.
func (o *LoginOperation) Await(ctx context.Context) (*LoginResult, error) {
    if o == nil {
        return nil, fmt.Errorf("login operation is required")
    }

    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    case outcome, ok := <-o.done:
        if !ok {
            return nil, fmt.Errorf("login operation terminated without a result")
        }
        return outcome.result, outcome.err
    }
}

// HomeDir returns the host-owned home directory or the process default.
func (h *Host) HomeDir() (string, error) {
    if h != nil && h.UserHomeDir != nil {
        return h.UserHomeDir()
    }
    return os.UserHomeDir()
}

// Logf writes a message to the host log sink if one is configured.
func (h *Host) Logf(format string, args ...any) {
    if h != nil && h.Logger != nil {
        h.Logger.Printf(format, args...)
    }
}

var providerLogSinkMu sync.Mutex

func (h *Host) prepareProvider(ctx context.Context, provider providers.OpenIdProvider) (*HostSession, func(), error) {
    releaseLogs := h.captureProviderLogs()
    if h == nil {
        return nil, releaseLogs, nil
    }

    browserControl := h.CaptureBrowserURL || h.OpenBrowser != nil
    if !browserControl {
        return nil, releaseLogs, nil
    }

    browserProvider, ok := provider.(providers.BrowserOpenIdProvider)
    if !ok {
        releaseLogs()
        return nil, nil, fmt.Errorf("provider %T does not support browser host hooks", provider)
    }

    var loginURLs <-chan string
    if browserControl {
        providerLoginURLs := make(chan string, 1)
        sessionLoginURLs := make(chan string, 1)
        browserProvider.ReuseBrowserWindowHook(providerLoginURLs)

        go func() {
            defer close(sessionLoginURLs)

            select {
            case <-ctx.Done():
                return
            case loginURL := <-providerLoginURLs:
                if h.OpenBrowser != nil {
                    if err := h.OpenBrowser(loginURL); err != nil {
                        h.Logf("failed to open browser: %v", err)
                    }
                }

                sessionLoginURLs <- loginURL
            }
        }()

        loginURLs = sessionLoginURLs
    }

    return &HostSession{
        LoginURLs:                       loginURLs,
        CallbackListenerOwnedByProvider: true,
        CallbackShutdownOwnedByProvider: true,
    }, releaseLogs, nil
}

func (h *Host) captureProviderLogs() func() {
    if h == nil || h.Logger == nil {
        return func() {}
    }

    providerLogSinkMu.Lock()
    previousOutput := logrus.StandardLogger().Out
    logrus.SetOutput(logWriter{logger: h.Logger})

    return func() {
        logrus.SetOutput(previousOutput)
        providerLogSinkMu.Unlock()
    }
}

type logWriter struct {
    logger Logger
}

func (w logWriter) Write(p []byte) (int, error) {
    message := strings.TrimSpace(string(p))
    if message != "" {
        w.logger.Printf("%s", message)
    }
    return len(p), nil
}
"####;

const OPKSSH_LIB_LOGIN_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package libopkssh

import (
    "bytes"
    "context"
    "crypto"
    "crypto/ecdsa"
    "encoding/base64"
    "encoding/json"
    "encoding/pem"
    "fmt"
    "time"

    "github.com/openpubkey/openpubkey/client"
    "github.com/openpubkey/openpubkey/jose"
    "github.com/openpubkey/openpubkey/oidc"
    "github.com/openpubkey/openpubkey/pktoken"
    "github.com/openpubkey/openpubkey/util"
    "github.com/openpubkey/opkssh/sshcert"
    "golang.org/x/crypto/ed25519"
    "golang.org/x/crypto/ssh"
)

// StartLogin returns a host-driven handle for an in-flight login.
func StartLogin(ctx context.Context, req LoginRequest, host *Host) (*LoginOperation, error) {
    if req.Provider == nil {
        return nil, fmt.Errorf("provider is required")
    }

    hostSession, releaseHostLogs, err := host.prepareProvider(ctx, req.Provider)
    if err != nil {
        return nil, err
    }

    done := make(chan loginOutcome, 1)
    go func() {
        defer close(done)
        defer releaseHostLogs()

        result, err := runLogin(ctx, req)
        done <- loginOutcome{result: result, err: err}
    }()

    return &LoginOperation{HostSession: hostSession, done: done}, nil
}

// RunLogin performs provider auth and returns structured SSH key material.
func RunLogin(ctx context.Context, req LoginRequest) (*LoginResult, error) {
    return RunLoginWithHost(ctx, req, nil)
}

// RunLoginWithHost performs provider auth using the supplied host seams.
func RunLoginWithHost(ctx context.Context, req LoginRequest, host *Host) (*LoginResult, error) {
    operation, err := StartLogin(ctx, req, host)
    if err != nil {
        return nil, err
    }

    return operation.Await(ctx)
}

func runLogin(ctx context.Context, req LoginRequest) (*LoginResult, error) {
    if req.Provider == nil {
        return nil, fmt.Errorf("provider is required")
    }

    alg, err := keyAlgorithm(req.KeyType)
    if err != nil {
        return nil, err
    }

    signer, err := util.GenKeyPair(alg)
    if err != nil {
        return nil, fmt.Errorf("failed to generate keypair: %w", err)
    }

    opkClient, err := client.New(req.Provider, client.WithSigner(signer, alg))
    if err != nil {
        return nil, err
    }

    pkt, err := opkClient.Auth(ctx)
    if err != nil {
        return nil, err
    }

    var accessToken []byte
    if req.SendAccessToken {
        accessToken = opkClient.GetAccessToken()
        if accessToken == nil {
            return nil, fmt.Errorf("access token required but provider (%s) did not set access-token", opkClient.Op.Issuer())
        }
    }

    principals := []string{"opkssh-wildcard"}
    certBytes, seckeySshPem, err := CreateSSHCertWithAccessToken(pkt, accessToken, signer, principals)
    if err != nil {
        return nil, fmt.Errorf("failed to generate SSH cert: %w", err)
    }

    identity, err := IdentityString(*pkt)
    if err != nil {
        return nil, fmt.Errorf("failed to parse ID Token: %w", err)
    }

    expiresAt, err := expirationFromToken(pkt)
    if err != nil {
        return nil, err
    }

    return &LoginResult{
        Session: &LoginSession{
            PKToken:    pkt,
            Signer:     signer,
            Algorithm:  alg,
            Client:     opkClient,
            Principals: principals,
        },
        Certificate:   certBytes,
        PrivateKeyPEM: seckeySshPem,
        Identity:      identity,
        ExpiresAt:     expiresAt,
    }, nil
}

// RefreshLogin refreshes the PK token and regenerates SSH key material.
func RefreshLogin(ctx context.Context, session *LoginSession, sendAccessToken bool) (*LoginResult, error) {
    if session == nil {
        return nil, fmt.Errorf("login session is required")
    }
    if session.Client == nil {
        return nil, fmt.Errorf("login session client is required")
    }
    if session.Signer == nil {
        return nil, fmt.Errorf("login session signer is required")
    }

    refreshedPkt, err := session.Client.Refresh(ctx)
    if err != nil {
        return nil, err
    }

    var accessToken []byte
    if sendAccessToken {
        accessToken = session.Client.GetAccessToken()
        if accessToken == nil {
            return nil, fmt.Errorf("access token required but provider (%s) did not set access-token on refresh", session.Client.Op.Issuer())
        }
    }

    certBytes, seckeySshPem, err := CreateSSHCertWithAccessToken(refreshedPkt, accessToken, session.Signer, session.Principals)
    if err != nil {
        return nil, fmt.Errorf("failed to generate SSH cert: %w", err)
    }

    identity, err := IdentityString(*refreshedPkt)
    if err != nil {
        return nil, fmt.Errorf("failed to parse ID Token: %w", err)
    }

    expiresAt, err := expirationFromToken(refreshedPkt)
    if err != nil {
        return nil, err
    }

    return &LoginResult{
        Session: &LoginSession{
            PKToken:    refreshedPkt,
            Signer:     session.Signer,
            Algorithm:  session.Algorithm,
            Client:     session.Client,
            Principals: session.Principals,
        },
        Certificate:   certBytes,
        PrivateKeyPEM: seckeySshPem,
        Identity:      identity,
        ExpiresAt:     expiresAt,
    }, nil
}

// CreateSSHCert creates an SSH certificate without an access token payload.
func CreateSSHCert(pkt *pktoken.PKToken, signer crypto.Signer, principals []string) ([]byte, []byte, error) {
    return CreateSSHCertWithAccessToken(pkt, nil, signer, principals)
}

// CreateSSHCertWithAccessToken creates an SSH certificate and OpenSSH private key.
func CreateSSHCertWithAccessToken(pkt *pktoken.PKToken, accessToken []byte, signer crypto.Signer, principals []string) ([]byte, []byte, error) {
    cert, err := sshcert.New(pkt, accessToken, principals)
    if err != nil {
        return nil, nil, err
    }
    sshSigner, err := ssh.NewSignerFromSigner(signer)
    if err != nil {
        return nil, nil, err
    }

    var keyAlgos []string
    switch signer.(type) {
    case *ecdsa.PrivateKey:
        keyAlgos = []string{ssh.KeyAlgoECDSA256}
    case ed25519.PrivateKey:
        keyAlgos = []string{ssh.KeyAlgoED25519}
    default:
        return nil, nil, fmt.Errorf("unsupported key type: %T", signer)
    }

    signerMas, err := ssh.NewSignerWithAlgorithms(sshSigner.(ssh.AlgorithmSigner), keyAlgos)
    if err != nil {
        return nil, nil, err
    }

    sshCert, err := cert.SignCert(signerMas)
    if err != nil {
        return nil, nil, err
    }
    certBytes := ssh.MarshalAuthorizedKey(sshCert)
    certBytes = certBytes[:len(certBytes)-1]

    seckeySsh, err := ssh.MarshalPrivateKey(signer, "openpubkey cert")
    if err != nil {
        return nil, nil, err
    }
    seckeySshBytes := pem.EncodeToMemory(seckeySsh)

    return certBytes, seckeySshBytes, nil
}

// IdentityString returns a string representation of the identity from the PK token.
func IdentityString(pkt pktoken.PKToken) (string, error) {
    idt, err := oidc.NewJwt(pkt.OpToken)
    if err != nil {
        return "", err
    }
    claims := idt.GetClaims()
    if claims.Email == "" {
        return fmt.Sprintf(`WARNING: Email claim is missing from ID token. Policies based on email will not work.
Check if your client config (~/.opk/config.yml) has the correct scopes configured for this OpenID Provider.
Sub, issuer, audience:
%s %s %s`, claims.Subject, claims.Issuer, claims.Audience), nil
    }

    return fmt.Sprintf("Email, sub, issuer, audience: \n%s %s %s %s", claims.Email, claims.Subject, claims.Issuer, claims.Audience), nil
}

// PrettyIDToken returns a pretty-printed JSON representation of the ID token claims.
func PrettyIDToken(pkt pktoken.PKToken) (string, error) {
    idt, err := oidc.NewJwt(pkt.OpToken)
    if err != nil {
        return "", err
    }
    idtJSON, err := json.MarshalIndent(idt.GetClaims(), "", "  ")
    if err != nil {
        return "", err
    }
    return string(idtJSON), nil
}

func keyAlgorithm(keyType KeyType) (jose.KeyAlgorithm, error) {
    switch keyType {
    case ECDSA:
        return jose.ES256, nil
    case ED25519:
        return jose.EdDSA, nil
    default:
        return "", fmt.Errorf("unsupported key type (%s); use -t <%s|%s>", keyType.String(), ECDSA.String(), ED25519.String())
    }
}

func expirationFromToken(pkt *pktoken.PKToken) (time.Time, error) {
    var claims struct {
        Expiration int64 `json:"exp"`
    }

    payload := pkt.Payload
    if len(payload) == 0 {
        compactPkt, err := pkt.Compact()
        if err != nil {
            return time.Time{}, err
        }

        payloadB64 := payloadFromCompactPkt(compactPkt)
        payload, err = base64.RawURLEncoding.DecodeString(string(payloadB64))
        if err != nil {
            return time.Time{}, fmt.Errorf("ID token payload is not base64 encoded: %w", err)
        }
    }

    if err := json.Unmarshal(payload, &claims); err != nil {
        return time.Time{}, fmt.Errorf("malformed ID token payload: %w", err)
    }

    return time.Unix(claims.Expiration, 0), nil
}

func payloadFromCompactPkt(compactPkt []byte) []byte {
    parts := bytes.Split(compactPkt, []byte("."))
    return parts[1]
}
"####;

const OPKSSH_LIB_POC_LOGIN_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package libopkssh

import (
    "context"
    "fmt"
    "io"

    "github.com/openpubkey/openpubkey/providers"
    "github.com/spf13/afero"
)

// PocLoginRequest is a minimal library-facing request for the Phase 0 spike.
type PocLoginRequest struct {
    Provider   providers.OpenIdProvider
    KeyPath    string
    ConfigPath string
    KeyType    KeyType
    Fs         afero.Fs
    Host       *Host
    Stdout     io.Writer
}

// PocLoginResult is the structured outcome returned by the spike API.
type PocLoginResult struct {
    Success    bool
    Provider   string
    Identity   string
    KeyPath    string
    ConfigPath string
    Message    string
}

// Login keeps the original spike entrypoint while delegating to the extracted core.
func Login(ctx context.Context, req PocLoginRequest) (*PocLoginResult, error) {
    if req.Provider == nil {
        return nil, fmt.Errorf("provider is required")
    }
    if req.KeyPath == "" {
        return nil, fmt.Errorf("key path is required")
    }
    if req.ConfigPath == "" {
        return nil, fmt.Errorf("config path is required")
    }

    loginResult, err := RunLoginWithHost(ctx, LoginRequest{
        Provider: req.Provider,
        KeyType:  req.KeyType,
    }, req.Host)
    if err != nil {
        return nil, err
    }

    fs := req.Fs
    if fs == nil {
        fs = afero.NewOsFs()
    }

    if err := writePocKeyPair(fs, req.KeyPath, req.KeyPath+"-cert.pub", loginResult.PrivateKeyPEM, loginResult.Certificate); err != nil {
        return nil, fmt.Errorf("failed to write SSH keys to filesystem: %w", err)
    }

    if req.Stdout != nil {
        fmt.Fprintf(req.Stdout, "Keys generated for identity\n%s\n", loginResult.Identity)
    }

    return &PocLoginResult{
        Success:    true,
        Provider:   req.Provider.Issuer(),
        Identity:   loginResult.Identity,
        KeyPath:    req.KeyPath,
        ConfigPath: req.ConfigPath,
        Message:    "login completed without CLI spawn",
    }, nil
}

func writePocKeyPair(fs afero.Fs, seckeyPath string, pubkeyPath string, privateKeyPEM []byte, certBytes []byte) error {
    afs := &afero.Afero{Fs: fs}
    if err := afs.WriteFile(seckeyPath, privateKeyPEM, 0o600); err != nil {
        return err
    }

    certWithComment := append(append([]byte(nil), certBytes...), []byte(" openpubkey")...)
    return afs.WriteFile(pubkeyPath, certWithComment, 0o644)
}
"####;

const OPKSSH_LIB_TYPES_GO: &str = r####"// SPDX-License-Identifier: Apache-2.0

package libopkssh

import (
    "crypto"
    "time"

    "github.com/openpubkey/openpubkey/client"
    "github.com/openpubkey/openpubkey/jose"
    "github.com/openpubkey/openpubkey/pktoken"
    "github.com/openpubkey/openpubkey/providers"
)

// KeyType is the algorithm to use for the user's key pair.
type KeyType int

const (
    ECDSA KeyType = iota
    ED25519
)

func (k KeyType) String() string {
    switch k {
    case ECDSA:
        return "ecdsa"
    case ED25519:
        return "ed25519"
    default:
        return "unknown"
    }
}

// LoginRequest is the minimal host-facing input for the extracted login core.
type LoginRequest struct {
    Provider        providers.OpenIdProvider
    KeyType         KeyType
    SendAccessToken bool
}

// LoginSession holds the reusable session state needed for refreshes.
type LoginSession struct {
    PKToken    *pktoken.PKToken
    Signer     crypto.Signer
    Algorithm  jose.KeyAlgorithm
    Client     *client.OpkClient
    Principals []string
}

// LoginResult is the structured output of a login or refresh operation.
type LoginResult struct {
    Session       *LoginSession
    Certificate   []byte
    PrivateKeyPEM []byte
    Identity      string
    ExpiresAt     time.Time
}
"####;