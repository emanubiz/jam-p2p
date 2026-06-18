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
use opus::{Application, Bitrate, Channels, Encoder};
use ::webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use ::webrtc::track::track_local::TrackLocalWriter;
use std::panic::{catch_unwind, AssertUnwindSafe};
use tauri::{AppHandle, Emitter};

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

/// Opus-supported sample rates, highest first (we prefer 48 kHz).
pub const OPUS_SAMPLE_RATES: [u32; 5] = [48_000, 24_000, 16_000, 12_000, 8_000];

/// Collect (min, max) sample-rate ranges that advertise f32 support.
fn collect_f32_rate_ranges<I>(configs: I) -> Vec<(u32, u32)>
where
    I: Iterator<Item = cpal::SupportedStreamConfigRange>,
{
    configs
        .filter(|c| c.sample_format() == cpal::SampleFormat::F32)
        .map(|c| (c.min_sample_rate().0, c.max_sample_rate().0))
        .collect()
}

/// Highest Opus-valid sample rate supported by BOTH range sets, or None.
///
/// Opus only accepts 8/12/16/24/48 kHz. Encoder, decoder, and both audio
/// streams must agree on one rate, otherwise Opus init fails outright or
/// playback is pitch-shifted by an input/output rate mismatch.
pub fn pick_common_opus_rate(in_ranges: &[(u32, u32)], out_ranges: &[(u32, u32)]) -> Option<u32> {
    OPUS_SAMPLE_RATES.iter().copied().find(|&r| {
        in_ranges.iter().any(|&(min, max)| r >= min && r <= max)
            && out_ranges.iter().any(|&(min, max)| r >= min && r <= max)
    })
}

