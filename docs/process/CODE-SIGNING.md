# Code signing — Tauri release bundles

Jam P2P ships unsigned desktop bundles today. OS installers show SmartScreen / Gatekeeper
warnings until signing is configured.

## Tauri updater signing (optional)

The CI workflow already reads these GitHub secrets when present:

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key for update artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password if the key is encrypted |

Generate a key pair:

```bash
npm run tauri signer generate -- -w ~/.tauri/jam-p2p.key
```

Add the **private** key contents and password to repo secrets. Keep the `.pub` file for
`tauri.conf.json` → `plugins.updater.pubkey` when enabling auto-update.

## Platform codesign (release quality)

| OS | What you need | Where to configure |
|---|---|---|
| **Windows** | Authenticode cert (EV recommended for SmartScreen) | Sign the `.exe`/`.msi` post-build or via `signtool` in CI |
| **macOS** | Apple Developer ID Application + notarization | `codesign` + `notarytool submit` on the `.app`/`.dmg` |
| **Linux** | GPG for `.deb`/`AppImage` (optional) | distro-specific |

Recommended CI pattern:

1. Build unsigned artifacts (current `npm run tauri build` job).
2. Add a **manual or tag-only** signing job with platform secrets (`APPLE_*`, `WINDOWS_CERT`).
3. Attach signed artifacts to GitHub Releases (`v*` tags).

Until secrets exist, treat CI Tauri builds as **compile smoke** only — functional but not
distribution-ready.
