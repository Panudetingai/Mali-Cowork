//! Windows Job Object helpers shared by the supervisor and the MCP runner.
//!
//! A Job Object is the process-tree boundary on Windows: every supervised
//! child is added to a job that kills all members when the handle closes,
//! and limits active processes and per-process memory.

#[cfg(windows)]
use std::os::windows::io::RawHandle;

use crate::sandbox::ResourceLimits;

/// A job that kills its processes when its last handle closes.
#[cfg(windows)]
pub struct Job(windows_sys::Win32::Foundation::HANDLE);

#[cfg(not(windows))]
pub struct Job;

#[cfg(windows)]
// SAFETY: a job handle can be used and closed from any thread.
unsafe impl Send for Job {}

#[cfg(not(windows))]
unsafe impl Send for Job {}

impl Job {
    /// Forcibly terminate every process in the job now.
    #[cfg(windows)]
    pub fn terminate(&self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        // SAFETY: `self.0` is a live job handle.
        unsafe { TerminateJobObject(self.0, 1) };
    }

    #[cfg(not(windows))]
    pub fn terminate(&self) {}
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        // SAFETY: closed once, here.
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(not(windows))]
impl Drop for Job {
    fn drop(&mut self) {}
}

/// Put `process` into a new kill-on-close job and apply resource limits.
#[cfg(windows)]
pub fn contain(process: RawHandle, policy_limits: &ResourceLimits) -> Option<Job> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };

    // SAFETY: plain Win32 calls; the handle is closed by `Job` on failure too.
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return None;
        }
        let job = Job(handle);
        let mut job_limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        job_limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        job_limits.BasicLimitInformation.ActiveProcessLimit = policy_limits.max_processes;
        job_limits.ProcessMemoryLimit = policy_limits
            .max_memory_mb
            .saturating_mul(1024 * 1024)
            .try_into()
            .ok()?;
        let ok = SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &job_limits as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 || AssignProcessToJobObject(job.0, process as HANDLE) == 0 {
            return None;
        }
        Some(job)
    }
}

#[cfg(not(windows))]
pub fn contain(_process: std::os::fd::RawFd, _policy_limits: &ResourceLimits) -> Option<Job> {
    None
}
