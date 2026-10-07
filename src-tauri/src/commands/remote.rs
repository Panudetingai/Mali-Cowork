//! Mobile remote: a small web app the phone opens over the LAN (or
//! Tailscale), to follow runs, Allow / Deny, Stop, and chat with a model.
//!
//! It is off until the user turns it on in Settings → Mobile. Every request
//! that carries data needs the pairing token (in the QR code); the page
//! itself carries none. Only peers on private networks are answered:
//! loopback, LAN ranges, link-local and Tailscale's 100.64/10.
//!
//! The main window owns the chats and runs, so this side only relays: the
//! window publishes a summary (`remote_publish`) that open phones receive
//! as a stream, and a phone's command goes to the window as
//! `remote:command`, whose answer comes back through `remote_reply`.

use std::collections::HashMap;
use std::io::Cursor;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use rustls::ServerConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, watch};
use tokio_rustls::TlsAcceptor;

use super::remote_domain::{self, Cloudflare, DomainSaved, Dns, MaliDns};
use super::secure_fs::write_private;

const DEFAULT_PORT: u16 = 47913;
const MAIN_LABEL: &str = "main";
const COMMAND_EVENT: &str = "remote:command";
const CLIENTS_EVENT: &str = "remote:clients";
const PENDING_IP_EVENT: &str = "remote:pending_ip";
const IP_ALLOWED_EVENT: &str = "remote:ip_allowed";
/// The domain's certificate job started or finished.
const DOMAIN_EVENT: &str = "remote:domain";

const PAGE: &str = include_str!("remote_page.html");
const TOUCH_ICON: &[u8] = include_bytes!("../../icons/ios/AppIcon-60x60@3x.png");
const ICON_512: &[u8] = include_bytes!("../../icons/ios/AppIcon-512@2x.png");
/// QR decoding for the phone's "scan to pair" (jsQR, Apache-2.0); loaded only when scanning.
const JSQR: &str = include_str!("remote_jsqr.js");

const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 256 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// Long enough for the window to start a turn; not for the turn itself.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(25);
/// Keeps the stream open through proxies and tells a gone phone apart.
const PING_EVERY: Duration = Duration::from_secs(15);
/// Wrong tokens allowed per minute before every request is turned away for the rest of it.
const MAX_FAILURES: u32 = 20;

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    token: String,
    port: u16,
    /// When on, only these IPs may call the API (pairing page still loads on private nets).
    #[serde(default)]
    allowed_ips: Vec<String>,
    #[serde(default)]
    ip_allowlist_enabled: bool,
    #[serde(default = "default_auto_allow_new_ips")]
    auto_allow_new_ips: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tls_cert_pem: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tls_key_pem: Option<String>,
    /// The user's own domain, with its trusted certificate (see `remote_domain`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    domain: Option<DomainSaved>,
    /// The user turned the free Mali DNS name off.
    #[serde(default)]
    mali_domain_off: bool,
    /// What kind of device each phone address is ("iPhone", "Android phone"),
    /// so Settings can name it instead of showing only a number.
    #[serde(default)]
    device_labels: HashMap<String, String>,
}

fn default_auto_allow_new_ips() -> bool {
    true
}

struct Hub {
    app: AppHandle,
    saved: Mutex<Saved>,
    /// The latest summary the window published, as JSON.
    state: watch::Sender<Arc<str>>,
    /// Bumped when the token changes or the server stops: open streams end.
    epoch: watch::Sender<u64>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    /// Phones waiting for an IP allow in Settings.
    pending_ips: Mutex<Vec<String>>,
    clients: AtomicUsize,
    server: Mutex<Option<Server>>,
    failures: Mutex<(Instant, u32)>,
    /// The certificates the running server picks from; swapped on renewal.
    certs: Mutex<Option<Arc<Certs>>>,
    domain: Mutex<DomainRuntime>,
}

/// The domain's in-memory state: its Cloudflare token (from the vault), and
/// what the last certificate or DNS job did.
#[derive(Default)]
struct DomainRuntime {
    token: Option<String>,
    busy: bool,
    error: Option<String>,
    /// Don't retry a failed certificate before this (Unix seconds).
    retry_after: i64,
    looping: bool,
    registering: bool,
    /// Last time Mali DNS heard from this install (it forgets silent ones).
    pinged_at: i64,
}

struct Server {
    port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

static HUB: OnceLock<Hub> = OnceLock::new();

fn hub(app: &AppHandle) -> &'static Hub {
    HUB.get_or_init(|| Hub {
        app: app.clone(),
        saved: Mutex::new(load_saved()),
        state: watch::channel(Arc::from("null")).0,
        epoch: watch::channel(0).0,
        pending: Mutex::new(HashMap::new()),
        pending_ips: Mutex::new(Vec::new()),
        clients: AtomicUsize::new(0),
        server: Mutex::new(None),
        failures: Mutex::new((Instant::now(), 0)),
        certs: Mutex::new(None),
        domain: Mutex::new(DomainRuntime::default()),
    })
}

fn saved_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mobile-remote.json")
}

fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// The pairing survives restarts, so a phone's home-screen app keeps working.
fn load_saved() -> Saved {
    let read = std::fs::read_to_string(saved_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<Saved>(&raw).ok())
        .filter(|s| s.token.len() >= 32 && s.port > 0);
    read.unwrap_or_else(|| {
        // A fresh pairing is locked down: a phone with the QR code still has
        // to be approved here before it sees anything.
        let saved = Saved {
            token: new_token(),
            port: DEFAULT_PORT,
            allowed_ips: Vec::new(),
            ip_allowlist_enabled: true,
            auto_allow_new_ips: false,
            tls_cert_pem: None,
            tls_key_pem: None,
            domain: None,
            mali_domain_off: false,
            device_labels: HashMap::new(),
        };
        store_saved(&saved);
        saved
    })
}

