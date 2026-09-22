use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Decision order is security-significant and must not depend on rule order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessDecision {
    Deny,
    Ask,
    Allow,
}

/// Registry origin is not a permission grant. Every new server starts unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum McpTrustLevel {
    Unknown,
    Verified,
    Trusted,
}

impl Default for McpTrustLevel {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemPolicy {
    pub workspace_read: AccessDecision,
    pub workspace_search: AccessDecision,
    pub workspace_write: AccessDecision,
    pub workspace_delete: AccessDecision,
    pub outside_read: AccessDecision,
    pub outside_search: AccessDecision,
    pub outside_write: AccessDecision,
    pub outside_delete: AccessDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPolicy {
    pub enabled: bool,
    #[serde(default)]
    pub allow_hosts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPolicy {
    #[serde(default)]
    pub allow: Vec<String>,
    pub allow_child_processes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPolicy {
    pub default: AccessDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialPolicy {
    pub default: AccessDecision,
    #[serde(default)]
    pub allow_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLimits {
    pub timeout_ms: u64,
    pub max_memory_mb: u64,
    pub max_processes: u32,
    pub max_output_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxPolicy {
    pub filesystem: FilesystemPolicy,
    pub network: NetworkPolicy,
    pub process: ProcessPolicy,
    pub commands: CommandPolicy,
    pub resources: ResourceLimits,
    pub credentials: CredentialPolicy,
    #[serde(default)]
    pub tool_permissions: BTreeMap<String, AccessDecision>,
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self {
            filesystem: FilesystemPolicy {
                workspace_read: AccessDecision::Allow,
                workspace_search: AccessDecision::Allow,
                workspace_write: AccessDecision::Allow,
                workspace_delete: AccessDecision::Ask,
                outside_read: AccessDecision::Ask,
                outside_search: AccessDecision::Ask,
                outside_write: AccessDecision::Ask,
                outside_delete: AccessDecision::Deny,
            },
            network: NetworkPolicy {
                enabled: false,
                allow_hosts: Vec::new(),
            },
            process: ProcessPolicy {
                allow: Vec::new(),
                allow_child_processes: false,
            },
            commands: CommandPolicy {
                default: AccessDecision::Ask,
            },
            resources: ResourceLimits {
                timeout_ms: 30_000,
                max_memory_mb: 1024,
                max_processes: 20,
                max_output_bytes: 10 * 1024 * 1024,
            },
            credentials: CredentialPolicy {
                default: AccessDecision::Deny,
                allow_names: Vec::new(),
            },
            tool_permissions: BTreeMap::new(),
        }
    }
}

impl SandboxPolicy {
    pub fn for_mcp(trust: McpTrustLevel) -> Self {
        let mut policy = Self::default();
        // Almost every MCP server exists to call an API, and there is no UI yet
        // to grant network per server, so the runner is not asked to break
        // outbound calls. Real network isolation needs OS support (namespaces,
        // AppContainer/WFP); pretending with proxy variables would only stop
        // the servers that play by the rules.
        policy.network.enabled = true;
        if matches!(trust, McpTrustLevel::Unknown) {
            // Unknown MCPs may inspect the selected workspace, but any change
            // remains an explicit user decision. Trust never enables network,
            // credentials, or arbitrary child processes.
            policy
                .tool_permissions
                .insert("filesystem.write".into(), AccessDecision::Ask);
            policy
                .tool_permissions
                .insert("filesystem.delete".into(), AccessDecision::Ask);
            policy
                .tool_permissions
                .insert("shell.exec".into(), AccessDecision::Ask);
        }
        policy
    }

    pub fn tool_decision(&self, tool: &str, fallback: AccessDecision) -> AccessDecision {
        self.tool_permissions.get(tool).copied().unwrap_or(fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_server_still_gets_network_but_asks_before_acting() {
        let policy = SandboxPolicy::for_mcp(McpTrustLevel::Unknown);
        assert!(policy.network.enabled, "MCP servers need outbound calls to be useful");
        assert_eq!(
            policy.tool_decision("shell.exec", AccessDecision::Allow),
            AccessDecision::Ask
        );
        // A trusted server carries no tool overrides, so `Allow` stands.
        let trusted = SandboxPolicy::for_mcp(McpTrustLevel::Trusted);
        assert_eq!(
            trusted.tool_decision("shell.exec", AccessDecision::Allow),
            AccessDecision::Allow
        );
    }
}
