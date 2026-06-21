use futures::StreamExt;
use tokio::sync::mpsc;
use tokio::time::Duration;

use tokio::sync::watch;

use crate::config::{RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS};
use crate::messages::{SignalMessage, WsEvent};

pub struct SignalingClient {
    pub ws_sender: Option<
        futures::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            tokio_tungstenite::tungstenite::Message,
        >,
    >,
    // Bounded senders apply backpressure: if the main event loop falls behind
    // (e.g. blocked on a slow WebRTC callback), sends block instead of letting
    // the channel grow unbounded. The reader task uses `send().await` and the
    // disconnect retry path stays compatible via `let _ = ...`.
    pub ws_in_tx: mpsc::Sender<String>,
    pub sig_tx: mpsc::Sender<SignalMessage>,
    pub ws_event_tx: mpsc::Sender<WsEvent>,
    pub last_join: Option<(String, String, String)>,
    pub reconnect_delay: u64,
    shutdown_rx: watch::Receiver<bool>,
}

impl SignalingClient {
    pub fn new(
        ws_in_tx: mpsc::Sender<String>,
        sig_tx: mpsc::Sender<SignalMessage>,
        ws_event_tx: mpsc::Sender<WsEvent>,
        shutdown_rx: watch::Receiver<bool>,
    ) -> Self {
        SignalingClient {
            ws_sender: None,
            ws_in_tx,
            sig_tx,
            ws_event_tx,
            last_join: None,
            reconnect_delay: RECONNECT_BASE_DELAY_MS,
            shutdown_rx,
        }
    }

    pub async fn connect(
        &mut self,
        server: &str,
        room: &str,
        name: &str,
        res_tx: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) {
        tracing::info!("Connecting to {} room {}", server, room);
        match tokio_tungstenite::connect_async(server).await {
            Ok((ws, _)) => {
                tracing::info!("Connected to signaling server");
                self.reconnect_delay = RECONNECT_BASE_DELAY_MS;
                self.last_join = Some((server.to_string(), room.to_string(), name.to_string()));
                let (write, mut read) = ws.split();
                let ws_in_tx = self.ws_in_tx.clone();
                let ws_event_tx = self.ws_event_tx.clone();

                let mut shutdown_rx = self.shutdown_rx.clone();
                tokio::spawn(async move {
                    loop {
                        tokio::select! {
                            biased;
                            _ = shutdown_rx.changed() => {
                                tracing::info!("WS reader shutting down");
                                break;
                            }
                            msg = read.next() => {
                                match msg {
                                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) => {
                                        // Bounded sender: `.send().await` blocks if the
                                        // backend loop is behind. We swallow errors because
                                        // the channel closes only when the backend is gone,
                                        // which means the app is shutting down anyway.
                                        if ws_in_tx.send(t).await.is_err() {
                                            break;
                                        }
                                    }
                                    _ => break,
                                }
                            }
                        }
                    }
                    let _ = ws_event_tx.send(WsEvent::Disconnected).await;
                });

                self.ws_sender = Some(write);
                let _ = self.sig_tx.send(SignalMessage::Join {
                    room: room.to_string(),
                    name: name.to_string(),
                }).await;
                let _ = res_tx.send(Ok(()));
            }
            Err(e) => {
                tracing::warn!("Connection failed: {:?}", e);
                let _ = res_tx.send(Err(format!("Connection failed: {}", e)));
                // If this was a reconnect attempt (a prior session exists), the
                // success path that spawns the reader — and thus emits the next
                // Disconnected — never ran. Re-emit it here so the exponential
                // backoff loop keeps retrying instead of giving up after one try.
                if self.last_join.is_some() {
                    let _ = self.ws_event_tx.send(WsEvent::Disconnected).await;
                }
            }
        }
    }

    pub async fn leave(&mut self) {
        tracing::info!("Leaving room");
        self.last_join = None;
        if let Some(mut ws) = self.ws_sender.take() {
            use futures::SinkExt;
            let _ = ws.close().await;
        }
    }

    pub async fn send_signal(&mut self, msg: &SignalMessage) {
        if let Some(ws) = self.ws_sender.as_mut() {
            if let Ok(json) = serde_json::to_string(msg) {
                use futures::SinkExt;
                let _ = ws
                    .send(tokio_tungstenite::tungstenite::Message::Text(json))
                    .await;
            }
        }
    }

    pub fn backoff_delay(&mut self) -> Duration {
        let delay = self.reconnect_delay;
        self.reconnect_delay = (self.reconnect_delay * 2).min(RECONNECT_MAX_DELAY_MS);
        Duration::from_millis(delay)
    }

    pub fn should_reconnect(&self) -> bool {
        self.last_join.is_some()
    }
}