fn ensure_tls_material(saved: &mut Saved) -> Result<(), String> {
    if saved.tls_cert_pem.is_some() && saved.tls_key_pem.is_some() {
        return Ok(());
    }
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".into(), "mali.local".into()])
        .map_err(|e| format!("Couldn't create HTTPS certificate: {e}"))?;
    saved.tls_cert_pem = Some(cert.cert.pem().into());
    saved.tls_key_pem = Some(cert.key_pair.serialize_pem());
    store_saved(saved);
    Ok(())
}

fn certified_key(cert_pem: &str, key_pem: &str) -> Result<Arc<CertifiedKey>, String> {
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut Cursor::new(cert_pem))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Bad certificate: {e}"))?;
    if certs.is_empty() {
        return Err("Certificate missing".into());
    }
    let key: PrivateKeyDer<'static> = rustls_pemfile::private_key(&mut Cursor::new(key_pem))
        .map_err(|e| format!("Bad private key: {e}"))?
        .ok_or("Private key missing")?;
    let signer =
        rustls::crypto::aws_lc_rs::sign::any_supported_type(&key).map_err(|e| format!("Unsupported private key: {e}"))?;
    Ok(Arc::new(CertifiedKey::new(certs, signer)))
}

/// Mali's own certificate for addresses, and the trusted one for the user's
/// domain when the phone asks for it by name (browsers send no name for an IP).
#[derive(Debug)]
struct Certs {
    fallback: Arc<CertifiedKey>,
    domain: std::sync::RwLock<Option<(String, Arc<CertifiedKey>)>>,
}

impl Certs {
    fn set_domain(&self, saved: Option<&DomainSaved>) {
        let next = saved.and_then(|d| {
            let key = certified_key(d.cert_pem.as_deref()?, d.key_pem.as_deref()?).ok()?;
            Some((d.hostname.clone(), key))
        });
        *self.domain.write().unwrap_or_else(PoisonError::into_inner) = next;
    }
}

impl ResolvesServerCert for Certs {
    fn resolve(&self, hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        if let Some(name) = hello.server_name() {
            if let Some((host, key)) = &*self.domain.read().unwrap_or_else(PoisonError::into_inner) {
                if name.eq_ignore_ascii_case(host) {
                    return Some(key.clone());
                }
            }
        }
        Some(self.fallback.clone())
    }
}

fn tls_config(saved: &Saved) -> Result<(Arc<ServerConfig>, Arc<Certs>), String> {
    let cert_pem = saved.tls_cert_pem.as_deref().ok_or("HTTPS certificate missing")?;
    let key_pem = saved.tls_key_pem.as_deref().ok_or("HTTPS key missing")?;
    let certs = Arc::new(Certs { fallback: certified_key(cert_pem, key_pem)?, domain: Default::default() });
    certs.set_domain(saved.domain.as_ref());
    // Both of rustls' crypto backends end up compiled in (other crates turn
    // on `ring`), so it can't pick one by itself and panics: name it.
    let config = ServerConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("HTTPS setup failed: {e}"))?
        .with_no_client_auth()
        .with_cert_resolver(certs.clone());
    Ok((Arc::new(config), certs))
}

fn ip_allowed(hub: &Hub, ip: IpAddr) -> bool {
    let saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
    if !saved.ip_allowlist_enabled {
        return true;
    }
    let needle = ip.to_string();
    saved.allowed_ips.iter().any(|x| x == &needle)
}

fn allow_ip(hub: &Hub, ip: IpAddr) {
    let needle = ip.to_string();
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        if !saved.allowed_ips.iter().any(|x| x == &needle) {
            saved.allowed_ips.push(needle.clone());
            store_saved(&saved);
        }
    }
    hub.pending_ips.lock().unwrap_or_else(PoisonError::into_inner).retain(|x| x != &needle);
    let _ = hub.app.emit_to(MAIN_LABEL, IP_ALLOWED_EVENT, needle);
}

/// A plain name for the device, from its browser's user agent.
fn device_label(user_agent: &str) -> &'static str {
    if user_agent.contains("iPhone") {
        "iPhone"
    } else if user_agent.contains("iPad") {
        "iPad"
    } else if user_agent.contains("Android") {
        if user_agent.contains("Mobile") { "Android phone" } else { "Android tablet" }
    } else if user_agent.contains("Macintosh") {
        // iPads ask for desktop sites with a Mac's user agent.
        "iPad or Mac"
    } else if user_agent.contains("Windows") {
        "Windows PC"
    } else {
        "Device"
    }
}

fn remember_label(hub: &Hub, ip: IpAddr, user_agent: Option<&str>) {
    let Some(ua) = user_agent else { return };
    let label = device_label(ua).to_string();
    let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
    if saved.device_labels.get(&ip.to_string()) != Some(&label) {
        saved.device_labels.insert(ip.to_string(), label);
        store_saved(&saved);
    }
}

fn note_pending_ip(hub: &Hub, ip: IpAddr) {
    let needle = ip.to_string();
    let mut pending = hub.pending_ips.lock().unwrap_or_else(PoisonError::into_inner);
    if pending.iter().any(|x| x == &needle) {
        return;
    }
    pending.push(needle.clone());
    let _ = hub.app.emit_to(MAIN_LABEL, PENDING_IP_EVENT, needle);
}

/// After a valid token: honour the IP list, optionally trust this phone once.
fn gate_authenticated(hub: &Hub, ip: IpAddr, user_agent: Option<&str>) -> Option<&'static str> {
    if ip_allowed(hub, ip) {
        return None;
    }
    remember_label(hub, ip, user_agent);
    let auto = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).auto_allow_new_ips;
    if auto {
        allow_ip(hub, ip);
        return None;
    }
    note_pending_ip(hub, ip);
    Some("403 Forbidden")
}

