//! One event stream per folder, shared by every prompt running there.
//!
//! opencode's `/event` streams everything that happens in a folder's
//! instance. Opening one per prompt (and another for each retry) piled up
//! listeners in the server — its "MaxListenersExceededWarning: Possible
//! EventTarget memory leak" — and a stream that dropped took its reply down
//! with it ("error decoding response body", shown as a wrong API key).
//!
//! Here a folder has one connection while anyone listens. Each prompt takes
//! its own receiver and picks out its session (`EventTranslator`). If the
//! connection drops it comes back by itself, and listeners hear
//! [`RECONNECTED`] so they can catch up on what they missed; if it can't
//! come back they hear [`LOST`]. With no one listening it closes after a
//! moment, so an idle folder's instance can still be closed
//! (`instances.rs`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures::StreamExt;
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch};

use super::client::OpencodeClient;

/// The stream dropped and is back: events in between may be missing.
pub const RECONNECTED: &str = "mali.stream.reconnected";
/// The stream dropped and didn't come back.
pub const LOST: &str = "mali.stream.lost";

/// Events held for a listener that falls behind.
const BUFFER: usize = 4096;
/// Tries to reconnect before giving up, a little longer apart each time.
const RETRIES: u32 = 6;
/// With no one listening, the connection stays this long for the next prompt.
const LINGER: Duration = Duration::from_secs(10);
/// How often a quiet stream checks whether anyone still listens.
const CHECK: Duration = Duration::from_secs(5);

pub type Event = Arc<Value>;

struct Hub {
    tx: broadcast::Sender<Event>,
    connected: watch::Receiver<bool>,
}

fn hubs() -> &'static Mutex<HashMap<String, Arc<Hub>>> {
    static HUBS: OnceLock<Mutex<HashMap<String, Arc<Hub>>>> = OnceLock::new();
    HUBS.get_or_init(Default::default)
}

/// A prompt's view of its folder's events.
pub struct Events {
    rx: broadcast::Receiver<Event>,
    _hub: Arc<Hub>,
}

