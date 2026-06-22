# Branch protection for `main`

The CI workflow `.github/workflows/build.yml` runs on every push/PR to `main`.
As of 2026-06-22, **`main` is protected** — merges require passing CI checks
(`Frontend tests (vitest + lint)`, `Rust unit tests`, `Signaling server smoke test`).

## Recommended GitHub settings

Repository → **Settings** → **Branches** → **Add rule** for `main`:

| Setting | Value |
|---|---|
| Require a pull request before merging | optional (team preference) |
| Require status checks to pass | **enabled** |
| Required checks | `Frontend tests (vitest + lint)`, `Rust unit tests`, `Signaling server smoke test` |
| Require branches to be up to date | enabled |
| Do not allow bypassing | enabled for admins |

## CLI (repo admin)

```bash
gh api repos/emanubiz/jam-p2p/branches/main/protection -X PUT \
  --input docs/process/branch-protection-payload.json
```

Job names must match `.github/workflows/build.yml` exactly. List current checks:

```bash
gh run list --branch main --limit 1
gh run view <run-id> --json jobs -q '.jobs[].name'
```