fn store_saved(saved: &Saved) {
    if let Ok(json) = serde_json::to_string_pretty(saved) {
        if let Err(e) = write_private(&saved_path(), &json) {
            eprintln!("[remote] couldn't save pairing: {e}");
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAddress {
    /// `lan` or `tailscale`.
    kind: &'static str,
    ip: String,
    /// Opens the remote, already paired (the token rides in the fragment).
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    running: bool,
    port: u16,
    https: bool,
    addresses: Vec<RemoteAddress>,
    /// Phones with the remote open now.
    clients: usize,
    ip_allowlist_enabled: bool,
    auto_allow_new_ips: bool,
    allowed_ips: Vec<String>,
    pending_ips: Vec<String>,
    device_labels: HashMap<String, String>,
    /// SHA-256 of the HTTPS certificate, to check against what the phone shows.
    cert_fingerprint: Option<String>,
    domain: Option<DomainStatus>,
    /// This build can give a name from Mali DNS.
    mali_available: bool,
    mali_domain_off: bool,
    /// Getting a Mali DNS name failed (before there is a domain to report it on).
    domain_error: Option<String>,
    /// A Mali DNS name is being set up now.
    domain_registering: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainStatus {
    hostname: String,
    /// `cloudflare` (the user's own domain) or `mali` (a Mali DNS name).
    provider: String,
    point_to: String,
    ip: Option<String>,
    /// `working`, `ready`, `error`, or `needsToken` (the vault hasn't handed it over).
    state: &'static str,
    error: Option<String>,
    /// When the certificate expires (Unix ms).
    expires_at: Option<i64>,
}


/// The certificate's SHA-256, as browsers show it (AB:CD:…).
fn fingerprint(cert_pem: &str) -> Option<String> {
    use sha2::{Digest, Sha256};
    let der = rustls_pemfile::certs(&mut Cursor::new(cert_pem)).next()?.ok()?;
    let digest = Sha256::digest(der.as_ref());
    Some(digest.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":"))
}

fn status(hub: &Hub) -> RemoteStatus {
    let saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).clone();
    let running = hub.server.lock().unwrap_or_else(PoisonError::into_inner).as_ref().map(|s| s.port);
    let port = running.unwrap_or(saved.port);
    let mut addresses: Vec<RemoteAddress> = local_addresses()
        .into_iter()
        .map(|(kind, ip)| RemoteAddress {
            kind,
            url: format!("https://{ip}:{port}/#t={}", saved.token),
            ip: ip.to_string(),
        })
        .collect();
    let runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
    let domain = saved.domain.as_ref().map(|d| {
        let valid = d.cert_pem.is_some() && d.not_after.is_some_and(|t| t > remote_domain::now_secs());
        let state = if runtime.busy {
            "working"
        } else if runtime.error.is_some() {
            "error"
        } else if valid {
            "ready"
        } else if d.provider != "mali" && runtime.token.is_none() {
            "needsToken"
        } else {
            "working"
        };
        DomainStatus {
            hostname: d.hostname.clone(),
            provider: d.provider.clone(),
            point_to: d.point_to.clone(),
            ip: d.ip.clone(),
            state,
            error: runtime.error.clone(),
            expires_at: d.not_after.map(|t| t * 1000),
        }
    });
    let domain_error = if saved.domain.is_none() { runtime.error.clone() } else { None };
    let domain_registering = runtime.registering;
    drop(runtime);
    // A valid certificate keeps working while a renewal runs or fails.
    if let Some(d) = domain.as_ref().filter(|d| d.expires_at.is_some_and(|t| t > remote_domain::now_secs() * 1000)) {
        addresses.insert(0, RemoteAddress {
            kind: "domain",
            url: format!("https://{}:{port}/#t={}", d.hostname, saved.token),
            ip: d.hostname.clone(),
        });
    }

    RemoteStatus {
        running: running.is_some(),
        port,
        https: true,
        addresses,
        clients: hub.clients.load(Ordering::Relaxed),
        ip_allowlist_enabled: saved.ip_allowlist_enabled,
        auto_allow_new_ips: saved.auto_allow_new_ips,
        allowed_ips: saved.allowed_ips.clone(),
        device_labels: saved.device_labels.clone(),
        pending_ips: hub.pending_ips.lock().unwrap_or_else(PoisonError::into_inner).clone(),
        cert_fingerprint: saved.tls_cert_pem.as_deref().and_then(fingerprint),
        domain,
        mali_available: remote_domain::mali_service().is_some(),
        mali_domain_off: saved.mali_domain_off,
        domain_error,
        domain_registering,
    }
}

/// The address the default route leaves from, and Tailscale's when it is up.
/// A UDP "connect" only picks a route; nothing is sent.
fn local_addresses() -> Vec<(&'static str, Ipv4Addr)> {
    fn route_to(target: &str) -> Option<Ipv4Addr> {
        let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect(target).ok()?;
        match socket.local_addr().ok()?.ip() {
            IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_loopback() => Some(ip),
            _ => None,
        }
    }
    let mut found = Vec::new();
    if let Some(ip) = route_to("192.0.2.1:9").filter(|ip| !is_tailscale(*ip)) {
        found.push(("lan", ip));
    }
    // Tailscale's own service address only routes through its interface.
    if let Some(ip) = route_to("100.100.100.100:53").filter(|ip| is_tailscale(*ip)) {
        found.push(("tailscale", ip));
    }
    found
}

fn is_tailscale(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 100 && (b & 0xc0) == 64
}

/// Only phones on the same network, or the same tailnet.
fn peer_allowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || is_tailscale(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return peer_allowed(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

// ── commands ──

#[tauri::command]
pub fn remote_status(app: AppHandle) -> RemoteStatus {
    status(hub(&app))
}

#[tauri::command]
pub async fn remote_start(app: AppHandle) -> Result<RemoteStatus, String> {
    let hub = hub(&app);
    if hub.server.lock().unwrap_or_else(PoisonError::into_inner).is_some() {
        return Ok(status(hub));
    }
    // Certificate work runs on a copy, never while holding the lock.
    let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).clone();
    let had_tls = saved.tls_cert_pem.is_some() && saved.tls_key_pem.is_some();
    ensure_tls_material(&mut saved)?;
    let (tls, certs) = tls_config(&saved)?;
    if !had_tls {
        let mut current = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        current.tls_cert_pem = saved.tls_cert_pem.clone();
        current.tls_key_pem = saved.tls_key_pem.clone();
    }
    let port = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).port;
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("Couldn't open port {port} for the mobile remote: {e}"))?;
    let task = tauri::async_runtime::spawn(serve(listener, hub, tls));
    let mut server = hub.server.lock().unwrap_or_else(PoisonError::into_inner);
    if server.is_some() {
        // Started twice at once: keep the first.
        task.abort();
    } else {
        *server = Some(Server { port, task });
        *hub.certs.lock().unwrap_or_else(PoisonError::into_inner) = Some(certs);
    }
    drop(server);
    start_domain_loop(hub);
    maybe_setup_mali(hub);
    Ok(status(hub))
}

#[tauri::command]
pub fn remote_stop(app: AppHandle) -> RemoteStatus {
    let hub = hub(&app);
    if let Some(server) = hub.server.lock().unwrap_or_else(PoisonError::into_inner).take() {
        server.task.abort();
    }
    hub.epoch.send_modify(|e| *e += 1);
    status(hub)
}

/// A new pairing: phones paired before have to scan again.
#[tauri::command]
pub fn remote_reset_token(app: AppHandle) -> RemoteStatus {
    let hub = hub(&app);
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        saved.token = new_token();
        store_saved(&saved);
    }
    hub.epoch.send_modify(|e| *e += 1);
    status(hub)
}

