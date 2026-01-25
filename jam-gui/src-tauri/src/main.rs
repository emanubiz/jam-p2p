#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod logger;

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures::{SinkExt, StreamExt};
use opus::{Application, Channels, Decoder, Encoder};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapRb,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::State;
use tokio::sync::mpsc;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::{TrackLocal, TrackLocalWriter};

use crate::logger::init_tracing;

const SAMPLE_RATE: u32 = 48000;
const FRAME_SIZE_MS: usize = 20;
const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE as usize * FRAME_SIZE_MS) / 1000;

type MixerMap = HashMap<String, (HeapCons<f32>, f32)>;

#[derive(Debug)]
enum AppCommand {
    Join {
        room: String,
        name: String,
        server: String,
    },
    SetVolume {
        peer_id: String,
        vol: f32,
    },
}

struct AppState {
    tx: Mutex<mpsc::UnboundedSender<AppCommand>>,
}

#[tauri::command]
fn join_room(
    state: State<AppState>,
    room: String,
    name: String,
    server: String,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::Join { room, name, server })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_volume(state: State<AppState>, peer_id: String, vol: f32) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AppCommand::SetVolume { peer_id, vol })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    init_tracing();

    let (tx, mut rx) = mpsc::unbounded_channel::<AppCommand>();

    thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                tracing::error!(error = ?e, "failed to create tokio runtime");
                return;
            }
        };
        rt.block_on(async move {
            if let Err(e) = run_backend_loop(&mut rx).await {
                tracing::error!(error = ?e, "backend loop failed");
            }
        });
    });

    tauri::Builder::default()
        .manage(AppState {
            tx: Mutex::new(tx),
        })
        .invoke_handler(tauri::generate_handler![join_room, set_volume])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "data")]
enum SignalMessage {
    Join { room: String, name: String },
    PeerList { peers: Vec<String> },
    NewPeer { uuid: String },
    Offer { target: String, sdp: String },
    Answer { target: String, sdp: String },
    Ice { target: String, candidate: String },
}

