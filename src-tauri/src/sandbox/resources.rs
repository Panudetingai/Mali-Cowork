use std::time::Duration;

use super::policy::ResourceLimits;

pub fn timeout(limits: &ResourceLimits) -> Duration {
    Duration::from_millis(limits.timeout_ms.clamp(1_000, 600_000))
}

pub fn output_is_within_limit(limits: &ResourceLimits, bytes: usize) -> bool {
    u64::try_from(bytes).is_ok_and(|size| size <= limits.max_output_bytes)
}