/// The window's summary of chats and runs, for open phones.
#[tauri::command]
pub fn remote_publish(app: AppHandle, state: String) {
    hub(&app).state.send_replace(Arc::from(state));
}

/// The window's answer to a phone's command.
#[tauri::command]
pub fn remote_reply(app: AppHandle, id: String, result: Value) {
    if let Some(tx) = hub(&app).pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id) {
        let _ = tx.send(result);
    }
}

#[tauri::command]
pub fn remote_set_ip_allowlist(app: AppHandle, enabled: bool) -> RemoteStatus {
    let hub = hub(&app);
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        saved.ip_allowlist_enabled = enabled;
        store_saved(&saved);
    }
    status(hub)
}

#[tauri::command]
pub fn remote_set_auto_allow_ips(app: AppHandle, enabled: bool) -> RemoteStatus {
    let hub = hub(&app);
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        saved.auto_allow_new_ips = enabled;
        store_saved(&saved);
    }
    status(hub)
}

#[tauri::command]
pub fn remote_allow_ip(app: AppHandle, ip: String) -> RemoteStatus {
    let hub = hub(&app);
    if let Ok(parsed) = ip.parse::<IpAddr>() {
        allow_ip(hub, parsed);
    }
    status(hub)
}

#[tauri::command]
pub fn remote_revoke_ip(app: AppHandle, ip: String) -> RemoteStatus {
    let hub = hub(&app);
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        saved.allowed_ips.retain(|x| x != &ip);
        saved.device_labels.remove(&ip);
        store_saved(&saved);
    }
    hub.pending_ips.lock().unwrap_or_else(PoisonError::into_inner).retain(|x| x != &ip);
    hub.epoch.send_modify(|e| *e += 1);
    status(hub)
}

#[tauri::command]
pub fn remote_dismiss_pending_ip(app: AppHandle, ip: String) -> RemoteStatus {
    hub(&app).pending_ips.lock().unwrap_or_else(PoisonError::into_inner).retain(|x| x != &ip);
    status(hub(&app))
}

// ── your own domain ──

/// The window hands over the Cloudflare token from the vault (kept in memory only).
#[tauri::command]
pub fn remote_domain_set_token(app: AppHandle, token: Option<String>) -> RemoteStatus {
    let hub = hub(&app);
    {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        runtime.token = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        runtime.retry_after = 0;
    }
    start_domain_loop(hub);
    status(hub)
}

/// Point `hostname` at this computer and get it a certificate. The token and
/// the DNS record are checked now, so mistakes show at once; the certificate
/// follows in the background.
#[tauri::command]
pub async fn remote_domain_setup(
    app: AppHandle,
    hostname: String,
    token: String,
    point_to: String,
) -> Result<RemoteStatus, String> {
    let hub = hub(&app);
    let host = remote_domain::normalize_hostname(&hostname)?;
    let point_to = if point_to == "tailscale" { "tailscale" } else { "lan" }.to_string();
    let ip = address_for(&point_to).ok_or_else(|| {
        if point_to == "tailscale" {
            "Tailscale isn't running on this computer.".to_string()
        } else {
            "This computer isn't on a network.".to_string()
        }
    })?;
    let cf = Cloudflare::new(&token)?;
    cf.verify().await?;
    let zone = cf.zone_for(&host).await?;
    if hub.saved.lock().unwrap_or_else(PoisonError::into_inner).domain.as_ref().is_some_and(|d| d.provider == "mali") {
        drop_domain(hub).await;
    }
    let record_id = cf.upsert(&zone, "A", &host, &ip.to_string()).await?;
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        // The same name again keeps its certificate and Let's Encrypt account.
        let keep = saved.domain.take().filter(|d| d.hostname == host).unwrap_or_default();
        saved.domain = Some(DomainSaved {
            hostname: host,
            provider: "cloudflare".into(),
            zone_id: zone,
            record_id: Some(record_id),
            point_to,
            ip: Some(ip.to_string()),
            ..keep
        });
        store_saved(&saved);
        if let Some(certs) = hub.certs.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
            certs.set_domain(saved.domain.as_ref());
        }
    }
    {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        runtime.token = Some(token.trim().to_string());
        runtime.error = None;
        runtime.retry_after = 0;
    }
    let due = hub
        .saved
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .domain
        .as_ref()
        .is_some_and(|d| d.not_after.is_none_or(|t| t - remote_domain::now_secs() < remote_domain::RENEW_BEFORE_SECS));
    if due {
        spawn_certificate(hub, true);
    }
    start_domain_loop(hub);
    Ok(status(hub))
}