impl Events {
    /// The next event; `None` once the stream is gone for good.
    pub async fn next(&mut self) -> Option<Event> {
        match self.rx.recv().await {
            Ok(event) => Some(event),
            // Fell behind: as good as a dropped stream, so it catches up the same way.
            Err(broadcast::error::RecvError::Lagged(missed)) => {
                eprintln!("[opencode] a reply fell {missed} events behind");
                Some(Arc::new(json!({ "type": RECONNECTED })))
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    }
}

/// Listen to `directory`'s events, once the stream is connected. A server
/// that restarted (a new address) gets a stream of its own.
pub async fn subscribe(client: &OpencodeClient, directory: &str, timeout: Duration) -> Result<Events, String> {
    let key = format!("{}|{directory}", client.base_url());
    let (hub, rx) = {
        let mut map = hubs().lock().unwrap();
        let hub = map
            .entry(key.clone())
            .or_insert_with(|| start(client.clone(), directory.to_string(), key))
            .clone();
        // Under the lock, so the stream can't close between finding it and listening.
        let rx = hub.tx.subscribe();
        (hub, rx)
    };
    let mut connected = hub.connected.clone();
    tokio::time::timeout(timeout, connected.wait_for(|up| *up))
        .await
        .map_err(|_| "Timed out connecting to the opencode event stream".to_string())?
        .map_err(|_| "The opencode event stream closed".to_string())?;
    Ok(Events { rx, _hub: hub })
}

fn start(client: OpencodeClient, directory: String, key: String) -> Arc<Hub> {
    let (tx, _) = broadcast::channel(BUFFER);
    let (up, connected) = watch::channel(false);
    let hub = Arc::new(Hub { tx: tx.clone(), connected });
    tokio::spawn(run(client, directory, key, tx, up));
    hub
}

/// Close the stream if no one listens; under the lock, so no one starts to meanwhile.
fn close_if_unused(key: &str, tx: &broadcast::Sender<Event>) -> bool {
    let mut map = hubs().lock().unwrap();
    if tx.receiver_count() > 0 {
        return false;
    }
    map.remove(key);
    true
}

fn give_up(key: &str, tx: &broadcast::Sender<Event>) {
    hubs().lock().unwrap().remove(key);
    let _ = tx.send(Arc::new(json!({ "type": LOST })));
}

async fn run(client: OpencodeClient, directory: String, key: String, tx: broadcast::Sender<Event>, up: watch::Sender<bool>) {
    let mut failures = 0u32;
    let mut first = true;
    loop {
        match client.events(&directory).await {
            Ok(response) => {
                let mut stream = SseStream::new(response);
                let mut unused_since: Option<Instant> = None;
                loop {
                    tokio::select! {
                        next = stream.next() => match next {
                            Ok(Some(event)) => {
                                if event["type"] == "server.connected" {
                                    failures = 0;
                                    let _ = up.send(true);
                                    if !first {
                                        eprintln!("[opencode] event stream back for {directory:?}");
                                        let _ = tx.send(Arc::new(json!({ "type": RECONNECTED })));
                                    }
                                    first = false;
                                }
                                let _ = tx.send(Arc::new(event));
                            }
                            Ok(None) => {
                                eprintln!("[opencode] event stream ended for {directory:?}");
                                break;
                            }
                            Err(e) => {
                                eprintln!("[opencode] event stream dropped for {directory:?}: {e}");
                                break;
                            }
                        },
                        _ = tokio::time::sleep(CHECK) => {}
                    }
                    if tx.receiver_count() > 0 {
                        unused_since = None;
                    } else if unused_since.get_or_insert_with(Instant::now).elapsed() >= LINGER
                        && close_if_unused(&key, &tx)
                    {
                        return;
                    }
                }
            }
            Err(e) => eprintln!("[opencode] can't open the event stream for {directory:?}: {e}"),
        }
        let _ = up.send(false);
        if close_if_unused(&key, &tx) {
            return;
        }
        failures += 1;
        if failures > RETRIES {
            give_up(&key, &tx);
            return;
        }
        tokio::time::sleep(backoff(failures)).await;
    }
}

/// 250 ms, then twice as long each time, up to 4 s.
fn backoff(failures: u32) -> Duration {
    Duration::from_millis((250u64 << failures.saturating_sub(1).min(4)).min(4000))
}

/// Minimal server-sent-events reader: yields the JSON payload of each `data:` line.
pub struct SseStream {
    body: futures::stream::BoxStream<'static, reqwest::Result<Vec<u8>>>,
    buffer: Vec<u8>,
}

impl SseStream {
    pub fn new(response: reqwest::Response) -> Self {
        Self {
            body: response.bytes_stream().map(|r| r.map(|b| b.to_vec())).boxed(),
            buffer: Vec::new(),
        }
    }

    /// Cancel-safe: a partial line stays in the buffer for the next call.
    pub async fn next(&mut self) -> Result<Option<Value>, String> {
        loop {
            while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = self.buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                if let Some(data) = line.trim().strip_prefix("data:") {
                    if let Ok(value) = serde_json::from_str(data.trim()) {
                        return Ok(Some(value));
                    }
                }
            }
            match self.body.next().await {
                Some(chunk) => self.buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?),
                None => return Ok(None),
            }
        }
    }

    #[cfg(test)]
    pub async fn wait_for(&mut self, event_type: &str) -> Result<(), String> {
        while let Some(event) = self.next().await? {
            if event["type"] == event_type {
                return Ok(());
            }
        }
        Err("opencode event stream closed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnects_sooner_then_later() {
        assert_eq!(backoff(1), Duration::from_millis(250));
        assert_eq!(backoff(2), Duration::from_millis(500));
        assert_eq!(backoff(4), Duration::from_millis(2000));
        assert_eq!(backoff(9), Duration::from_millis(4000));
    }
}
