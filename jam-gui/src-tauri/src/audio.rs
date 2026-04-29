use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapRb,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tokio::sync::watch;

use crate::config::{DEFAULT_OPUS_BITRATE, FRAME_SIZE_MS, RING_BUFFER_SIZE_MULT, RTP_PAYLOAD_TYPE};
use opus::{Application, Channels, Encoder};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;

pub type MixerMap = HashMap<String, (HeapCons<f32>, f32)>;

pub struct AudioDevice {
    pub sample_rate: u32,
    pub in_channels: usize,
    pub out_channels: usize,
    pub samples_per_frame: usize,
    _input_stream: cpal::Stream,
    _output_stream: cpal::Stream,
    pub mic_consumer: HeapCons<f32>,
    pub mixer_sources: Arc<Mutex<MixerMap>>,
}

pub fn init_audio() -> Result<AudioDevice> {
    let host = cpal::default_host();
    let input_dev = host.default_input_device().context("no input device")?;
    let output_dev = host.default_output_device().context("no output device")?;
    let config_in: cpal::StreamConfig = input_dev.default_input_config()?.into();
    let config_out: cpal::StreamConfig = output_dev.default_output_config()?.into();

    let sample_rate: u32 = config_in.sample_rate.0;
    let in_channels: usize = config_in.channels as usize;
    let out_channels: usize = config_out.channels as usize;
    let samples_per_frame: usize = (sample_rate as usize * FRAME_SIZE_MS) / 1000;

    let rb_mic = HeapRb::<f32>::new(sample_rate as usize * RING_BUFFER_SIZE_MULT);
    let (mut mic_prod, mic_cons) = rb_mic.split();
    let mixer_sources: Arc<Mutex<MixerMap>> = Arc::new(Mutex::new(HashMap::new()));
    let mixer_injector = mixer_sources.clone();

    let input_stream = input_dev.build_input_stream(
        &config_in,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            if in_channels == 1 {
                let _ = mic_prod.push_slice(data);
            } else {
                let mut mono: Vec<f32> = Vec::with_capacity(data.len() / in_channels);
                for chunk in data.chunks(in_channels) {
                    let mut s = 0.0f32;
                    for &c in chunk {
                        s += c;
                    }
                    mono.push(s / (in_channels as f32));
                }
                let _ = mic_prod.push_slice(&mono);
            }
        },
        |err| {
            tracing::error!("Input stream error: {:?}", err);
        },
        None,
    )?;

    let output_stream = output_dev.build_output_stream(
        &config_out,
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            data.fill(0.0);
            let frames = if out_channels > 0 {
                data.len() / out_channels
            } else {
                0
            };
            if let Ok(mut sources) = mixer_injector.lock() {
                for frame in 0..frames {
                    let mut mixed = 0.0f32;
                    for (_, (consumer, vol)) in sources.iter_mut() {
                        if let Some(s) = consumer.try_pop() {
                            mixed += s * (*vol);
                        }
                    }
                    let m = mixed.tanh();
                    for ch in 0..out_channels {
                        data[frame * out_channels + ch] = m;
                    }
                }
            }
        },
        |err| {
            tracing::error!("Output stream error: {:?}", err);
        },
        None,
    )?;

    input_stream.play()?;
    output_stream.play()?;

    Ok(AudioDevice {
        sample_rate,
        in_channels,
        out_channels,
        samples_per_frame,
        _input_stream: input_stream,
        _output_stream: output_stream,
        mic_consumer: mic_cons,
        mixer_sources,
    })
}

pub struct EncoderHandle {
    shutdown_tx: watch::Sender<bool>,
}

impl EncoderHandle {
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

pub fn start_encoder_thread(
    track: Arc<TrackLocalStaticRTP>,
    mut mic_cons: HeapCons<f32>,
    mixer_sources: Arc<Mutex<MixerMap>>,
    sample_rate: u32,
    samples_per_frame: usize,
    opus_bitrate: Arc<AtomicI32>,
) -> EncoderHandle {
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    thread::spawn(move || {
        let mut encoder = match Encoder::new(sample_rate, Channels::Mono, Application::Voip) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("Failed to create Opus encoder: {:?}", e);
                return;
            }
        };
        let _ = encoder.set_bitrate(DEFAULT_OPUS_BITRATE);
        let mut pcm_buf = Vec::with_capacity(samples_per_frame);
        let mut out_buf = [0u8; 1024];
        let mut seq: u16 = 0;
        let mut timestamp: u32 = 0;

        loop {
            if *shutdown_rx.borrow() {
                tracing::info!("Encoder thread shutting down");
                break;
            }

            if let Ok(br) = opus_bitrate.load(Ordering::Relaxed) {
                let _ = encoder.set_bitrate(br);
            }
            while pcm_buf.len() < samples_per_frame {
                if *shutdown_rx.borrow() {
                    return;
                }
                if let Ok(sources) = mixer_sources.lock() {
                    let peer_count = sources.len();
                    if peer_count == 0 {
                        if let Some(s) = mic_cons.pop() {
                            pcm_buf.push(s);
                            while pcm_buf.len() < samples_per_frame {
                                if let Some(s) = mic_cons.pop() {
                                    pcm_buf.push(s);
                                } else {
                                    break;
                                }
                            }
                        } else {
                            thread::sleep(Duration::from_millis(1));
                        }
                    } else {
                        if let Some(s) = mic_cons.pop() {
                            pcm_buf.push(s);
                        }
                    }
                }
            }
            if let Ok(len) = encoder.encode_float(&pcm_buf, &mut out_buf) {
                let _ = track.write_rtp(&webrtc::rtp::packet::Packet {
                    header: webrtc::rtp::header::Header {
                        payload_type: RTP_PAYLOAD_TYPE,
                        sequence_number: seq,
                        timestamp,
                        ..Default::default()
                    },
                    payload: bytes::Bytes::copy_from_slice(&out_buf[..len]),
                });
                seq = seq.wrapping_add(1);
                timestamp = timestamp.wrapping_add(samples_per_frame as u32);
            }
            pcm_buf.clear();
        }
    });

    EncoderHandle { shutdown_tx }
}

pub fn compute_audio_level(samples: &[f32], prev_level: f32) -> f32 {
    let mut sum_sq = 0.0f32;
    for &v in samples {
        sum_sq += v * v;
    }
    let rms = (sum_sq / (samples.len() as f32)).sqrt();
    let db = 20.0f32 * (rms.max(1e-12f32)).log10();
    let mut norm = (db + 60.0f32) / 60.0f32;
    if norm.is_nan() || norm.is_infinite() {
        norm = 0.0;
    }
    norm = norm.clamp(0.0, 1.0);
    crate::config::EMA_ALPHA * norm + (1.0 - crate::config::EMA_ALPHA) * prev_level
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_audio_level_silence() {
        let samples = vec![0.0f32; 100];
        let level = compute_audio_level(&samples, 0.0);
        assert!(level < 0.01);
    }

    #[test]
    fn test_compute_audio_level_full_scale() {
        let samples = vec![1.0f32; 100];
        let level = compute_audio_level(&samples, 0.0);
        assert!(level > 0.9);
    }

    #[test]
    fn test_compute_audio_level_ema_smoothing() {
        let samples = vec![0.5f32; 100];
        let level1 = compute_audio_level(&samples, 0.0);
        let level2 = compute_audio_level(&samples, level1);
        assert!(level2 >= level1);
    }

    #[test]
    fn test_compute_audio_level_nan_safety() {
        let samples = vec![f32::NAN; 100];
        let level = compute_audio_level(&samples, 0.5);
        assert!(!level.is_nan());
    }
}