#[tauri::command]
pub fn remote_domain_renew(app: AppHandle) -> RemoteStatus {
    let hub = hub(&app);
    spawn_certificate(hub, true);
    status(hub)
}

/// Stop using the domain; its DNS records go too. A Mali DNS name stays off
/// until turned on again.
#[tauri::command]
pub async fn remote_domain_remove(app: AppHandle) -> Result<RemoteStatus, String> {
    let hub = hub(&app);
    drop_domain(hub).await;
    hub.domain.lock().unwrap_or_else(PoisonError::into_inner).token = None;
    Ok(status(hub))
}

// ── Mali DNS: a name for installs without a domain of their own ──

/// Turn the free Mali DNS name on (register and get its certificate) or off
/// (its name and records are removed from Mali DNS).
#[tauri::command]
pub async fn remote_domain_mali(app: AppHandle, enabled: bool) -> Result<RemoteStatus, String> {
    let hub = hub(&app);
    {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        saved.mali_domain_off = !enabled;
        store_saved(&saved);
    }
    if enabled {
        setup_mali(hub).await?;
    } else if hub.saved.lock().unwrap_or_else(PoisonError::into_inner).domain.as_ref().is_some_and(|d| d.provider == "mali") {
        drop_domain(hub).await;
    }
    Ok(status(hub))
}

/// On by default: a running remote without a domain gets a Mali DNS name.
fn maybe_setup_mali(hub: &'static Hub) {
    let wanted = remote_domain::mali_service().is_some() && {
        let saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        !saved.mali_domain_off && saved.domain.is_none()
    };
    if !wanted {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = setup_mali(hub).await {
            eprintln!("[remote] Mali DNS: {error}");
            hub.domain.lock().unwrap_or_else(PoisonError::into_inner).error = Some(error);
            let _ = hub.app.emit_to(MAIN_LABEL, DOMAIN_EVENT, ());
        }
    });
}

/// Register (once) with Mali DNS, point the name here, and get its certificate.
async fn setup_mali(hub: &'static Hub) -> Result<(), String> {
    {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        if runtime.registering {
            return Ok(());
        }
        runtime.registering = true;
        runtime.error = None;
    }
    let _ = hub.app.emit_to(MAIN_LABEL, DOMAIN_EVENT, ());
    let result = register_mali(hub).await;
    hub.domain.lock().unwrap_or_else(PoisonError::into_inner).registering = false;
    let _ = hub.app.emit_to(MAIN_LABEL, DOMAIN_EVENT, ());
    result?;
    spawn_certificate(hub, false);
    start_domain_loop(hub);
    Ok(())
}

async fn register_mali(hub: &'static Hub) -> Result<(), String> {
    let url = remote_domain::mali_service().ok_or("Mali DNS isn't available in this build.")?;
    let point_to = if address_for("lan").is_some() { "lan" } else { "tailscale" };
    let ip = address_for(point_to).ok_or("This computer isn't on a network.")?.to_string();
    let service = MaliDns::new(&url)?;
    // This install's registration, if it has one.
    let existing = hub
        .saved
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .domain
        .clone()
        .filter(|d| d.provider == "mali");
    let mut creds = existing
        .as_ref()
        .and_then(|d| Some((d.device_id.clone()?, d.device_secret.clone()?, d.hostname.clone())));
    if let Some((id, secret, _)) = &creds {
        if let Err(error) = service.set_address(id, secret, &ip).await {
            // Forgotten by Mali DNS (unused for months): register again.
            if !error.contains("401") {
                return Err(error);
            }
            creds = None;
        }
    }
    let (id, secret, hostname) = match creds {
        Some(creds) => creds,
        None => {
            let registered = service.register().await?;
            service.set_address(&registered.id, &registered.secret, &ip).await?;
            (registered.id, registered.secret, registered.hostname)
        }
    };
    let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
    let keep = existing.filter(|d| d.hostname == hostname).unwrap_or_default();
    saved.domain = Some(DomainSaved {
        hostname,
        provider: "mali".into(),
        point_to: point_to.into(),
        ip: Some(ip),
        device_id: Some(id),
        device_secret: Some(secret),
        ..keep
    });
    store_saved(&saved);
    if let Some(certs) = hub.certs.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
        certs.set_domain(saved.domain.as_ref());
    }
    Ok(())
}

/// Forget the current domain here, and its DNS records where Mali can remove them.
async fn drop_domain(hub: &'static Hub) {
    let domain = {
        let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
        let domain = saved.domain.take();
        if domain.as_ref().is_some_and(|d| d.provider == "mali") {
            saved.mali_domain_off = true;
        }
        store_saved(&saved);
        domain
    };
    if let Some(certs) = hub.certs.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
        certs.set_domain(None);
    }
    let token = {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        runtime.error = None;
        runtime.token.clone()
    };
    let Some(d) = domain else { return };
    match Dns::for_domain(&d, token.as_deref()) {
        Ok(Dns::Mali { service, id, secret }) => {
            let _ = service.forget(&id, &secret).await;
        }
        Ok(Dns::Cloudflare { cf, zone }) => {
            if let Some(id) = d.record_id {
                let _ = cf.delete(&zone, &id).await;
            }
        }
        Err(_) => {}
    }
}

