#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod config;
mod logger;
mod messages;
mod signaling;
mod state;
mod webrtc;

use anyhow::Result;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::Emitter;
use tokio::sync::mpsc;
use ::webrtc::api::media_engine::MediaEngine;
use ::webrtc::api::APIBuilder;

use crate::audio::{init_audio, start_encoder_thread};
use crate::config::default_ice_servers;
use crate::logger::init_tracing;
use crate::messages::{AppCommand, SignalMessage};
use crate::signaling::SignalingClient;
use crate::state::init_state;
use crate::webrtc::{PeerManager, WebrtcContext};

fn main() {
    init_tracing();
    let (tx, rx) = mpsc::unbounded_channel::<AppCommand>();
    let (app_state, backend_state) = init_state(tx);

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            state::join_room,
            state::set_volume,
            state::leave_room,
            state::set_opus_bitrate,
            state::set_muted,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new()
                    .expect("failed to create tokio runtime");
                rt.block_on(async move {
                    if let Err(e) = run_backend(handle, backend_state, rx).await {
                        tracing::error!("Backend error: {:?}", e);
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn run_backend(handle: tauri::AppHandle, backend: state::BackendState, mut rx: mpsc::UnboundedReceiver<AppCommand>) -> Result<()> {
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
    let saved_volumes: Arc<StdMutex<Vec<(String, f32)>>> =
        Arc::new(StdMutex::new(Vec::new()));

    let _encoder_handle = start_encoder_thread(
        local_track.clone(),
        audio.mic_consumer,
        mixer_sources.clone(),
        audio.sample_rate,
        audio.samples_per_frame,
        opus_bitrate.clone(),
    );

    let (sig_tx, mut sig_rx) = mpsc::unbounded_channel::<SignalMessage>();
    let (ws_in_tx, mut ws_in_rx) = mpsc::unbounded_channel::<String>();

    let ctx = WebrtcContext {
        api,
        ice_servers,
        local_track,
        mixer: mixer_sources.clone(),
        sig_tx: sig_tx.clone(),
        handle: handle.clone(),
        sample_rate: audio.sample_rate,
        samples_per_frame: audio.samples_per_frame,
    };

    let mut peer_manager = PeerManager::new();
    let mut sig_client = SignalingClient::new(ws_in_tx, sig_tx.clone());
    let mut my_id: Option<String> = None;

    loop {
        tokio::select! {
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
                        if let Ok(mut vols) = saved_volumes.lock() {
                            vols.clear();
                        }
                        let _ = res_tx.send(Ok(()));
                    }
                    AppCommand::SetVolume { peer_id, vol } => {
                        if let Ok(mut sources) = mixer_sources.lock() {
                            if let Some((_, v)) = sources.get_mut(&peer_id) {
                                *v = vol;
                            }
                        }
                    }
                    AppCommand::SetOpusBitrate { bitrate } => {
                        opus_bitrate.store(bitrate, Ordering::Relaxed);
                    }
                    AppCommand::SetMute { muted } => {
                        if let Ok(mut sources) = mixer_sources.lock() {
                            if muted {
                                let Ok(mut vols) = saved_volumes.lock() else { continue };
                                vols.clear();
                                for (peer_id, (_, vol)) in sources.iter() {
                                    vols.push((peer_id.clone(), *vol));
                                }
                                for (_, vol) in sources.values_mut() {
                                    *vol = 0.0;
                                }
                                tracing::info!("Muted {} peers, volumes saved", vols.len());
                            } else {
                                let Ok(vols) = saved_volumes.lock() else { continue };
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
            }
            Some(msg) = sig_rx.recv() => {
                sig_client.send_signal(&msg).await;
            }
            Some(text) = ws_in_rx.recv() => {
                if let Ok(signal) = serde_json::from_str::<SignalMessage>(&text) {
                    // Set connected flag when Welcome is received
                    if matches!(signal, SignalMessage::Welcome { .. }) {
                        backend.connected.store(true, Ordering::SeqCst);
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
            else => {
                // ws_in_rx closed — connection dropped unexpectedly
                let _ = handle.emit("disconnected", ());
                peer_manager.close_all(&handle).await;
                // Only reconnect if user didn't explicitly leave (last_join still set)
                if sig_client.should_reconnect() {
                    let delay = sig_client.backoff_delay();
                    tracing::info!("Reconnecting in {}ms", delay.as_millis());
                    tokio::time::sleep(delay).await;
                    // Reconnect uses stored last_join internally
                    let (res_tx, _) = tokio::sync::oneshot::channel();
                    if let Some((server, room, name)) = sig_client.last_join.clone() {
                        sig_client.connect(&server, &room, &name, res_tx).await;
                    }
                } else {
                    // Explicit leave — clear state
                    my_id = None;
                }
            }
        }
    }
}
