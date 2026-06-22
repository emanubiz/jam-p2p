#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod config;
mod logger;
mod messages;
mod signaling;
mod state;
mod webrtc;

use ::webrtc::api::media_engine::MediaEngine;
use ::webrtc::api::APIBuilder;
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;

use crate::audio::{init_audio, start_encoder_thread};
use crate::config::default_ice_servers;
use crate::logger::init_tracing;
use crate::messages::{AppCommand, SignalMessage, WsEvent};
use crate::signaling::SignalingClient;
use crate::state::init_state;
use crate::webrtc::{PeerManager, WebrtcContext};
use tokio::sync::watch;

// Startup is fatal-or-nothing: if the tokio runtime or the Tauri event loop
// cannot be created there is no meaningful recovery, so `expect` (which the
// project otherwise lints against) is the correct choice here.
#[allow(clippy::expect_used)]
fn main() {
    init_tracing();
    // Bounded channels give backpressure: if a producer outruns a consumer
    // (e.g. a burst of WS frames), `.send().await` awaits instead of letting
    // memory grow without limit. 256 is plenty for 8 peers × 50 msg/s bursts.
    let (tx, rx) = mpsc::channel::<AppCommand>(64);
    let (app_state, backend_state) = init_state(tx);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            state::join_room,
            state::set_volume,
            state::leave_room,
            state::set_opus_bitrate,
            state::set_muted,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
                rt.block_on(async move {
                    if let Err(e) = run_backend(handle, backend_state, rx, shutdown_rx).await {
                        tracing::error!("Backend error: {:?}", e);
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    // Signal shutdown when Tauri exits
    let _ = shutdown_tx.send(true);
}

async fn run_backend(
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
    // parking_lot::Mutex (no PoisonError): the real-time audio callback in
    // audio.rs holds the mixer lock via `try_lock`, and the shutdown path
    // never poisons the mutex.
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

    let mut peer_manager = PeerManager::new(ice_servers);
    let mut sig_client =
        SignalingClient::new(ws_in_tx, sig_tx.clone(), ws_event_tx, shutdown_rx.clone());
    let mut my_id: Option<String> = None;

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                tracing::info!("Backend shutting down gracefully");
                sig_client.leave().await;
                peer_manager.close_all(&handle).await;
                encoder_handle.shutdown();
                mixer_sources.lock().clear();
                // run_backend returns Result<()>; the select! arm must produce a
                // matching type, so we break with Ok(()) rather than `()`.
                break Ok(());
            }
            Some(cmd) = rx.recv() => {
                match cmd {
                    AppCommand::Join { server, room, name, res_tx } => {
                        sig_client.connect(&server, &room, &name, res_tx).await;
                    }
                    AppCommand::Leave { res_tx } => {
                        sig_client.leave().await;
                        peer_manager.close_all(&handle).await;
                        my_id = None;
                        // Clear saved volumes when leaving room
                        saved_volumes.lock().clear();
                        let _ = res_tx.send(Ok(()));
                    }
                    AppCommand::SetVolume { peer_id, vol } => {
                        let mut sources = mixer_sources.lock();
                        if let Some((_, v)) = sources.get_mut(&peer_id) {
                            *v = vol;
                        }
                    }
                    AppCommand::SetOpusBitrate { bitrate } => {
                        opus_bitrate.store(bitrate, Ordering::Relaxed);
                    }
                    AppCommand::SetMute { muted } => {
                        let mut sources = mixer_sources.lock();
                        if muted {
                            let mut vols = saved_volumes.lock();
                            vols.clear();
                            for (peer_id, (_, vol)) in sources.iter() {
                                vols.push((peer_id.clone(), *vol));
                            }
                            for (_, vol) in sources.values_mut() {
                                *vol = 0.0;
                            }
                            tracing::info!("Muted {} peers, volumes saved", vols.len());
                        } else {
                            let vols = saved_volumes.lock();
                            if vols.is_empty() { continue; }
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
            Some(msg) = sig_rx.recv() => {
                sig_client.send_signal(&msg).await;
            }
            Some(text) = ws_in_rx.recv() => {
                if let Ok(signal) = serde_json::from_str::<SignalMessage>(&text) {
                    // Set connected flag when Welcome is received (covers both
                    // the initial join and a successful auto-reconnect, so the
                    // UI can return to the live view).
                    if matches!(signal, SignalMessage::Welcome { .. }) {
                        backend.connected.store(true, Ordering::SeqCst);
                        let _ = handle.emit("connected", ());
                    }
                    if let Err(e) = peer_manager.handle_signal(
                        signal,
                        &mut my_id,
                        &ctx,
                    ).await {
                        tracing::error!("WebRTC signal error: {:?}", e);
                    }
                }
            }
            Some(_) = ws_event_rx.recv() => {
                // WS connection dropped — handle reconnect. Resetting
                // `connected` here is critical: otherwise a permanently
                // failed reconnect leaves the UI blocked on
                // "Already connected" because join_room's guard never
                // sees a false signal until the user explicitly leaves.
                // The auto-reconnect path doesn't go through join_room,
                // so this is safe; on Welcome it is flipped back to true.
                backend.connected.store(false, Ordering::SeqCst);
                let _ = handle.emit("disconnected", ());
                peer_manager.close_all(&handle).await;
                if sig_client.should_reconnect() {
                    let delay = sig_client.backoff_delay();
                    tracing::info!("Reconnecting in {}ms", delay.as_millis());
                    tokio::time::sleep(delay).await;
                    let (res_tx, _) = tokio::sync::oneshot::channel();
                    if let Some((server, room, name)) = sig_client.last_join.clone() {
                        sig_client.connect(&server, &room, &name, res_tx).await;
                    }
                } else {
                    my_id = None;
                }
            }
        }
    }
}