fn address_for(point_to: &str) -> Option<Ipv4Addr> {
    let kind = if point_to == "tailscale" { "tailscale" } else { "lan" };
    local_addresses().into_iter().find(|(k, _)| *k == kind).map(|(_, ip)| ip)
}

/// Get (or renew) the certificate in the background, unless one is on its way.
fn spawn_certificate(hub: &'static Hub, force: bool) {
    let Some(domain) = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).domain.clone() else { return };
    let token = {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        let token = runtime.token.clone();
        if domain.provider != "mali" && token.is_none() {
            return;
        }
        if runtime.busy || (!force && runtime.retry_after > remote_domain::now_secs()) {
            return;
        }
        runtime.busy = true;
        runtime.error = None;
        token
    };
    let _ = hub.app.emit_to(MAIN_LABEL, DOMAIN_EVENT, ());
    tauri::async_runtime::spawn(async move {
        let result = async {
            let dns = Dns::for_domain(&domain, token.as_deref())?;
            remote_domain::issue(&dns, &domain.hostname, domain.acme_account.clone()).await
        }
        .await;
        match result {
            Ok(issued) => {
                {
                    let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
                    if let Some(d) = saved.domain.as_mut().filter(|d| d.hostname == domain.hostname) {
                        d.cert_pem = Some(issued.cert_pem);
                        d.key_pem = Some(issued.key_pem);
                        d.not_after = Some(issued.not_after);
                        d.acme_account = Some(issued.account);
                    }
                    store_saved(&saved);
                    if let Some(certs) = hub.certs.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
                        certs.set_domain(saved.domain.as_ref());
                    }
                }
                let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
                runtime.busy = false;
                runtime.error = None;
            }
            Err(error) => {
                eprintln!("[remote] certificate for {} failed: {error}", domain.hostname);
                let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
                runtime.busy = false;
                runtime.error = Some(error);
                // Let's Encrypt limits failed tries: wait before the next automatic one.
                runtime.retry_after = remote_domain::now_secs() + 6 * 3600;
            }
        }
        let _ = hub.app.emit_to(MAIN_LABEL, DOMAIN_EVENT, ());
    });
}

/// Every few minutes while the remote runs: keep the DNS record on this
/// computer's address, and renew the certificate a month before it expires.
fn start_domain_loop(hub: &'static Hub) {
    {
        let mut runtime = hub.domain.lock().unwrap_or_else(PoisonError::into_inner);
        if runtime.looping {
            return;
        }
        runtime.looping = true;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let running = hub.server.lock().unwrap_or_else(PoisonError::into_inner).is_some();
            let domain = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).domain.clone();
            let token = hub.domain.lock().unwrap_or_else(PoisonError::into_inner).token.clone();
            if let (true, Some(d)) = (running, domain) {
                follow_address(hub, &d, token.as_deref()).await;
                if d.not_after.is_none_or(|t| t - remote_domain::now_secs() < remote_domain::RENEW_BEFORE_SECS) {
                    spawn_certificate(hub, false);
                }
            }
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
}

/// The DNS record follows this computer when its address changes (a new
/// Wi-Fi lease). Mali DNS also hears from it daily, or it forgets the name.
async fn follow_address(hub: &'static Hub, d: &DomainSaved, token: Option<&str>) {
    let Some(ip) = address_for(&d.point_to).map(|ip| ip.to_string()) else { return };
    let now = remote_domain::now_secs();
    let ping_due = d.provider == "mali" && now - hub.domain.lock().unwrap_or_else(PoisonError::into_inner).pinged_at > 24 * 3600;
    if d.ip.as_deref() == Some(ip.as_str()) && !ping_due {
        return;
    }
    let Ok(dns) = Dns::for_domain(d, token) else { return };
    match dns.set_address(&d.hostname, &ip).await {
        Ok(record_id) => {
            hub.domain.lock().unwrap_or_else(PoisonError::into_inner).pinged_at = now;
            let mut saved = hub.saved.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(current) = saved.domain.as_mut().filter(|c| c.hostname == d.hostname) {
                current.ip = Some(ip);
                if record_id.is_some() {
                    current.record_id = record_id;
                }
            }
            store_saved(&saved);
        }
        Err(e) => eprintln!("[remote] couldn't update {}: {e}", d.hostname),
    }
}

// ── server ──

