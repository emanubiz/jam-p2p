use anyhow::{Context, Result};
use opus::{Channels, Decoder};
use ringbuf::{traits::Producer, HeapRb};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::mpsc;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;

use crate::audio::{compute_audio_level, MixerMap};
use crate::config::RING_BUFFER_SIZE_MULT;
use crate::messages::SignalMessage;

pub struct WebrtcContext {
    pub api: Arc<webrtc::api::API>,
    pub ice_servers: Vec<RTCIceServer>,
    pub local_track: Arc<TrackLocalStaticRTP>,
    pub mixer: Arc<Mutex<MixerMap>>,
    pub sig_tx: mpsc::UnboundedSender<SignalMessage>,
    pub handle: tauri::AppHandle,
    pub sample_rate: u32,
    pub samples_per_frame: usize,
}

pub struct PeerManager {
    peers: HashMap<String, Arc<RTCPeerConnection>>,
}

impl PeerManager {
    pub fn new() -> Self {
        PeerManager {
            peers: HashMap::new(),
        }
    }

    pub async fn handle_signal(
        &mut self,
        signal: SignalMessage,
        my_id: &mut Option<String>,
        ctx: &WebrtcContext,
    ) -> Result<()> {
        match signal {
            SignalMessage::Welcome { uuid } => {
                *my_id = Some(uuid);
            }
            SignalMessage::Join { .. } => {}
            SignalMessage::PeerList {
                peers: remote_peers,
            } => {
                for pid in remote_peers {
                    if self.peers.contains_key(&pid) {
                        continue;
                    }
                    let pc = self.create_peer_connection(pid.clone(), ctx).await?;
                    let offer = pc.create_offer(None).await?;
                    pc.set_local_description(offer.clone()).await?;
                    let sdp = serde_json::to_string(&offer).context("failed to serialize offer")?;
                    let _ = ctx.sig_tx.send(SignalMessage::Offer {
                        target: pid.clone(),
                        sdp,
                        from: None,
                    });
                    self.peers.insert(pid, pc);
                }
            }
            SignalMessage::NewPeer { uuid: pid } => {
                if self.peers.contains_key(&pid) {
                    return Ok(());
                }
                let pc = self.create_peer_connection(pid.clone(), ctx).await?;
                let offer = pc.create_offer(None).await?;
                pc.set_local_description(offer.clone()).await?;
                let sdp = serde_json::to_string(&offer).context("failed to serialize offer")?;
                let _ = ctx.sig_tx.send(SignalMessage::Offer {
                    target: pid.clone(),
                    sdp,
                    from: None,
                });
                self.peers.insert(pid, pc);
            }
            SignalMessage::PeerLeft { uuid: pid } => {
                if let Some(pc) = self.peers.remove(&pid) {
                    let _ = pc.close();
                    let _ = ctx.handle.emit("peer-left", pid);
                }
            }
            SignalMessage::Offer { sdp, from, .. } => {
                if let Some(pid) = from {
                    if self.peers.contains_key(&pid) {
                        return Ok(());
                    }
                    let pc = self.create_peer_connection(pid.clone(), ctx).await?;
                    pc.set_remote_description(serde_json::from_str(&sdp)?)
                        .await?;
                    let answer = pc.create_answer(None).await?;
                    pc.set_local_description(answer.clone()).await?;
                    let sdp =
                        serde_json::to_string(&answer).context("failed to serialize answer")?;
                    let _ = ctx.sig_tx.send(SignalMessage::Answer {
                        target: pid.clone(),
                        sdp,
                        from: None,
                    });
                    self.peers.insert(pid, pc);
                }
            }
            SignalMessage::Answer { sdp, from, .. } => {
                if let Some(pid) = from {
                    if let Some(pc) = self.peers.get(&pid) {
                        pc.set_remote_description(serde_json::from_str(&sdp)?)
                            .await?;
                    }
                }
            }
            SignalMessage::Ice {
                candidate, from, ..
            } => {
                if let Some(pid) = from {
                    if let Some(pc) = self.peers.get(&pid) {
                        let _ = pc
                            .add_ice_candidate(serde_json::from_str(&candidate)?)
                            .await;
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn close_all(&mut self, handle: &tauri::AppHandle) {
        for (pid, pc) in self.peers.drain() {
            tracing::info!("Closing peer connection: {}", pid);
            let _ = pc.close();
        }
    }

    async fn create_peer_connection(
        &self,
        pid: String,
        ctx: &WebrtcContext,
    ) -> Result<Arc<RTCPeerConnection>> {
        let config = RTCConfiguration {
            ice_servers: ctx.ice_servers.clone(),
            ..Default::default()
        };
        let pc = ctx.api.new_peer_connection(config).await?;
        let track_auth = ctx.local_track.clone() as Arc<dyn TrackLocal + Send + Sync>;
        pc.add_track(track_auth).await?;

        let h_state_pc = ctx.handle.clone();
        let p_state = pid.clone();
        pc.on_peer_connection_state_change(Box::new(move |s| {
            let h_emit = h_state_pc.clone();
            let p_clone = p_state.clone();
            Box::pin(async move {
                match s {
                    webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Connected => {
                        tracing::info!("Peer {} connected", p_clone);
                        let _ = h_emit.emit("peer-joined", p_clone.clone());
                    }
                    webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Disconnected => {
                        tracing::info!("Peer {} disconnected", p_clone);
                        let _ = h_emit.emit("peer-left", p_clone.clone());
                    }
                    webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState::Failed => {
                        tracing::warn!("Peer {} connection failed", p_clone);
                    }
                    _ => {}
                }
            })
        }));

        let mixer_clone = ctx.mixer.clone();
        let peer_id_clone = pid.clone();
        let handle_clone = ctx.handle.clone();
        let sample_rate = ctx.sample_rate;
        let samples_per_frame = ctx.samples_per_frame;
        pc.on_track(Box::new(move |track, _, _| {
            let mixer_inner = mixer_clone.clone();
            let p_inner = peer_id_clone.clone();
            let h_emit = handle_clone.clone();
            Box::pin(async move {
                tracing::info!("Received track from peer {}", p_inner);
                let rb = HeapRb::<f32>::new(sample_rate as usize * RING_BUFFER_SIZE_MULT);
                let (mut prod, cons) = rb.split();
                if let Ok(mut s) = mixer_inner.lock() {
                    s.insert(p_inner.clone(), (cons, 1.0));
                }
                let mut dec = match Decoder::new(sample_rate, Channels::Mono) {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::error!("Failed to create Opus decoder: {:?}", e);
                        return;
                    }
                };
                let mut pcm = vec![0f32; samples_per_frame * 2];
                let mut prev_level: f32 = 0.0f32;
                while let Ok((rtp, _)) = track.read_rtp().await {
                    if let Ok(len) = dec.decode_float(&rtp.payload, &mut pcm, false) {
                        let samples = &pcm[..len];
                        let _ = prod.push_slice(samples);
                        prev_level = compute_audio_level(samples, prev_level);
                        let _ = h_emit.emit(
                            "peer-level",
                            serde_json::json!({ "id": p_inner, "level": prev_level }),
                        );
                    }
                }
                tracing::info!("Track from peer {} ended", p_inner);
                if let Ok(mut s) = mixer_inner.lock() {
                    s.remove(&p_inner);
                }
            })
        }));

        let tx_ice = ctx.sig_tx.clone();
        let p_ice = pid.clone();
        pc.on_ice_candidate(Box::new(move |c| {
            let tx = tx_ice.clone();
            let p = p_ice.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    if let Ok(j) = c.to_json() {
                        if let Ok(candidate) = serde_json::to_string(&j) {
                            let _ = tx.send(SignalMessage::Ice {
                                target: p,
                                candidate,
                                from: None,
                            });
                        } else {
                            tracing::warn!("Failed to serialize ICE candidate for peer {}", p);
                        }
                    }
                }
            })
        }));

        Ok(Arc::new(pc))
    }
}
