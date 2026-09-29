# Public releases repo — GitHub Actions setup

Installers and release notes for end users live in the public repository:

**https://github.com/Panudetingai/Mali-Cowork-Releases**

This private repo (`Mali-Cowork`) builds releases via GitHub Actions. The **Build and upload release** job publishes installers, `latest.json` (in-app updater), and release notes directly to **Mali-Cowork-Releases** using `tauri-apps/tauri-action`. No application source is pushed to the public repo.

## One-time: create a PAT for the public releases repo

1. Sign in to GitHub as an account that can **write** to `Panudetingai/Mali-Cowork-Releases` (Luke or a bot user).
2. **Settings → Developer settings → Personal access tokens**
   - Classic token: scope **`repo`** (or fine-grained: repository access **Mali-Cowork-Releases** only, permissions **Contents: Read and write**, **Metadata: Read**).
3. Copy the token once — it will not be shown again.

## Add secret on the **private** repo

In **Panudetingai/Mali-Cowork** (this repo):

1. **Settings → Secrets and variables → Actions → New repository secret**
2. Name: **`RELEASES_TOKEN`**
3. Value: the PAT from above

The Release workflow (`.github/workflows/release.yml`) uses:

| Secret | Used for |
|--------|----------|
| `RELEASES_TOKEN` | Publish release + upload assets on **Mali-Cowork-Releases** (`tauri-action`), and verify the public release after both platform builds finish |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Sign update bundles for the in-app updater |

The **Sync public releases repo content** workflow (`.github/workflows/sync-public-releases-repo.yml`) uses the same **`RELEASES_TOKEN`** to push `releases-public/` (docs, README, issue templates) to the public repo’s `main` branch — never `src/` or `src-tauri/`.

Never commit tokens or `.env` files to git.

## Verify

1. Ensure `RELEASES_TOKEN` is set on the private repo (and signing secrets if you use the updater).
2. Push a tag (or run **Actions → Release → Run workflow** after bumping version in `tauri.conf.json` / `package.json` / `Cargo.toml`).
3. When **Release** finishes, check:
   - Public: `https://github.com/Panudetingai/Mali-Cowork-Releases/releases` — same tag, `.dmg`, `.exe`, and `latest.json`
   - **Verify public release** job should be green (no release is created on the private repo)

If a job fails with “RELEASES_TOKEN is not set”, add or rename the secret and re-run the failed job (or move the tag to a fixed commit and push again — see release runbook below).

## Public repo contents (docs / templates)

Documentation, issue templates, and brand assets on **Mali-Cowork-Releases** are synced from `releases-public/` in this repo via **Sync public releases repo content** (on push to `main` when `releases-public/**` changes, or manual dispatch). **GitHub Releases** (binaries + notes) are published only by the Release workflow’s `tauri-action` step.