async fn serve(listener: TcpListener, hub: &'static Hub, tls: Arc<ServerConfig>) {
    let acceptor = TlsAcceptor::from(tls);
    loop {
        let Ok((stream, peer)) = listener.accept().await else { continue };
        if !peer_allowed(peer.ip()) {
            continue;
        }
        let acceptor = acceptor.clone();
        tokio::spawn(async move {
            let Ok(mut tls_stream) = acceptor.accept(stream).await else { return };
            let _ = handle(&mut tls_stream, hub, peer.ip()).await;
        });
    }
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

async fn read_request<S>(stream: &mut S) -> Option<Request>
where
    S: AsyncRead + Unpin,
{
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let n = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Some(Request { method, path, headers, body })
}

async fn respond<S>(stream: &mut S, status: &str, kind: &str, extra: &[(&str, &str)], body: &[u8])
where
    S: AsyncWrite + Unpin,
{
    let mut head = format!(
        "HTTP/1.1 {status}\r\ncontent-length: {}\r\ncontent-type: {kind}\r\nconnection: close\r\nx-content-type-options: nosniff\r\nreferrer-policy: no-referrer\r\n",
        body.len()
    );
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

async fn respond_json<S>(stream: &mut S, status: &str, body: &Value)
where
    S: AsyncWrite + Unpin,
{
    let text = body.to_string();
    respond(stream, status, "application/json", &[("cache-control", "no-store")], text.as_bytes()).await;
}

/// Compare without leaking how much of the token matched.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// None when allowed; otherwise the status to answer with.
fn check_token(hub: &Hub, request: &Request) -> Option<&'static str> {
    let mut failures = hub.failures.lock().unwrap_or_else(PoisonError::into_inner);
    if failures.0.elapsed() > Duration::from_secs(60) {
        *failures = (Instant::now(), 0);
    }
    if failures.1 >= MAX_FAILURES {
        return Some("429 Too Many Requests");
    }
    let token = hub.saved.lock().unwrap_or_else(PoisonError::into_inner).token.clone();
    let ok = request
        .header("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| same_secret(t.trim(), &token));
    if ok {
        None
    } else {
        failures.1 += 1;
        Some("401 Unauthorized")
    }
}

const PAGE_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

async fn handle<S>(stream: &mut S, hub: &'static Hub, peer_ip: IpAddr) -> Option<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = read_request(stream).await?;
    let path = request.path.split('?').next().unwrap_or("/").to_string();
    match (request.method.as_str(), path.as_str()) {
        ("GET", "/") | ("GET", "/index.html") => {
            let headers = [
                ("cache-control", "no-cache"),
                ("content-security-policy", PAGE_CSP),
                ("x-frame-options", "DENY"),
            ];
            respond(stream, "200 OK", "text/html; charset=utf-8", &headers, PAGE.as_bytes()).await;
        }
        ("GET", "/manifest.webmanifest") => {
            let manifest = json!({
                "name": "Mali Remote",
                "short_name": "Mali",
                "start_url": "/",
                "display": "standalone",
                "background_color": "#fafafa",
                "theme_color": "#fafafa",
                "icons": [
                    { "src": "/icon-180.png", "sizes": "180x180", "type": "image/png" },
                    { "src": "/icon-1024.png", "sizes": "1024x1024", "type": "image/png" }
                ]
            });
            let text = manifest.to_string();
            respond(stream, "200 OK", "application/manifest+json", &[], text.as_bytes()).await;
        }
        ("GET", "/icon-180.png") => {
            respond(stream, "200 OK", "image/png", &[("cache-control", "max-age=86400")], TOUCH_ICON).await;
        }
        ("GET", "/jsqr.js") => {
            let kind = "text/javascript; charset=utf-8";
            respond(stream, "200 OK", kind, &[("cache-control", "max-age=86400")], JSQR.as_bytes()).await;
        }
        ("GET", "/icon-1024.png") => {
            respond(stream, "200 OK", "image/png", &[("cache-control", "max-age=86400")], ICON_512).await;
        }
        ("GET", "/api/events") => {
            if let Some(status) = check_token(hub, &request) {
                respond_json(stream, status, &json!({ "error": "unauthorized" })).await;
                return Some(());
            }
            if let Some(status) = gate_authenticated(hub, peer_ip, request.header("user-agent")) {
                respond_json(stream, status, &json!({ "error": "ip_not_allowed" })).await;
                return Some(());
            }
            stream_state(stream, hub).await;
        }
        ("POST", "/api/command") => {
            if let Some(status) = check_token(hub, &request) {
                respond_json(stream, status, &json!({ "error": "unauthorized" })).await;
                return Some(());
            }
            if let Some(status) = gate_authenticated(hub, peer_ip, request.header("user-agent")) {
                respond_json(stream, status, &json!({ "error": "ip_not_allowed" })).await;
                return Some(());
            }
            let Ok(command) = serde_json::from_slice::<Value>(&request.body) else {
                respond_json(stream, "400 Bad Request", &json!({ "error": "bad json" })).await;
                return Some(());
            };
            let result = forward(hub, command).await;
            respond_json(stream, "200 OK", &result).await;
        }
        _ => {
            respond(stream, "404 Not Found", "text/plain", &[], b"not found").await;
        }
    }
    Some(())
}

/// Hand a phone's command to the main window and wait for its answer.
async fn forward(hub: &Hub, command: Value) -> Value {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = oneshot::channel();
    hub.pending.lock().unwrap_or_else(PoisonError::into_inner).insert(id.clone(), tx);
    if hub.app.emit_to(MAIN_LABEL, COMMAND_EVENT, json!({ "id": id, "command": command })).is_err() {
        hub.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
        return json!({ "error": "Mali's window isn't open." });
    }
    match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        _ => {
            hub.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
            json!({ "error": "Mali didn't answer in time. Is the app still running on the computer?" })
        }
    }
}

/// Counts an open phone for as long as its stream lives.
struct Client(&'static Hub);

impl Client {
    fn open(hub: &'static Hub) -> Self {
        let n = hub.clients.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = hub.app.emit_to(MAIN_LABEL, CLIENTS_EVENT, n);
        Client(hub)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let n = self.0.clients.fetch_sub(1, Ordering::Relaxed).saturating_sub(1);
        let _ = self.0.app.emit_to(MAIN_LABEL, CLIENTS_EVENT, n);
    }
}

fn event(name: &str, data: &str) -> String {
    // A line break inside `data` would end the field: each line gets its own.
    let mut out = format!("event: {name}\n");
    for line in data.split('\n') {
        out.push_str("data: ");
        out.push_str(line);
        out.push('\n');
    }
    out.push('\n');
    out
}

/// Server-sent events: the summary now, then each time it changes.
async fn stream_state<S>(stream: &mut S, hub: &'static Hub)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let stream = stream;
    let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-store\r\nconnection: close\r\nx-accel-buffering: no\r\nx-content-type-options: nosniff\r\n\r\n";
    if stream.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    let _client = Client::open(hub);
    let mut state = hub.state.subscribe();
    let mut epoch = hub.epoch.subscribe();
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    let first = state.borrow_and_update().clone();
    if stream.write_all(event("state", &first).as_bytes()).await.is_err() {
        return;
    }
    loop {
        let chunk = tokio::select! {
            changed = state.changed() => {
                if changed.is_err() {
                    break;
                }
                let current = state.borrow_and_update().clone();
                event("state", &current)
            }
            _ = epoch.changed() => break,
            _ = ping.tick() => ": ping\n\n".to_string(),
        };
        if stream.write_all(chunk.as_bytes()).await.is_err() {
            break;
        }
    }
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv6Addr;

    #[test]
    fn answers_private_networks_only() {
        for ip in ["127.0.0.1", "192.168.1.20", "10.0.0.5", "172.20.1.1", "169.254.3.4", "100.101.102.103"] {
            assert!(peer_allowed(ip.parse().unwrap()), "{ip} should be allowed");
        }
        for ip in ["8.8.8.8", "100.128.0.1", "172.32.0.1", "1.1.1.1"] {
            assert!(!peer_allowed(ip.parse().unwrap()), "{ip} should be refused");
        }
        assert!(peer_allowed(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(peer_allowed("fd7a:115c:a1e0::1".parse().unwrap()));
        assert!(peer_allowed("::ffff:192.168.0.2".parse().unwrap()));
        assert!(!peer_allowed("2001:4860:4860::8888".parse().unwrap()));
    }

    #[test]
    fn splits_event_data_by_line() {
        assert_eq!(event("state", "a\nb"), "event: state\ndata: a\ndata: b\n\n");
    }

    #[test]
    fn builds_https_config_without_panicking() {
        // Regression: with both rustls backends compiled in, `ServerConfig::builder()`
        // panicked, poisoning the pairing lock and crashing the app on the next status.
        let mut saved = Saved {
            token: new_token(),
            port: DEFAULT_PORT,
            allowed_ips: Vec::new(),
            ip_allowlist_enabled: false,
            auto_allow_new_ips: true,
            tls_cert_pem: None,
            tls_key_pem: None,
            domain: None,
            mali_domain_off: false,
            device_labels: HashMap::new(),
        };
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        saved.tls_cert_pem = Some(cert.cert.pem());
        saved.tls_key_pem = Some(cert.key_pair.serialize_pem());
        assert!(tls_config(&saved).is_ok());
        saved.domain = Some(DomainSaved {
            hostname: "mali.example.com".into(),
            cert_pem: saved.tls_cert_pem.clone(),
            key_pem: saved.tls_key_pem.clone(),
            ..Default::default()
        });
        let (_, certs) = tls_config(&saved).unwrap();
        assert!(certs.domain.read().unwrap().is_some());
        let print = fingerprint(saved.tls_cert_pem.as_deref().unwrap()).unwrap();
        assert_eq!(print.len(), 32 * 3 - 1);
        assert!(print.chars().all(|c| c == ':' || c.is_ascii_hexdigit()));
    }

    /// Accepts any certificate: the test checks *which* one the server sends.
    #[derive(Debug)]
    struct AnyCert;

    impl rustls::client::danger::ServerCertVerifier for AnyCert {
        fn verify_server_cert(
            &self,
            _: &CertificateDer<'_>,
            _: &[CertificateDer<'_>],
            _: &rustls::pki_types::ServerName<'_>,
            _: &[u8],
            _: rustls::pki_types::UnixTime,
        ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms.supported_schemes()
        }
    }

    /// The certificate the server presents to a client asking for `name`.
    async fn presented(config: Arc<ServerConfig>, name: &'static str) -> Vec<u8> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let acceptor = TlsAcceptor::from(config);
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let _ = acceptor.accept(stream).await;
        });
        let client = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AnyCert))
            .with_no_client_auth();
        let connector = tokio_rustls::TlsConnector::from(Arc::new(client));
        let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let server_name = rustls::pki_types::ServerName::try_from(name).unwrap();
        let tls = connector.connect(server_name, stream).await.unwrap();
        tls.get_ref().1.peer_certificates().unwrap()[0].as_ref().to_vec()
    }

    #[tokio::test]
    async fn sends_the_domain_certificate_when_asked_by_name() {
        let own = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let trusted = rcgen::generate_simple_self_signed(vec!["mali.example.com".into()]).unwrap();
        let saved = Saved {
            token: new_token(),
            port: DEFAULT_PORT,
            allowed_ips: Vec::new(),
            ip_allowlist_enabled: true,
            auto_allow_new_ips: false,
            tls_cert_pem: Some(own.cert.pem()),
            tls_key_pem: Some(own.key_pair.serialize_pem()),
            domain: Some(DomainSaved {
                hostname: "mali.example.com".into(),
                cert_pem: Some(trusted.cert.pem()),
                key_pem: Some(trusted.key_pair.serialize_pem()),
                ..Default::default()
            }),
            mali_domain_off: false,
            device_labels: HashMap::new(),
        };
        let (config, _) = tls_config(&saved).unwrap();
        assert_eq!(presented(config.clone(), "mali.example.com").await, trusted.cert.der().to_vec());
        assert_eq!(presented(config, "something.else").await, own.cert.der().to_vec());
    }

    #[test]
    fn names_devices_plainly() {
        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
        let android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
        assert_eq!(device_label(iphone), "iPhone");
        assert_eq!(device_label(android), "Android phone");
        assert_eq!(device_label("curl/8.0"), "Device");
    }

    #[test]
    fn compares_tokens_whole() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }
}
