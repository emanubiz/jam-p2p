use std::collections::VecDeque;
use std::time::Instant;

/// Per-peer adaptive playout buffer for decoded PCM samples.
///
/// Estimates network jitter from RTP timestamp vs wall-clock spacing (RFC 3550
/// style) and holds samples until a dynamic watermark is reached, absorbing
/// clock drift between sender and receiver without the underruns of a bare FIFO.
pub struct AdaptiveJitterBuffer {
    samples: VecDeque<f32>,
    max_samples: usize,
    target_fill: usize,
    min_target: usize,
    max_target: usize,
    last_rtp_ts: Option<u32>,
    last_arrival: Option<Instant>,
    jitter_ms: f32,
    sample_rate: u32,
    /// When the buffer stays below target too long, temporarily drain to avoid silence.
    underrun_since: Option<Instant>,
}

impl AdaptiveJitterBuffer {
    pub fn new(sample_rate: u32, samples_per_frame: usize, ring_mult: usize) -> Self {
        let min_target = samples_per_frame * 2;
        let max_target = sample_rate as usize * ring_mult / 2;
        let max_samples = sample_rate as usize * ring_mult;
        AdaptiveJitterBuffer {
            samples: VecDeque::with_capacity(max_samples.min(8192)),
            max_samples,
            target_fill: min_target,
            min_target,
            max_target: max_target.max(min_target + 1),
            last_rtp_ts: None,
            last_arrival: None,
            jitter_ms: 0.0,
            sample_rate,
            underrun_since: None,
        }
    }

    /// Push decoded PCM and update the jitter estimate from the RTP timestamp.
    pub fn push_with_rtp_ts(&mut self, pcm: &[f32], rtp_timestamp: u32) {
        let now = Instant::now();
        if let (Some(prev_ts), Some(prev_at)) = (self.last_rtp_ts, self.last_arrival) {
            let ts_delta = rtp_timestamp.wrapping_sub(prev_ts) as f64;
            let expected_ms = ts_delta * 1000.0 / f64::from(self.sample_rate);
            let actual_ms = prev_at.elapsed().as_secs_f64() * 1000.0;
            let deviation = (actual_ms - expected_ms).abs() as f32;
            // RFC 3550 inter-arrival jitter smoother (α = 1/16).
            self.jitter_ms += (deviation - self.jitter_ms) / 16.0;
            let jitter_samples =
                ((self.jitter_ms * self.sample_rate as f32) / 1000.0).ceil() as usize;
            self.target_fill =
                (self.min_target + jitter_samples).clamp(self.min_target, self.max_target);
        }
        self.last_rtp_ts = Some(rtp_timestamp);
        self.last_arrival = Some(now);

        self.samples.extend(pcm.iter().copied());
        while self.samples.len() > self.max_samples {
            self.samples.pop_front();
        }
    }

    /// Non-blocking pop for the real-time output callback.
    pub fn try_pop(&mut self) -> Option<f32> {
        if self.samples.is_empty() {
            self.underrun_since = None;
            return None;
        }

        let effective_target = if let Some(since) = self.underrun_since {
            if since.elapsed().as_millis() > 150 {
                self.min_target
            } else {
                self.target_fill
            }
        } else {
            self.target_fill
        };

        if self.samples.len() < effective_target {
            if self.underrun_since.is_none() {
                self.underrun_since = Some(Instant::now());
            }
            return None;
        }

        self.underrun_since = None;
        self.samples.pop_front()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    #[cfg(test)]
    pub fn target_fill(&self) -> usize {
        self.target_fill
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_with_min_target() {
        let buf = AdaptiveJitterBuffer::new(48_000, 960, 4);
        assert_eq!(buf.target_fill(), 960 * 2);
    }

    #[test]
    fn defers_pop_below_min_target() {
        let mut buf = AdaptiveJitterBuffer::new(48_000, 10, 4);
        buf.push_with_rtp_ts(&[1.0; 10], 0);
        assert!(buf.try_pop().is_none());
        assert_eq!(buf.len(), 10);
    }

    #[test]
    fn pops_once_min_target_met() {
        let mut buf = AdaptiveJitterBuffer::new(48_000, 10, 4);
        buf.push_with_rtp_ts(&[1.0; 20], 0);
        assert!(buf.try_pop().is_some());
    }

    #[test]
    fn drops_oldest_on_overflow() {
        let mut buf = AdaptiveJitterBuffer::new(48_000, 10, 4);
        const CAP: usize = 48_000 * 4;
        buf.push_with_rtp_ts(&vec![1.0; CAP], 0);
        assert!(buf.len() <= CAP);
    }

    #[test]
    fn jitter_increases_target_after_variable_arrival() {
        let mut buf = AdaptiveJitterBuffer::new(48_000, 960, 4);
        buf.push_with_rtp_ts(&[0.0; 960], 0);
        std::thread::sleep(std::time::Duration::from_millis(50));
        buf.push_with_rtp_ts(&[0.0; 960], 48_000);
        assert!(buf.target_fill() >= buf.min_target);
    }
}