pub fn init_audio() -> Result<AudioDevice> {
    let host = cpal::default_host();
    let input_dev = host.default_input_device().context("no input device")?;
    let output_dev = host.default_output_device().context("no output device")?;

    // Force a single Opus-compatible rate shared by input, output, encoder and
    // decoder. Picking the device default (often 44.1 kHz) silently breaks Opus.
    let in_ranges = collect_f32_rate_ranges(input_dev.supported_input_configs()?);
    let out_ranges = collect_f32_rate_ranges(output_dev.supported_output_configs()?);
    let sample_rate = pick_common_opus_rate(&in_ranges, &out_ranges).context(
        "no Opus-compatible f32 sample rate (8/12/16/24/48 kHz) supported by both input and output devices",
    )?;

    let in_channels: usize = input_dev.default_input_config()?.channels() as usize;
    let out_channels: usize = output_dev.default_output_config()?.channels() as usize;
    let samples_per_frame: usize = (sample_rate as usize * FRAME_SIZE_MS) / 1000;

    let config_in = cpal::StreamConfig {
        channels: in_channels as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };
    let config_out = cpal::StreamConfig {
        channels: out_channels as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

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
            // Real-time callback: never block. If the mixer map is being
            // mutated elsewhere, output the silence we already filled in.
            if let Ok(mut sources) = mixer_injector.try_lock() {
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
    sample_rate: u32,
    samples_per_frame: usize,
    opus_bitrate: Arc<AtomicI32>,
    handle: AppHandle,
) -> EncoderHandle {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    thread::spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
        let mut encoder = match Encoder::new(sample_rate, Channels::Mono, Application::Voip) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("Failed to create Opus encoder: {:?}", e);
                return;
            }
        };
        let _ = encoder.set_bitrate(Bitrate::Bits(DEFAULT_OPUS_BITRATE));
        let mut pcm_buf = Vec::with_capacity(samples_per_frame);
        let mut out_buf = [0u8; 1024];
        let mut seq: u16 = 0;
        let mut timestamp: u32 = 0;
        let mut prev_level = 0.0f32;
        let mut last_emit = std::time::Instant::now();
        let mut cached_bitrate = DEFAULT_OPUS_BITRATE;

        loop {
            if *shutdown_rx.borrow() {
                tracing::info!("Encoder thread shutting down");
                break;
            }

            // Clamp to Opus' usable range; the UI sends bits/s and a stray
            // value (e.g. raw kbps) must not wedge the encoder at the minimum.
            let br = opus_bitrate.load(Ordering::Relaxed).clamp(8_000, 256_000);
            if br != cached_bitrate {
                let _ = encoder.set_bitrate(Bitrate::Bits(br));
                cached_bitrate = br;
            }
            // Fill one frame straight from the mic ring buffer. No mixer lock
            // here — that lock is shared with the real-time output callback,
            // and holding it per-sample starved playback.
            while pcm_buf.len() < samples_per_frame {
                if *shutdown_rx.borrow() {
                    return;
                }
                if let Some(s) = mic_cons.try_pop() {
                    pcm_buf.push(s);
                } else {
                    thread::sleep(Duration::from_millis(1));
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

                let level = compute_audio_level(&pcm_buf, prev_level);
                prev_level = level;
                if last_emit.elapsed().as_millis() >= crate::config::VU_THROTTLE_MS {
                    let _ = handle.emit("local-level", serde_json::json!({"level": level}));
                    last_emit = std::time::Instant::now();
                }

                seq = seq.wrapping_add(1);
                timestamp = timestamp.wrapping_add(samples_per_frame as u32);
            }
            pcm_buf.clear();
        }
        }));
        if let Err(panic) = result {
            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown cause".to_string()
            };
            tracing::error!("Encoder thread panicked: {}", msg);
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
        // EMA with prev_level=0: 0.3 * 1.0 + 0.7 * 0.0 = 0.3
        assert!(
            (level - 0.3).abs() < 0.01,
            "expected ~0.3 (EMA from 0), got {}",
            level
        );
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

    #[test]
    fn test_alternating_signal() {
        let samples: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 }).collect();
        let level = compute_audio_level(&samples, 0.0);
        assert!(
            level > 0.01,
            "alternating signal should produce non-zero level"
        );
        assert!(
            level < 0.99,
            "alternating signal should not be near max"
        );
    }

    #[test]
    fn test_alternating_full_scale() {
        // Alternating +1.0/-1.0 has same RMS as constant 1.0
        let samples: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let level = compute_audio_level(&samples, 0.0);
        assert!(
            (level - 0.3).abs() < 0.01,
            "alternating +/-1 should give ~0.3, got {}",
            level
        );
    }

    #[test]
    fn test_ema_convergence_steady_state() {
        // With constant input, EMA should converge to steady state = norm
        let samples = vec![0.3f32; 100];
        let mut prev = compute_audio_level(&samples, 0.0);
        for _ in 0..50 {
            let next = compute_audio_level(&samples, prev);
            let delta = (next - prev).abs();
            assert!(delta < 0.18, "EMA delta should shrink, got {}", delta);
            prev = next;
        }
        // Verify near steady state
        let next = compute_audio_level(&samples, prev);
        assert!(
            (next - prev).abs() < 0.001,
            "EMA should converge to steady state"
        );
    }

    #[test]
    fn test_ema_decay_to_silence() {
        // From high prev_level, EMA should exponentially decay toward 0 on silence
        let silence = vec![0.0f32; 100];
        let mut level = 0.8f32;
        for _ in 0..20 {
            level = compute_audio_level(&silence, level);
        }
        // 0.8 * (1-α)^20 = 0.8 * 0.7^20 ≈ 0.00064
        assert!(level < 0.01, "EMA should decay to near 0, got {}", level);
    }

    #[test]
    fn test_ema_rise_to_full() {
        // From 0, EMA should exponentially rise toward steady state of 1.0
        let full = vec![1.0f32; 100];
        let mut level = 0.0f32;
        for _ in 0..20 {
            level = compute_audio_level(&full, level);
        }
        // 1.0 - 0.7^20 ≈ 0.9992
        assert!(
            level > 0.99,
            "EMA should converge near 1.0, got {}",
            level
        );
    }

    #[test]
    fn test_clipping_max_amplitude() {
        // Values > 1.0 simulate clipping — norm clamps to [0, 1]
        let samples = vec![2.0f32; 100];
        let level = compute_audio_level(&samples, 0.0);
        assert!(
            (0.0..=1.0).contains(&level),
            "clipped level must be in [0,1], got {}",
            level
        );
        // RMS=2.0 → dB≈6.02 → norm=1.1003 → clamped to 1.0 → EMA→0.3
        assert!(
            (level - 0.3).abs() < 0.01,
            "clipped(2.0) with prev=0 should be ~0.3, got {}",
            level
        );
    }

    #[test]
    fn test_short_buffer() {
        let samples = vec![0.5f32; 1];
        let level = compute_audio_level(&samples, 0.0);
        assert!(!level.is_nan(), "single sample should not produce NaN");
        assert!(
            level > 0.0,
            "single sample should produce positive level"
        );
    }

    #[test]
    fn test_short_buffer_two_samples() {
        let level = compute_audio_level(&[0.25f32, 0.75f32], 0.0);
        assert!(!level.is_nan());
        assert!((0.0..=1.0).contains(&level));
    }

    #[test]
    fn test_short_buffer_mixed_polarity() {
        let level = compute_audio_level(&[-0.5f32, 0.0f32, 0.5f32], 0.0);
        assert!(!level.is_nan());
        assert!((0.0..=1.0).contains(&level));
    }

    #[test]
    fn test_very_quiet_signal() {
        let samples = vec![1e-6f32; 100];
        let level = compute_audio_level(&samples, 0.0);
        assert!(
            level < 0.01,
            "very quiet signal should produce near-zero level"
        );
    }

    #[test]
    fn test_infinity_safety() {
        let samples = vec![f32::INFINITY; 100];
        let level = compute_audio_level(&samples, 0.0);
        assert!(
            level.is_finite(),
            "infinity input should not cause NaN/inf"
        );
        assert!(
            level >= 0.0 && level <= 1.0,
            "level must be in [0,1] range"
        );
    }

    #[test]
    fn test_extreme_values() {
        // Very tiny signal
        let level = compute_audio_level(&[1e-10f32; 100], 0.0);
        assert!((0.0..=1.0).contains(&level));

        // Very huge signal
        let level = compute_audio_level(&[1e10f32; 100], 0.0);
        assert!((0.0..=1.0).contains(&level));
    }

    #[test]
    fn test_ema_order_preserving() {
        // Higher prev_level should produce higher result for same input
        let samples = vec![0.3f32; 50];
        let level_low = compute_audio_level(&samples, 0.0);
        let level_high = compute_audio_level(&samples, 0.5);
        assert!(
            level_high >= level_low,
            "higher prev_level should preserve ordering"
        );
    }

    #[test]
    fn test_pick_rate_prefers_48k() {
        // Device advertises a wide range covering everything → prefer 48 kHz.
        let r = pick_common_opus_rate(&[(8_000, 48_000)], &[(8_000, 48_000)]);
        assert_eq!(r, Some(48_000));
    }

    #[test]
    fn test_pick_rate_skips_unsupported_44100() {
        // A 44.1 kHz-only device has no Opus-valid rate → None (clear failure,
        // not a silent broken encoder).
        let r = pick_common_opus_rate(&[(44_100, 44_100)], &[(44_100, 44_100)]);
        assert_eq!(r, None);
    }

    #[test]
    fn test_pick_rate_intersection() {
        // Input tops out at 24 kHz, output supports 48 kHz too → common max is 24 kHz.
        let r = pick_common_opus_rate(&[(16_000, 24_000)], &[(8_000, 48_000)]);
        assert_eq!(r, Some(24_000));
    }

    #[test]
    fn test_pick_rate_no_overlap() {
        // Input only 8 kHz, output only 48 kHz → no shared Opus rate.
        let r = pick_common_opus_rate(&[(8_000, 8_000)], &[(48_000, 48_000)]);
        assert_eq!(r, None);
    }

    #[test]
    fn test_pick_rate_empty_ranges() {
        assert_eq!(pick_common_opus_rate(&[], &[(8_000, 48_000)]), None);
        assert_eq!(pick_common_opus_rate(&[(8_000, 48_000)], &[]), None);
    }

    #[test]
    fn test_zero_length_buffer() {
        let samples: Vec<f32> = vec![];
        let level = compute_audio_level(&samples, 0.0);
        assert!(!level.is_nan(), "empty buffer should not produce NaN");
        assert!(
            (0.0..=1.0).contains(&level),
            "empty buffer level should be in [0,1]"
        );
    }
}
