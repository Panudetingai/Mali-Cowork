//! Talking to remotes: fetch, pull (fast-forward only) and push.
//!
//! Pull never creates a merge commit on its own: if the branch and its
//! remote both moved, it stops and says so. Push sets the upstream on a
//! branch's first push.

use serde::Serialize;

use super::runner::Git;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// What git reported, for the UI to show briefly.
    pub message: String,
}

pub async fn fetch(git: &Git) -> Result<SyncResult, String> {
    git.network(&["fetch", "--prune"]).await?;
    Ok(SyncResult { message: "Fetched".into() })
}

pub async fn pull(git: &Git) -> Result<SyncResult, String> {
    let out = git.network(&["pull", "--ff-only", "--no-rebase"]).await?;
    let message = if out.stdout.contains("Already up to date") { "Already up to date" } else { "Pulled" };
    Ok(SyncResult { message: message.into() })
}

pub async fn push(git: &Git) -> Result<SyncResult, String> {
    let upstream = git.read(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).await;
    if upstream.is_ok() {
        git.network(&["push"]).await?;
        return Ok(SyncResult { message: "Pushed".into() });
    }
    let remote = default_remote(git).await?;
    git.network(&["push", "--set-upstream", &remote, "HEAD"]).await?;
    Ok(SyncResult { message: format!("Pushed to {remote}") })
}

/// `origin`, or the only remote there is.
pub async fn default_remote(git: &Git) -> Result<String, String> {
    let out = git.read(&["remote"]).await?;
    let remotes: Vec<&str> = out.stdout.lines().filter(|r| !r.is_empty()).collect();
    if remotes.contains(&"origin") {
        return Ok("origin".into());
    }
    match remotes.as_slice() {
        [only] => Ok(only.to_string()),
        [] => Err("This repository has no remote to push to. Add one first, e.g. `git remote add origin <url>`.".into()),
        _ => Err("This repository has several remotes and none is called origin. Push once from a terminal to choose.".into()),
    }
}