async fn run_backend_loop(rx: &mut mpsc::UnboundedReceiver<AppCommand>) -> Result<()> {
    let host = cpal::default_host();
    let input_dev = host
        .default_input_device()
        .context("no default input device")?;
    let output_dev = host
        .default_output_device()
        .context("no default output device")?;

    let config_in: cpal::StreamConfig = input_dev
        .default_input_config()
        .context("input config")?
        .into();
    let config_out: cpal::StreamConfig = output_dev
        .default_output_config()
        .context("output config")?
        .into();

    let rb_mic = HeapRb::<f32>::new((SAMPLE_RATE as usize).max(1024));
    let (mut mic_prod, mut mic_cons) = rb_mic.split();

    let mixer_sources: Arc<Mutex<MixerMap>> = Arc::new(Mutex::new(HashMap::new()));
    let mixer_injector = mixer_sources.clone();

    let input_stream = input_dev
        .build_input_stream(
            &config_in,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = mic_prod.push_slice(data);
            },
            move |e| tracing::error!(error = %e, "audio input error"),
            None,
        )
        .context("build input stream")?;

    let mixer_lock = mixer_sources.clone();
    let output_stream = output_dev
        .build_output_stream(
            &config_out,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                data.fill(0.0);
                if let Ok(mut sources) = mixer_lock.lock() {
                    for (_, (consumer, vol)) in sources.iter_mut() {
                        for sample in data.iter_mut() {
                            if let Some(s) = consumer.try_pop() {
                                *sample += s * (*vol);
                            }
                        }
                    }
                }
                for s in data.iter_mut() {
                    *s = s.tanh();
                }
            },
            move |e| tracing::error!(error = %e, "audio output error"),
            None,
        )
        .context("build output stream")?;

    input_stream.play().context("play input")?;
    output_stream.play().context("play output")?;

    let mut m = MediaEngine::default();
    m.register_default_codecs().context("register codecs")?;
    let api = Arc::new(APIBuilder::new().with_media_engine(m).build());

    let local_track = Arc::new(TrackLocalStaticRTP::new(
        RTCRtpCodecCapability {
            mime_type: "audio/opus".to_owned(),
            ..Default::default()
        },
        "audio".to_owned(),
        "webrtc-rs".to_owned(),
    ));

    let track_clone = local_track.clone();
    thread::spawn(move || {
        let mut encoder = match Encoder::new(SAMPLE_RATE, Channels::Mono, Application::Voip) {
            Ok(enc) => enc,
            Err(e) => {
                tracing::error!(error = %e, "opus encoder failed");
                return;
            }
        };
        let mut pcm_buf = Vec::with_capacity(SAMPLES_PER_FRAME);
        let mut out_buf = [0u8; 1024];
        let mut sequence_num: u16 = 0;

        loop {
            while pcm_buf.len() < SAMPLES_PER_FRAME {
                if let Some(s) = mic_cons.try_pop() {
                    pcm_buf.push(s);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            }

            if let Ok(len) = encoder.encode_float(&pcm_buf, &mut out_buf) {
                let _ = track_clone.write_rtp(&webrtc::rtp::packet::Packet {
                    header: webrtc::rtp::header::Header {
                        payload_type: 111,
                        sequence_number: sequence_num,
                        timestamp: sequence_num as u32 * SAMPLES_PER_FRAME as u32,
                        ..Default::default()
                    },
                    payload: bytes::Bytes::copy_from_slice(&out_buf[..len]),
                });
                sequence_num = sequence_num.wrapping_add(1);
            }
            pcm_buf.clear();
        }
    });

    let mut peers: HashMap<String, Arc<RTCPeerConnection>> = HashMap::new();
    let mut ws_sender: Option<
        futures::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
            tokio_tungstenite::tungstenite::Message,
        >,
    > = None;

    let (sig_tx, mut sig_rx) = mpsc::unbounded_channel::<SignalMessage>();
    let (ws_in_tx, mut ws_in_rx) = mpsc::unbounded_channel::<String>();

    // Fallback su IP diretto per evitare problemi DNS/IPv6 in locale
    let ice_servers = match std::env::var("ICE_SERVERS") {
        Ok(val) => val.split(',').map(|s| RTCIceServer { urls: vec![s.trim().to_owned()], ..Default::default() }).collect(),
        Err(_) => vec![RTCIceServer {
            urls: vec!["stun:74.125.143.127:19302".to_string()],
            ..Default::default()
        }],
    };

    loop {
        tokio::select! {
            Some(cmd) = rx.recv() => {
                match cmd {
                    AppCommand::Join { server, room, name } => {
                        if let Ok(url) = url::Url::parse(&server) {
                            match tokio_tungstenite::connect_async(url).await {
                                Ok((ws, _)) => {
                                    let (write, mut read) = ws.split();
                                    ws_sender = Some(write);
                                    let tx_inner = ws_in_tx.clone();
                                    tokio::spawn(async move {
                                        while let Some(Ok(msg)) = read.next().await {
                                            if let tokio_tungstenite::tungstenite::Message::Text(t) = msg {
                                                let _ = tx_inner.send(t.to_string());
                                            }
                                        }
                                    });
                                    let _ = sig_tx.send(SignalMessage::Join{ room, name });
                                }
                                Err(e) => tracing::warn!(error = %e, "connect_async failed"),
                            }
                        }
                    }
                    AppCommand::SetVolume { peer_id, vol } => {
                        if let Ok(mut sources) = mixer_sources.lock() {
                            if let Some((_, v)) = sources.get_mut(&peer_id) { *v = vol; }
                        }
                    }
                }
            }
            Some(msg) = sig_rx.recv() => {
                if let Some(ws) = ws_sender.as_mut() {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let _ = ws.send(tokio_tungstenite::tungstenite::Message::Text(json)).await;
                    }
                }
            }
            Some(text) = ws_in_rx.recv() => {
               if let Ok(signal) = serde_json::from_str::<SignalMessage>(&text) {
                   handle_signal(signal, &mut peers, local_track.clone(), sig_tx.clone(), mixer_injector.clone(), &api, ice_servers.clone()).await?;
               }
            }
        }
    }
}

