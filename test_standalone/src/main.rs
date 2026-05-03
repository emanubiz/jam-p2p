const EMA_ALPHA: f32 = 0.3;

fn compute_audio_level(samples: &[f32], prev_level: f32) -> f32 {
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
    EMA_ALPHA * norm + (1.0 - EMA_ALPHA) * prev_level
}

fn main() {
    // Silence test
    let samples = vec![0.0f32; 100];
    let level = compute_audio_level(&samples, 0.0);
    println!("silence: {}", level);
    assert!(level < 0.01, "silence level should be near 0, got {}", level);

    // Full scale test
    let samples = vec![1.0f32; 100];
    let level = compute_audio_level(&samples, 0.0);
    println!("full scale: {}", level);
    assert!(level > 0.0, "full scale should be > 0");

    // Alternating signal test
    let samples: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
    let level = compute_audio_level(&samples, 0.0);
    println!("alternating (+1/-1): {}", level);
    // Alternating +/-1.0 has same RMS as constant 1.0: sqrt(1.0) = 1.0
    let expected = 0.3; // EMA_ALPHA * 1.0 + (1-EMA_ALPHA) * 0.0
    assert!((level - expected).abs() < 0.01, "alternating level should be ~{}, got {}", expected, level);

    // EMA convergence - silence from high prev_level
    let silent = vec![0.0f32; 100];
    let mut level = 0.8f32;
    for _ in 0..20 {
        level = compute_audio_level(&silent, level);
    }
    println!("ema decay from 0.8 to silence (20 iters): {}", level);
    // After 20 iters: 0.8 * 0.7^20 ≈ 0.00064
    assert!(level < 0.01, "ema should decay to near 0, got {}", level);

    // EMA convergence - full scale from 0
    let full = vec![1.0f32; 100];
    let mut level = 0.0f32;
    for _ in 0..20 {
        level = compute_audio_level(&full, level);
    }
    println!("ema rise from 0 to full (20 iters): {}", level);
    // After 20 iters: 1.0 - 0.7^20 ≈ 0.9992
    assert!(level > 0.99, "ema should converge near 1.0, got {}", level);

    // Clipping test (samples > 1.0)
    let samples = vec![2.0f32; 100];
    let level = compute_audio_level(&samples, 0.0);
    println!("clipped (2.0): {}", level);
    assert!(level >= 0.0 && level <= 1.0, "clipped level must be in [0,1]");
    // RMS = 2.0, dB = 6.02, norm = 1.1003, clamped to 1.0, level = 0.3
    assert!((level - 0.3).abs() < 0.01, "clipped level should be ~0.3, got {}", level);

    // Short buffer - 1 sample
    let level = compute_audio_level(&[0.5f32], 0.0);
    println!("short buffer (1 sample): {}", level);
    assert!(!level.is_nan(), "level should not be NaN");
    assert!(level >= 0.0 && level <= 1.0, "level must be in [0,1]");

    // Short buffer - 2 samples
    let level = compute_audio_level(&[0.25f32, 0.75f32], 0.0);
    println!("short buffer (2 samples): {}", level);
    assert!(!level.is_nan(), "level should not be NaN");
    assert!(level >= 0.0 && level <= 1.0, "level must be in [0,1]");

    // NaN safety
    let samples = vec![f32::NAN; 100];
    let level = compute_audio_level(&samples, 0.5);
    println!("nan safety: {}", level);
    assert!(!level.is_nan(), "level should not be NaN even with NaN inputs");

    // Extreme values - tiny signal
    let samples = vec![1e-10f32; 100];
    let level = compute_audio_level(&samples, 0.0);
    println!("tiny signal (1e-10): {}", level);
    assert!(level >= 0.0 && level <= 1.0, "tiny level must be in [0,1]");

    // Extreme values - huge signal
    let samples = vec![1e10f32; 100];
    let level = compute_audio_level(&samples, 0.0);
    println!("huge signal (1e10): {}", level);
    assert!(level >= 0.0 && level <= 1.0, "huge level must be in [0,1]");

    // Empty buffer edge case
    let level = compute_audio_level(&[], 0.5);
    println!("empty buffer: {}", level);
    assert!(!level.is_nan(), "empty buffer should not cause NaN");
    assert!(level >= 0.0 && level <= 1.0, "empty buffer level must be in [0,1]");

    println!("\n=== All {} tests passed! ===", 13);
}
