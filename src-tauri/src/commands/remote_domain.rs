//! The mobile remote on the user's own domain, so the phone gets a trusted
//! certificate and no warning.
//!
//! A name like `mali.example.com` gets an A record (DNS only, never proxied)
//! pointing at this computer's address on the LAN or the tailnet, and a Let's
//! Encrypt certificate proven with a DNS-01 challenge. Both go through the
//! user's Cloudflare API token. Nothing is opened to the internet: the phone
//! looks the name up and then talks to this computer directly.
//!
//! The token lives in the app's vault (the window hands it over); this side
//! only keeps it in memory.
//!
//! Without a domain of their own, an install can use a name from Mali DNS
//! (`services/mali-dns`, a Cloudflare Worker): it gets `<id>.<base>` and may
//! change only that name, only to a private address. The certificate's key is
//! still made here and never leaves this computer.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use instant_acme::{
    Account, AccountCredentials, AuthorizationStatus, ChallengeType, Identifier, LetsEncrypt, NewAccount, NewOrder,
    OrderStatus, RetryPolicy,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CLOUDFLARE_API: &str = "https://api.cloudflare.com/client/v4";
/// Short, so a new address reaches the phone quickly.
const RECORD_TTL: u32 = 60;
/// Renew when the certificate has less than this left.
pub const RENEW_BEFORE_SECS: i64 = 30 * 24 * 3600;
/// Let's Encrypt checks the TXT record against Cloudflare's own servers, which
/// see it within seconds; this is only how long we wait to see it ourselves.
const TXT_WAIT: Duration = Duration::from_secs(90);

/// What is remembered about the domain (in `mobile-remote.json`, owner-only).
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct DomainSaved {
    pub hostname: String,
    /// `cloudflare` (the user's own domain and token) or `mali` (a Mali DNS name).
    #[serde(default = "own_domain")]
    pub provider: String,
    #[serde(default)]
    pub zone_id: String,
    /// The A record Mali made, so it can update and remove it.
    #[serde(default)]
    pub record_id: Option<String>,
    /// `lan` or `tailscale`: which of this computer's addresses the name points at.
    pub point_to: String,
    /// The address the record points at now.
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub cert_pem: Option<String>,
    #[serde(default)]
    pub key_pem: Option<String>,
    /// When the certificate expires, in Unix seconds.
    #[serde(default)]
    pub not_after: Option<i64>,
    /// The Let's Encrypt account, reused for renewals.
    #[serde(default)]
    pub acme_account: Option<Value>,
    /// Mali DNS: this install's id and secret.
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub device_secret: Option<String>,
}

fn own_domain() -> String {
    "cloudflare".into()
}

/// Where Mali DNS runs, set when Mali is built (`MALI_DNS_SERVICE`, see
/// services/mali-dns/README.md) or, for development, in the environment.
/// Without one the option isn't offered.
pub fn mali_service() -> Option<String> {
    let url = std::env::var("MALI_DNS_SERVICE").ok().or_else(|| option_env!("MALI_DNS_SERVICE").map(str::to_string))?;
    let url = url.trim().trim_end_matches('/').to_string();
    url.starts_with("https://").then_some(url)
}

