# Mali Remote (phone web UI)

Source for the page Tauri serves at `/` on the mobile remote port. Built as a single HTML file and copied to `src-tauri/src/commands/remote_page.html`.

## Layout

- `index.html` — shell markup (connect + app + dock)
- `src/boot.ts` — app logic (pairing, SSE, chat, model sheet); split into modules over time
- `src/components/` — focused UX helpers (e.g. dock keyboard)
- `src/styles/` — tokens and minimal border-card overrides

## Commands

```sh
cd remote-app
bun install
bun run build    # writes ../src-tauri/src/commands/remote_page.html
bun run dev      # local Vite preview (API calls need Mali remote running)
```

From repo root: `bun run build:remote`
