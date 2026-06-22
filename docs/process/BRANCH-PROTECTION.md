# Branch protection for `main`

The CI workflow `.github/workflows/build.yml` runs on every push/PR to `main`.
As of 2026-06-22, **`main` is not protected** — merges can bypass failing checks.

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
gh api repos/emanubiz/jam-p2p/branches/main/protection \
  -X PUT \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts][]="Frontend tests (vitest + lint)" \
  -f required_status_checks[contexts][]="Rust unit tests" \
  -f required_status_checks[contexts][]="Signaling server smoke test" \
  -f enforce_admins=true \
  -f required_pull_request_reviews=null \
  -f restrictions=null
```

Job names must match `.github/workflows/build.yml` exactly. List current checks:

```bash
gh run list --branch main --limit 1
gh run view <run-id> --json jobs -q '.jobs[].name'
```