pub fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// A host name Mali can get a certificate for: lowercase labels, at least two,
/// no wildcard, nothing that isn't a DNS name.
pub fn normalize_hostname(raw: &str) -> Result<String, String> {
    let host = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = host
        .strip_prefix("https://")
        .or_else(|| host.strip_prefix("http://"))
        .unwrap_or(&host)
        .split(['/', ':'])
        .next()
        .unwrap_or("")
        .to_string();
    let labels: Vec<&str> = host.split('.').collect();
    let label_ok = |l: &&str| {
        !l.is_empty()
            && l.len() <= 63
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    if host.len() > 253 || labels.len() < 2 || !labels.iter().all(label_ok) {
        return Err(format!("“{raw}” isn't a domain name Mali can use. Try something like mali.example.com."));
    }
    if labels.last().is_some_and(|tld| tld.chars().all(|c| c.is_ascii_digit())) {
        return Err("Use a name, not an IP address.".into());
    }
    Ok(host)
}

/// `a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`: where its zone may start.
pub fn zone_candidates(host: &str) -> Vec<String> {
    let labels: Vec<&str> = host.split('.').collect();
    (0..labels.len().saturating_sub(1)).map(|i| labels[i..].join(".")).collect()
}

// ── Cloudflare ──

pub struct Cloudflare {
    token: String,
    http: reqwest::Client,
}

impl Cloudflare {
    pub fn new(token: &str) -> Result<Self, String> {
        let token = token.trim();
        if token.is_empty() || token.len() > 400 || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("That doesn't look like a Cloudflare API token.".into());
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { token: token.to_string(), http })
    }

    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let mut request = self.http.request(method, format!("{CLOUDFLARE_API}{path}")).bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|e| format!("Couldn't reach Cloudflare: {e}"))?;
        let status = response.status();
        let value: Value = response.json().await.map_err(|e| format!("Cloudflare answered oddly ({status}): {e}"))?;
        if value.get("success").and_then(Value::as_bool) == Some(true) {
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
        let message = value
            .pointer("/errors/0/message")
            .and_then(Value::as_str)
            .unwrap_or("request refused")
            .to_string();
        Err(match status.as_u16() {
            401 | 403 => format!("Cloudflare refused the token ({message}). It needs Zone → DNS → Edit for this domain."),
            _ => format!("Cloudflare: {message}"),
        })
    }

    pub async fn verify(&self) -> Result<(), String> {
        let result = self.call(reqwest::Method::GET, "/user/tokens/verify", None).await?;
        match result.get("status").and_then(Value::as_str) {
            Some("active") => Ok(()),
            other => Err(format!("This Cloudflare token isn't active ({}).", other.unwrap_or("unknown"))),
        }
    }

    /// The zone the host belongs to: the longest suffix Cloudflare has.
    pub async fn zone_for(&self, host: &str) -> Result<String, String> {
        for name in zone_candidates(host) {
            let result = self.call(reqwest::Method::GET, &format!("/zones?name={name}"), None).await?;
            if let Some(id) = result.pointer("/0/id").and_then(Value::as_str) {
                return Ok(id.to_string());
            }
        }
        Err(format!(
            "No Cloudflare zone for {host} is visible to this token. Check the domain is on this Cloudflare account and the token covers it."
        ))
    }

    /// Create or update a record of this type and name; returns its id.
    pub async fn upsert(&self, zone: &str, kind: &str, name: &str, content: &str) -> Result<String, String> {
        let found = self
            .call(reqwest::Method::GET, &format!("/zones/{zone}/dns_records?type={kind}&name={name}"), None)
            .await?;
        // DNS only: a proxied record would send the phone through Cloudflare.
        let body = json!({ "type": kind, "name": name, "content": content, "ttl": RECORD_TTL, "proxied": false });
        let result = match found.pointer("/0/id").and_then(Value::as_str) {
            Some(id) => self.call(reqwest::Method::PUT, &format!("/zones/{zone}/dns_records/{id}"), Some(body)).await?,
            None => self.call(reqwest::Method::POST, &format!("/zones/{zone}/dns_records"), Some(body)).await?,
        };
        result
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Cloudflare didn't return the record.".into())
    }

    async fn add(&self, zone: &str, kind: &str, name: &str, content: &str) -> Result<String, String> {
        let body = json!({ "type": kind, "name": name, "content": content, "ttl": RECORD_TTL });
        let result = self.call(reqwest::Method::POST, &format!("/zones/{zone}/dns_records"), Some(body)).await?;
        result
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "Cloudflare didn't return the record.".into())
    }

    pub async fn delete(&self, zone: &str, id: &str) -> Result<(), String> {
        self.call(reqwest::Method::DELETE, &format!("/zones/{zone}/dns_records/{id}"), None).await.map(|_| ())
    }
}

