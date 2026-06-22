use ::webrtc::api::media_engine::MediaEngine;
use ::webrtc::api::APIBuilder;
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, watch};

use crate::audio::{init_audio, start_encoder_thread};
use crate::config::{default_ice_servers, STATS_POLL_INTERVAL_MS};
use crate::messages::{AppCommand, SignalMessage, WsEvent};
use crate::signaling::SignalingClient;
use crate::state;
use crate::webrtc::{PeerManager, WebrtcContext};

struct BackendSession {
    sig_client: SignalingClient,
    peer_manager: PeerManager,
    my_id: Option<String>,
    mixer_sources: Arc<Mutex<crate::audio::MixerMap>>,
    opus_bitrate: Arc<AtomicI32>,
    saved_volumes: Arc<Mutex<Vec<(String, f32)>>>,
}

/// Main async event loop: Tauri commands, signaling WS, WebRTC peer management, stats.
pub async fn run_backend(
    handle: tauri::AppHandle,
    backend: state::BackendState,
    mut rx: mpsc::Receiver<AppCommand>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<()> {
    let audio = init_audio()?;
    let mixer_sources = audio.mixer_sources.clone();

    let mut m = MediaEngine::default();
    m.register_default_codecs()?;
    let api = Arc::new(APIBuilder::new().with_media_engine(m).build());

    let ice_servers = default_ice_servers();
    let local_track = Arc::new(
        ::webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP::new(
            ::webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                mime_type: "audio/opus".to_owned(),
                ..Default::default()
            },
            "audio".to_owned(),
            "webrtc-rs".to_owned(),
        ),
    );

    let opus_bitrate = Arc::new(AtomicI32::new(crate::config::DEFAULT_OPUS_BITRATE));
    let saved_volumes: Arc<Mutex<Vec<(String, f32)>>> = Arc::new(Mutex::new(Vec::new()));

    let encoder_handle = start_encoder_thread(
        local_track.clone(),
        audio.mic_consumer,
        audio.sample_rate,
        audio.samples_per_frame,
        opus_bitrate.clone(),
        handle.clone(),
    );

    let (sig_tx, mut sig_rx) = mpsc::channel::<SignalMessage>(256);
    let (ws_in_tx, mut ws_in_rx) = mpsc::channel::<String>(256);
    let (ws_event_tx, mut ws_event_rx) = mpsc::channel::<WsEvent>(256);

    let ctx = WebrtcContext {
        api,
        local_track,
        mixer: mixer_sources.clone(),
        sig_tx: sig_tx.clone(),
        handle: handle.clone(),
        sample_rate: audio.sample_rate,
        samples_per_frame: audio.samples_per_frame,
    };

    let mut session = BackendSession {
        sig_client: SignalingClient::new(
            ws_in_tx,
            sig_tx.clone(),
            ws_event_tx,
            shutdown_rx.clone(),
        ),
        peer_manager: PeerManager::new(ice_servers),
        my_id: None,
        mixer_sources: mixer_sources.clone(),
        opus_bitrate,
        saved_volumes,
    };
    let mut stats_interval =
        tokio::time::interval(std::time::Duration::from_millis(STATS_POLL_INTERVAL_MS));
    stats_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                tracing::info!("Backend shutting down gracefully");
                session.sig_client.leave().await;
                session.peer_manager.close_all(&handle).await;
                encoder_handle.shutdown();
                session.mixer_sources.lock().clear();
                break Ok(());
            }
            Some(cmd) = rx.recv() => {
                handle_app_command(cmd, &handle, &mut session).await;
            }
            Some(msg) = sig_rx.recv() => {
                session.sig_client.send_signal(&msg).await;
            }
            Some(text) = ws_in_rx.recv() => {
                handle_ws_inbound(&text, &handle, &backend, &mut session, &ctx).await;
            }
            Some(_) = ws_event_rx.recv() => {
                handle_ws_disconnect(&handle, &backend, &mut session).await;
            }
            _ = stats_interval.tick() => {
                if backend.connected.load(Ordering::SeqCst) && !session.peer_manager.is_empty() {
                    session.peer_manager.poll_and_emit_stats(&handle).await;
                }
            }
        }
    }
}

async fn handle_app_command(
    cmd: AppCommand,
    handle: &tauri::AppHandle,
    session: &mut BackendSession,
) {
    match cmd {
        AppCommand::Join {
            server,
            room,
            name,
            token,
            res_tx,
        } => {
            session
                .sig_client
                .connect(&server, &room, &name, token, res_tx)
                .await;
        }
        AppCommand::Leave { res_tx } => {
            session.sig_client.leave().await;
            session.peer_manager.close_all(handle).await;
            session.my_id = None;
            session.saved_volumes.lock().clear();
            let _ = res_tx.send(Ok(()));
        }
        AppCommand::SetVolume { peer_id, vol } => {
            let mut sources = session.mixer_sources.lock();
            if let Some((_, v)) = sources.get_mut(&peer_id) {
                *v = vol;
            }
        }
        AppCommand::SetOpusBitrate { bitrate } => {
            session.opus_bitrate.store(bitrate, Ordering::Relaxed);
        }
        AppCommand::SetMute { muted } => {
            let mut sources = session.mixer_sources.lock();
            if muted {
                let mut vols = session.saved_volumes.lock();
                vols.clear();
                for (peer_id, (_, vol)) in sources.iter() {
                    vols.push((peer_id.clone(), *vol));
                }
                for (_, vol) in sources.values_mut() {
                    *vol = 0.0;
                }
                tracing::info!("Muted {} peers, volumes saved", vols.len());
            } else {
                let vols = session.saved_volumes.lock();
                if vols.is_empty() {
                    return;
                }
                for (peer_id, vol) in vols.iter() {
                    if let Some((_, v)) = sources.get_mut(peer_id) {
                        *v = *vol;
                    }
                }
                tracing::info!("Unmuted, {} volumes restored", vols.len());
            }
        }
    }
}

async fn handle_ws_inbound(
    text: &str,
    handle: &tauri::AppHandle,
    backend: &state::BackendState,
    session: &mut BackendSession,
    ctx: &WebrtcContext,
) {
    if let Ok(signal) = serde_json::from_str::<SignalMessage>(text) {
        if matches!(signal, SignalMessage::Welcome { .. }) {
            backend.connected.store(true, Ordering::SeqCst);
            let _ = handle.emit("connected", ());
        }
        if let Err(e) = session
            .peer_manager
            .handle_signal(signal, &mut session.my_id, ctx)
            .await
        {
            tracing::error!("WebRTC signal error: {:?}", e);
        }
    }
}

async fn handle_ws_disconnect(
    handle: &tauri::AppHandle,
    backend: &state::BackendState,
    session: &mut BackendSession,
) {
    backend.connected.store(false, Ordering::SeqCst);
    let _ = handle.emit("disconnected", ());
    session.peer_manager.close_all(handle).await;
    if session.sig_client.should_reconnect() {
        let delay = session.sig_client.backoff_delay();
        tracing::info!("Reconnecting in {}ms", delay.as_millis());
        tokio::time::sleep(delay).await;
        let (res_tx, _) = tokio::sync::oneshot::channel();
        if let Some((server, room, name)) = session.sig_client.last_join.clone() {
            let token = session.sig_client.last_token.clone();
            session
                .sig_client
                .connect(&server, &room, &name, token, res_tx)
                .await;
        }
    } else {
        session.my_id = None;
    }
}