async fn handle_signal(
    signal: SignalMessage,
    peers: &mut HashMap<String, Arc<RTCPeerConnection>>,
    local_track: Arc<TrackLocalStaticRTP>,
    sig_tx: mpsc::UnboundedSender<SignalMessage>,
    mixer: Arc<Mutex<MixerMap>>,
    api: &Arc<webrtc::api::API>,
    ice_servers: Vec<RTCIceServer>,
) -> Result<()> {
    let create_pc = |pid: String| {
        let api = api.clone();
        let local_track = local_track.clone();
        let mixer = mixer.clone();
        let sig_tx = sig_tx.clone();
        let ice_servers = ice_servers.clone();

        async move {
            let config = RTCConfiguration {
                ice_servers,
                ..Default::default()
            };
            let pc = api
                .new_peer_connection(config)
                .await
                .context("create pc")?;
            let track_auth = local_track.clone() as Arc<dyn TrackLocal + Send + Sync>;
            pc.add_track(track_auth).await.context("add track")?;

            let p_id_track = pid.clone();
            let m = mixer.clone();
            pc.on_track(Box::new(move |track, _, _| {
                let p = p_id_track.clone();
                let m = m.clone();
                Box::pin(async move {
                    let rb = HeapRb::<f32>::new(SAMPLE_RATE as usize * 2);
                    let (mut prod, cons) = rb.split();

                    if let Ok(mut sources) = m.lock() {
                        sources.insert(p.clone(), (cons, 1.0));
                    }

                    let mut decoder = match Decoder::new(SAMPLE_RATE, Channels::Mono) {
                        Ok(d) => d,
                        Err(e) => {
                            tracing::error!(error = %e, "opus decoder failed");
                            return;
                        }
                    };
                    let mut pcm = vec![0f32; 1920];

                    while let Ok((rtp_packet, _)) = track.read_rtp().await {
                        if let Ok(samples) =
                            decoder.decode_float(&rtp_packet.payload, &mut pcm, false)
                        {
                            let _ = prod.push_slice(&pcm[..samples]);
                        }
                    }

                    if let Ok(mut sources) = m.lock() {
                        sources.remove(&p);
                    }
                })
            }));

            let sig_tx_c = sig_tx.clone();
            let p_id_ice = pid.clone();
            pc.on_ice_candidate(Box::new(move |c| {
                let tx = sig_tx_c.clone();
                let p = p_id_ice.clone();
                Box::pin(async move {
                    if let Some(c) = c {
                        if let Ok(j) = c.to_json() {
                            let _ = tx.send(SignalMessage::Ice {
                                target: p,
                                candidate: serde_json::to_string(&j).unwrap(),
                            });
                        }
                    }
                })
            }));

            Ok::<Arc<RTCPeerConnection>, anyhow::Error>(Arc::new(pc))
        }
    };

    match signal {
        SignalMessage::PeerList {
            peers: remote_peers,
        } => {
            for pid in remote_peers {
                let pc = create_pc(pid.clone()).await?;
                let offer = pc.create_offer(None).await.context("create offer")?;
                pc.set_local_description(offer.clone())
                    .await
                    .context("set local desc")?;
                let _ = sig_tx.send(SignalMessage::Offer {
                    target: pid.clone(),
                    sdp: serde_json::to_string(&offer).unwrap(),
                });
                peers.insert(pid, pc);
            }
        }
        SignalMessage::Offer { target, sdp } => {
            let pc = create_pc(target.clone()).await?;
            let offer = serde_json::from_str(&sdp).context("parse offer")?;
            pc.set_remote_description(offer)
                .await
                .context("set remote desc")?;
            let answer = pc.create_answer(None).await.context("create answer")?;
            pc.set_local_description(answer.clone())
                .await
                .context("set local desc")?;
            let _ = sig_tx.send(SignalMessage::Answer {
                target: target.clone(),
                sdp: serde_json::to_string(&answer).unwrap(),
            });
            peers.insert(target, pc);
        }
        SignalMessage::Answer { target, sdp } => {
            if let Some(pc) = peers.get(&target) {
                let answer = serde_json::from_str(&sdp).context("parse answer")?;
                let _ = pc.set_remote_description(answer).await;
            }
        }
        SignalMessage::Ice { target, candidate } => {
            if let Some(pc) = peers.get(&target) {
                if let Ok(ice) = serde_json::from_str(&candidate) {
                    let _ = pc.add_ice_candidate(ice).await;
                }
            }
        }
        _ => {}
    }

    Ok(())
}