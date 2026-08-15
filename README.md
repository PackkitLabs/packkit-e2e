# packkit-e2e

Released-version ecosystem harness for the [Packkit platform](https://github.com/PackkitLabs).
Every Packkit repo gates its own source (conformance suites, characterization snapshots,
integration). **Nothing else proves the ecosystem composes at the versions a user
actually installs, across repo boundaries** — that's this repo's job.

It installs the published Packkit packages at `@latest` and runs cross-repo **journeys** a
user would do — generate → build → test → plan-a-deploy → validate release automation —
asserting the seams between repos hold. It is **not** published to npm; it's a harness.

See [SPEC.md](SPEC.md) for the full design and rationale.

## What it proves

| Journey | Seam it exercises |
| --- | --- |
| **J1** generate → build → test | each published generator CLI (JS/Python/Go) emits a project that passes its own real toolchain — with a **fresh dependency install**, so transitive-dep rot surfaces too |
| **J2** contract → provider | a real `deploymentContract` from each generator is accepted + planned by the published `@packkit/provider-aws` and `@packkit/provider-netlify`; both pass the published `runProviderConformanceSuite`; the AWS IaC `tofu validate`s |
| **J3** release-feature validity | `--release=pypi` (Python) emits a valid OIDC PyPI workflow; `--release=goreleaser` (Go) passes `goreleaser check`; JS `oss` preset scaffolds a Changesets release |
| **J6** version matrix | every published package resolves to a real published `@packkit/core` (the "benign version split" is executed, not just reasoned) |

Boundaries: **plan / validate / check only** — no cloud `apply`, no credentials, no spend.

## Run it

```sh
npm install        # resolves every Packkit package at @latest (no lockfile — that's the point)
npm run e2e        # all journeys
node run.mjs j2 j6 # only these
```

Filter the heavy generate-build-test matrix while iterating:

```sh
E2E_GENERATORS=go,py E2E_TARGETS=lib,service node run.mjs j1
```

Each journey **skips** cleanly if its toolchain is absent (no `uv` → Python checks skip),
so partial local runs still give signal. A run writes `results/report.json` and
`results/versions.json` (the exact versions tested — the reproducibility trail).

## When it runs

Nightly (07:00 UTC) and on `workflow_dispatch`, never on PRs — it tests *published*
artifacts, not this repo's diff. A failure opens/updates a single tracking issue and
attaches the versions snapshot; the issue closes automatically once the ecosystem is
green again.

## Toolchains

Node (always), plus `uv` (Python), `go`, `tofu` (OpenTofu), and `goreleaser` — the CI
workflow provisions all of them; locally, install what you want to exercise and the rest
skip.