/// Wait until the TXT value is visible (Cloudflare's resolver reads its own
/// zones directly, so this is quick).
async fn wait_for_txt(http: &reqwest::Client, name: &str, value: &str) {
    let deadline = tokio::time::Instant::now() + TXT_WAIT;
    while tokio::time::Instant::now() < deadline {
        let seen = http
            .get("https://cloudflare-dns.com/dns-query")
            .query(&[("name", name), ("type", "TXT")])
            .header("accept", "application/dns-json")
            .send()
            .await
            .ok();
        if let Some(response) = seen {
            if let Ok(body) = response.json::<Value>().await {
                let found = body
                    .get("Answer")
                    .and_then(Value::as_array)
                    .is_some_and(|answers| answers.iter().any(|a| a.get("data").and_then(Value::as_str).is_some_and(|d| d.contains(value))));
                if found {
                    return;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

// ── Mali DNS ──

pub struct Registered {
    pub id: String,
    pub secret: String,
    pub hostname: String,
}

pub struct MaliDns {
    url: String,
    http: reqwest::Client,
}

impl MaliDns {
    pub fn new(url: &str) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { url: url.to_string(), http })
    }

    async fn call(&self, method: reqwest::Method, path: &str, auth: Option<(&str, &str)>, body: Option<Value>) -> Result<Value, String> {
        let mut request = self.http.request(method, format!("{}{path}", self.url));
        if let Some((id, secret)) = auth {
            request = request.bearer_auth(format!("{id}.{secret}"));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|e| format!("Couldn't reach Mali DNS: {e}"))?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(value);
        }
        let message = value.get("error").and_then(Value::as_str).unwrap_or("request refused");
        Err(format!("Mali DNS: {message} ({status})"))
    }

    pub async fn register(&self) -> Result<Registered, String> {
        let value = self.call(reqwest::Method::POST, "/v1/register", None, None).await?;
        let field = |k: &str| value.get(k).and_then(Value::as_str).map(str::to_string);
        match (field("id"), field("secret"), field("hostname")) {
            (Some(id), Some(secret), Some(hostname)) => Ok(Registered { id, secret, hostname: normalize_hostname(&hostname)? }),
            _ => Err("Mali DNS answered oddly.".into()),
        }
    }

    pub async fn set_address(&self, id: &str, secret: &str, ip: &str) -> Result<(), String> {
        self.call(reqwest::Method::POST, "/v1/address", Some((id, secret)), Some(json!({ "ip": ip }))).await.map(|_| ())
    }

    pub async fn add_challenge(&self, id: &str, secret: &str, value: &str) -> Result<(), String> {
        self.call(reqwest::Method::POST, "/v1/challenge", Some((id, secret)), Some(json!({ "value": value }))).await.map(|_| ())
    }

    pub async fn clear_challenges(&self, id: &str, secret: &str) -> Result<(), String> {
        self.call(reqwest::Method::DELETE, "/v1/challenge", Some((id, secret)), None).await.map(|_| ())
    }

    pub async fn forget(&self, id: &str, secret: &str) -> Result<(), String> {
        self.call(reqwest::Method::DELETE, "/v1/device", Some((id, secret)), None).await.map(|_| ())
    }
}

/// Who changes the DNS for a certificate: the user's own Cloudflare zone, or Mali DNS.
pub enum Dns {
    Cloudflare { cf: Cloudflare, zone: String },
    Mali { service: MaliDns, id: String, secret: String },
}

impl Dns {
    /// Mali DNS for this domain, or Cloudflare with the user's token.
    pub fn for_domain(domain: &DomainSaved, token: Option<&str>) -> Result<Self, String> {
        if domain.provider == "mali" {
            let url = mali_service().ok_or("Mali DNS isn't available in this build.")?;
            let (Some(id), Some(secret)) = (domain.device_id.clone(), domain.device_secret.clone()) else {
                return Err("This computer isn't registered with Mali DNS.".into());
            };
            return Ok(Dns::Mali { service: MaliDns::new(&url)?, id, secret });
        }
        let token = token.ok_or("The Cloudflare token is missing.")?;
        Ok(Dns::Cloudflare { cf: Cloudflare::new(token)?, zone: domain.zone_id.clone() })
    }

    fn http(&self) -> &reqwest::Client {
        match self {
            Dns::Cloudflare { cf, .. } => &cf.http,
            Dns::Mali { service, .. } => &service.http,
        }
    }

    /// Point the name at `ip`; returns the record id where the user's zone keeps one.
    pub async fn set_address(&self, host: &str, ip: &str) -> Result<Option<String>, String> {
        match self {
            Dns::Cloudflare { cf, zone } => cf.upsert(zone, "A", host, ip).await.map(Some),
            Dns::Mali { service, id, secret } => service.set_address(id, secret, ip).await.map(|_| None),
        }
    }

    async fn add_challenge(&self, host: &str, value: &str) -> Result<Option<String>, String> {
        match self {
            Dns::Cloudflare { cf, zone } => cf.add(zone, "TXT", &format!("_acme-challenge.{host}"), value).await.map(Some),
            Dns::Mali { service, id, secret } => service.add_challenge(id, secret, value).await.map(|_| None),
        }
    }

    async fn clear_challenges(&self, added: &[String]) {
        match self {
            Dns::Cloudflare { cf, zone } => {
                for id in added {
                    let _ = cf.delete(zone, id).await;
                }
            }
            Dns::Mali { service, id, secret } => {
                let _ = service.clear_challenges(id, secret).await;
            }
        }
    }
}

// ── certificate ──

pub struct Issued {
    pub cert_pem: String,
    pub key_pem: String,
    pub not_after: i64,
    pub account: Value,
}

fn acme_directory() -> &'static str {
    // Development can point at the staging CA, which has generous rate limits.
    if std::env::var("MALI_ACME_STAGING").is_ok_and(|v| v == "1") {
        LetsEncrypt::Staging.url()
    } else {
        LetsEncrypt::Production.url()
    }
}

/// Get a certificate for `host` with a DNS-01 challenge on Cloudflare. The
/// TXT records it adds are removed again, whether or not it worked.
pub async fn issue(dns: &Dns, host: &str, account: Option<Value>) -> Result<Issued, String> {
    // The ACME client builds its TLS config with rustls' process default, which
    // can't be inferred here (both backends are compiled in). `run` sets it;
    // this makes sure, and is a no-op once set.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let acme_err = |e: instant_acme::Error| format!("Let's Encrypt: {e}");
    let (account, credentials) = match account.and_then(|v| serde_json::from_value::<AccountCredentials>(v).ok()) {
        Some(credentials) => {
            let json = serde_json::to_value(&credentials).map_err(|e| e.to_string())?;
            let account = Account::builder().map_err(acme_err)?.from_credentials(credentials).await.map_err(acme_err)?;
            (account, json)
        }
        None => {
            let (account, credentials) = Account::builder()
                .map_err(acme_err)?
                .create(
                    &NewAccount { contact: &[], terms_of_service_agreed: true, only_return_existing: false },
                    acme_directory().to_owned(),
                    None,
                )
                .await
                .map_err(acme_err)?;
            (account, serde_json::to_value(&credentials).map_err(|e| e.to_string())?)
        }
    };

    let identifiers = [Identifier::Dns(host.to_string())];
    let mut order = account.new_order(&NewOrder::new(&identifiers)).await.map_err(acme_err)?;
    let mut added = Vec::new();
    let outcome = async {
        {
            let mut authorizations = order.authorizations();
            while let Some(next) = authorizations.next().await {
                let mut authz = next.map_err(acme_err)?;
                match authz.status {
                    AuthorizationStatus::Pending => {}
                    AuthorizationStatus::Valid => continue,
                    other => return Err(format!("Let's Encrypt can't check {host} ({other:?}).")),
                }
                let mut challenge = authz
                    .challenge(ChallengeType::Dns01)
                    .ok_or_else(|| "Let's Encrypt offered no DNS check.".to_string())?;
                let value = challenge.key_authorization().dns_value();
                let name = format!("_acme-challenge.{host}");
                added.extend(dns.add_challenge(host, &value).await?);
                wait_for_txt(dns.http(), &name, &value).await;
                challenge.set_ready().await.map_err(acme_err)?;
            }
        }
        let retries = RetryPolicy::new().timeout(Duration::from_secs(120));
        let status = order.poll_ready(&retries).await.map_err(acme_err)?;
        if status != OrderStatus::Ready {
            return Err(format!("Let's Encrypt couldn't confirm {host} ({status:?}). Check the token can edit its DNS."));
        }
        let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
        let mut params = rcgen::CertificateParams::new(vec![host.to_string()]).map_err(|e| e.to_string())?;
        // rcgen's default subject ("rcgen self signed cert") isn't a name Let's
        // Encrypt will sign: the request names only the host.
        params.distinguished_name = rcgen::DistinguishedName::new();
        params.distinguished_name.push(rcgen::DnType::CommonName, host);
        let csr = params.serialize_request(&key).map_err(|e| e.to_string())?;
        order.finalize_csr(csr.der()).await.map_err(acme_err)?;
        let chain = order.poll_certificate(&retries).await.map_err(acme_err)?;
        Ok((chain, key.serialize_pem()))
    }
    .await;
    dns.clear_challenges(&added).await;
    let (cert_pem, key_pem) = outcome?;
    let not_after = not_after(&cert_pem).ok_or("The certificate couldn't be read.")?;
    Ok(Issued { cert_pem, key_pem, not_after, account: credentials })
}

/// When the first certificate in a PEM chain expires (Unix seconds).
pub fn not_after(pem: &str) -> Option<i64> {
    let (_, block) = x509_parser::pem::parse_x509_pem(pem.as_bytes()).ok()?;
    let cert = block.parse_x509().ok()?;
    Some(cert.validity().not_after.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_host_names_only() {
        assert_eq!(normalize_hostname(" Mali.Example.com. ").unwrap(), "mali.example.com");
        assert_eq!(normalize_hostname("https://mali.example.co.th:47913/").unwrap(), "mali.example.co.th");
        for bad in ["localhost", "*.example.com", "192.168.1.5", "-a.example.com", "a..example.com", "ex ample.com", ""] {
            assert!(normalize_hostname(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn lists_zone_candidates_longest_first() {
        assert_eq!(zone_candidates("mali.example.co.th"), ["mali.example.co.th", "example.co.th", "co.th"]);
        assert_eq!(zone_candidates("example.com"), ["example.com"]);
    }

    #[test]
    fn reads_certificate_expiry() {
        let cert = rcgen::generate_simple_self_signed(vec!["mali.example.com".into()]).unwrap();
        let expires = not_after(&cert.cert.pem()).unwrap();
        assert!(expires > now_secs());
    }

    #[test]
    fn mali_service_must_be_https() {
        std::env::set_var("MALI_DNS_SERVICE", "http://insecure.example");
        assert_eq!(mali_service(), None);
        std::env::set_var("MALI_DNS_SERVICE", "https://mali-dns.example.workers.dev/");
        assert_eq!(mali_service().as_deref(), Some("https://mali-dns.example.workers.dev"));
        std::env::remove_var("MALI_DNS_SERVICE");
    }

    /// Against a running Mali DNS (the real Worker, e.g. under `bun`):
    /// MALI_DNS_TEST_URL=http://127.0.0.1:47998 cargo test --lib talks_to_mali_dns -- --ignored
    #[tokio::test]
    #[ignore]
    async fn talks_to_mali_dns() {
        let url = std::env::var("MALI_DNS_TEST_URL").expect("MALI_DNS_TEST_URL");
        let service = MaliDns::new(&url).unwrap();
        let me = service.register().await.unwrap();
        assert!(me.hostname.starts_with(&me.id));
        service.set_address(&me.id, &me.secret, "192.168.1.23").await.unwrap();
        let refused = service.set_address(&me.id, &me.secret, "8.8.8.8").await.unwrap_err();
        assert!(refused.contains("400"), "{refused}");
        let wrong = service.set_address(&me.id, &"0".repeat(64), "192.168.1.23").await.unwrap_err();
        assert!(wrong.contains("401"), "{wrong}");
        service.add_challenge(&me.id, &me.secret, &"a".repeat(43)).await.unwrap();
        service.clear_challenges(&me.id, &me.secret).await.unwrap();
        service.forget(&me.id, &me.secret).await.unwrap();
        let gone = service.set_address(&me.id, &me.secret, "192.168.1.23").await.unwrap_err();
        assert!(gone.contains("401"), "{gone}");
    }

    /// A whole certificate through Mali DNS, from Let's Encrypt's staging CA:
    /// MALI_ACME_STAGING=1 MALI_DNS_TEST_URL=https://… cargo test --lib issues_through_mali_dns -- --ignored
    #[tokio::test]
    #[ignore]
    async fn issues_through_mali_dns() {
        assert_eq!(std::env::var("MALI_ACME_STAGING").as_deref(), Ok("1"), "use the staging CA");
        let url = std::env::var("MALI_DNS_TEST_URL").expect("MALI_DNS_TEST_URL");
        let service = MaliDns::new(&url).unwrap();
        let me = service.register().await.unwrap();
        service.set_address(&me.id, &me.secret, "192.168.1.23").await.unwrap();
        let dns = Dns::Mali { service: MaliDns::new(&url).unwrap(), id: me.id.clone(), secret: me.secret.clone() };
        let issued = issue(&dns, &me.hostname, None).await;
        service.forget(&me.id, &me.secret).await.unwrap();
        let issued = issued.unwrap();
        assert!(issued.not_after > now_secs() + 30 * 24 * 3600);
        assert!(issued.cert_pem.contains("BEGIN CERTIFICATE"));
    }

    #[test]
    fn refuses_odd_tokens() {
        assert!(Cloudflare::new("").is_err());
        assert!(Cloudflare::new("has space").is_err());
        assert!(Cloudflare::new("abcDEF123_-xyz").is_ok());
    }
}
