# Public releases repo — GitHub Actions setup

Installers and release notes for end users live in the public repository:

**https://github.com/Panudetingai/Mali-Cowork-Releases**

This private repo (`Mali-Cowork`) still builds releases here first; workflow job **Sync release to public repo** copies the same tag, notes, and artifacts to the public repo. No application source is pushed to the public repo.

## One-time: create a PAT for cross-repo sync

1. Sign in to GitHub as an account that can **write** to `Panudetingai/Mali-Cowork-Releases` (Luke or a bot user).
2. **Settings → Developer settings → Personal access tokens**
   - Classic token: scope **`repo`** (or fine-grained: repository access **Mali-Cowork-Releases** only, permissions **Contents: Read and write**, **Metadata: Read**).
3. Copy the token once — it will not be shown again.

## Add secret on the **private** repo

In **Panudetingai/Mali-Cowork** (this repo):

1. **Settings → Secrets and variables → Actions → New repository secret**
2. Name: **`RELEASES_REPO_TOKEN`**
3. Value: the PAT from above

The Release workflow (`.github/workflows/release.yml`) uses:

| Secret | Used for |
|--------|----------|
| `GITHUB_TOKEN` (automatic) | Build + release on **Mali-Cowork** |
| `RELEASES_REPO_TOKEN` | Create/update release + upload assets on **Mali-Cowork-Releases** |

Never commit tokens or `.env` files to git.

## Verify

1. Ensure `RELEASES_REPO_TOKEN` is set on the private repo.
2. Push a tag (or run **Actions → Release → Run workflow** after bumping version in `tauri.conf.json` / `package.json` / `Cargo.toml`).
3. When **Release** finishes, check:
   - Private: `https://github.com/Panudetingai/Mali-Cowork/releases`
   - Public: `https://github.com/Panudetingai/Mali-Cowork-Releases/releases`

Both should show the same tag and the same `.dmg` / `.exe` assets.

If **Sync release to public repo** fails with “RELEASES_REPO_TOKEN is not set”, add the secret and re-run the failed job (or push the tag again after a fix).

## Public repo contents (manual / separate PRs)

Documentation, issue templates, and brand assets on **Mali-Cowork-Releases** are updated independently of this sync job. Only **GitHub Releases** (binaries + notes) are automated from here.
