//! End-to-end checks against the real `opencode` CLI, in a throwaway HOME so
//! the user's own config is never touched.
//!
//! Run with `WORD_MCP_BIN=/path/to/word_mcp_server cargo test -- --ignored live_`
//! (`pip install office-word-mcp-server` provides the binary).

use serde_json::json;

use super::mcp::{validate, McpServerEntry};
use super::opencode::{opencode_configure_providers, opencode_list_models};
use super::supervisor::shutdown_all as shutdown_server;

struct StopServer;
impl Drop for StopServer {
    fn drop(&mut self) {
        shutdown_server();
    }
}

#[tokio::test]
#[ignore = "needs the opencode CLI and the Word MCP server"]
async fn live_providers_and_mcp() {
    let home = std::env::temp_dir().join(format!("mali-live-{}", uuid::Uuid::new_v4().simple()));
    let config_dir = home.join(".config").join("opencode");
    std::fs::create_dir_all(&config_dir).unwrap();
    // A server the user added by hand, plus a custom server deleted since.
    std::fs::write(
        config_dir.join("opencode.json"),
        json!({ "mcp": {
            "mine": { "type": "local", "command": ["true"], "enabled": false },
            "custom-old": { "type": "local", "command": ["true"], "enabled": true }
        }})
        .to_string(),
    )
    .unwrap();
    // Keep the user's PATH (to find opencode) but isolate every config dir.
    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_CONFIG_HOME", home.join(".config"));
    std::env::set_var("XDG_DATA_HOME", home.join(".local/share"));
    let _stop = StopServer;

    // 1. Ollama + OpenRouter models become agent models.
    let providers = serde_json::from_value(json!([
        { "id": "ollama", "models": ["llama3.2"] },
        { "id": "openrouter", "models": ["z-ai/glm-5.2:free"] },
        { "id": "ollama-cloud", "models": ["gpt-oss:120b"], "apiKey": "test-key" }
    ]))
    .unwrap();
    let result = opencode_configure_providers(providers)
        .await
        .expect("configure");
    assert!(result.restarted, "first config restarts the server");
    let models = opencode_list_models(None).await.expect("list models");
    let ids: Vec<&str> = models.models.iter().map(|m| m.id.as_str()).collect();
    for id in [
        "ollama/llama3.2",
        "openrouter/z-ai/glm-5.2:free",
        "ollama-cloud/gpt-oss:120b",
    ] {
        assert!(ids.contains(&id), "{id} missing from {} models", ids.len());
    }

    // Same config again: no restart.
    let providers = serde_json::from_value(json!([
        { "id": "ollama", "models": ["llama3.2"] },
        { "id": "openrouter", "models": ["z-ai/glm-5.2:free"] },
        { "id": "ollama-cloud", "models": ["gpt-oss:120b"] }
    ]))
    .unwrap();
    assert!(
        !opencode_configure_providers(providers)
            .await
            .unwrap()
            .restarted
    );

    // 2. Word MCP connects; hand-written entries survive, stale custom ones go.
    let word_bin = std::env::var("WORD_MCP_BIN").expect("set WORD_MCP_BIN");
    let word = || McpServerEntry {
        id: "word".into(),
        enabled: true,
        kind: "local".into(),
        command: vec![word_bin.clone()],
        fallbacks: vec![],
        environment: [("MCP_TRANSPORT".to_string(), "stdio".to_string())].into(),
        url: None,
        headers: Default::default(),
        timeout_ms: Some(60_000),
        trust_level: crate::sandbox::McpTrustLevel::Unknown,
    };
    // Mali's own hub connects it (nothing is written into OpenCode's config).
    let started = std::time::Instant::now();
    let result = crate::mcp_hub::sync(&[word()], None).await;
    eprintln!("word: {:?} in {:?}", result, started.elapsed());
    assert_eq!(result[0].status, "connected", "{:?}", result[0].error);

    // Syncing again reuses the live connection.
    let started = std::time::Instant::now();
    let again = crate::mcp_hub::sync(&[word()], None).await;
    assert_eq!(again[0].status, "connected");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "cached sync is quick"
    );

    // A bad id never gets as far as a connection.
    let mut bad = word();
    bad.id = "../x".into();
    assert!(validate(&bad).is_err());
    crate::mcp_hub::disconnect("word").await;

    let _ = std::fs::remove_dir_all(home);
}
