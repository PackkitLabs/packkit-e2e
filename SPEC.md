# `packkit-e2e` — released-version ecosystem harness (spec / proposal)

**Status:** Phase 1 implemented (J1, J2, J3, J6) · **Owner:** DanMat · **Depends on:** nothing new (uses published artifacts)

## 1. Why

Every Packkit repo already has strong *internal* gates:

| Gate | Scope | What it proves | Version tested |
| --- | --- | --- | --- |
| `runGeneratorConformanceSuite` | one generator | it's a well-behaved `PackkitGenerator` | local source |
| `runProviderConformanceSuite` | one provider | it's a well-behaved `PackkitProvider` | local source |
| characterization snapshots | one generator | output is byte-stable across refactors | local source |
| `test:integration` | one generator | scaffolds with the **local built** CLI, runs the emitted project's own toolchain | local source |

What **nothing** proves today: that the **ecosystem works end-to-end, at the versions a user actually installs, across repo boundaries.** Concretely, none of the above would catch:

- `npx create-packkit-py@latest` emitting a `service` contract that the **published** `@packkit/provider-aws@latest` rejects (a real risk whenever a contract field evolves and the two repos publish out of step).
- The **published** `packkit-mcp@latest` failing to front a newly published generator (registration drift).
- The "benign version split" (generators on `^0.4.0`, mcp/web on `^0.5.0`, providers on `^0.6.0`) turning malign after some future core change — asserted today only by reasoning, never executed.
- A generated project that builds against the generator's pinned dep floors but **not** against the latest published transitive deps a fresh `npx`/`uv`/`go get` pulls.

`packkit-e2e` is the executable form of the claim *"Packkit works as a system."* It's the review's deferred item, and the natural next step after "stop reorganizing, start proving."

## 2. What it is — and explicitly is NOT

**Is:** a **non-published test harness** (its own repo) that installs Packkit packages **from their registries at a chosen channel** (`@latest` by default) and runs **cross-repo journeys** a user would actually do — generate → build → test → plan-a-deploy → drive-the-MCP — asserting the seams between repos hold at released versions.

**Is NOT:**
- **Not** per-repo conformance/characterization (those stay in each repo, on its own source — faster, and the right place to gate a PR).
- **Not** a replacement for `test:integration` (which tests the *local, unpublished* build of *one* generator — the pre-merge gate). e2e is the *post-publish, cross-repo* gate.
- **Not** a real cloud deploy. **Providers are exercised to `plan` / `validate` / `check` only** — no `apply`, no credentials, no standing infrastructure, no spend. Real deploys stay a separate, manually-gated activity.

The distinction in one line: **integration proves "this repo's next version is sound"; e2e proves "the versions already out there compose."**

## 3. Journeys

Ordered by value-per-cost. Each is an independent, skippable test so a missing toolchain degrades gracefully.

### J1 — Generate → build → test, per language × target (published CLI)
For each of `create-packkit@latest` (JS), `create-packkit-py@latest`, `create-packkit-go@latest`, and each target (`lib`/`cli`/`worker`/`service`):
`npx`/`npm create` the project into a temp dir → run the emitted project's **own** toolchain with real tools (npm+node · uv+pytest/ruff/mypy · go build/vet/test). Fresh installs, so this also catches **transitive-dep rot** the pinned integration wouldn't.

### J2 — Contract → provider plan + conformance (the headline seam)
Generate a `static` / `service` / `worker` project, take its `deploymentContract`, and feed it to the **published** `@packkit/provider-aws@latest` and `@packkit/provider-netlify@latest`:
- assert `supports(contract) === {supported:true}` for the archetypes each provider claims, and a reasoned rejection otherwise;
- run `plan(...)` and assert it returns a schema-versioned, secret-free plan;
- for aws, `tofu validate` the emitted IaC (cheap, high-signal);
- run each provider through `runProviderConformanceSuite` from the **published** `@packkit/core/testing`.
This is the payoff of the `service` generalization, proven across the generator↔provider boundary at released versions.

### J3 — Release-feature validity
Generate `create-packkit-py --release=pypi` and `create-packkit-go --release=goreleaser`; assert the emitted CI is valid (`yaml` parse for the PyPI workflow; **real `goreleaser check`** for the `.goreleaser.yaml`). JS: assert the `changesets` release path emits a coherent `.changeset/` + workflow.

### J4 — MCP surface (published server)
Boot `packkit-mcp@latest` via `npx` over stdio; assert `list_generators` returns JS + Python + Go, presets resolve, `generate_project` previews a valid project for each language, and `compose_fullstack` stitches a React + FastAPI project. Proves the published server fronts the published generators.

### J5 — Fullstack composition (published core)
Use published `@packkit/core`'s `composeFullstack` to stitch a published-generator static frontend + service backend; assert the composed tree (`apps/web` + `apps/server` + root `docker-compose.yml` + `fullstack` contract) is coherent and the compose file parses.

### J6 — Version-matrix self-consistency
Read every published package's declared `@packkit/core` range and the published core version; assert the split is **either** satisfied **or** listed in an allow-list of intentional benign splits (kept in this repo). Turns the "benign split" from a reasoned claim into an executed, alarmed one.

### J7 (later / optional) — Deployed web configurator
Headless-load `https://packkit-web.pages.dev/`, generate one project per language, assert file trees are non-empty and error-free. Deferred — the static site is already smoke-tested in its own repo; this only adds "the *deployed* bundle still works."

## 4. Architecture

- **Repo:** `PackkitLabs/packkit-e2e` (public, MIT), **not** an npm package — a harness. No `@packkit/*` name.
- **Runner:** a small Node/TS harness (vitest or a plain journey-runner) that shells out to `npx` / `uv` / `go` / `tofu` / `goreleaser`. Each journey is a file; a journey `describe`s a language/seam and `skip`s cleanly if its toolchain is absent.
- **Channel, not lockfile:** installs `@latest` by design — it must test *what users get*, not a frozen set. Every run writes a `results/versions.json` (resolved versions of every package + toolchain) as the reproducibility record; a failing run attaches it.
- **Isolation:** each journey scaffolds into a fresh temp dir and a clean package cache where practical, so nothing leaks between journeys or from the host.
- **No secrets:** the harness never holds cloud or registry credentials. It reads public registries and runs `plan`/`validate`/`check` only.

## 5. CI cadence & failure surfacing

- **Schedule:** nightly (catches cross-repo drift within a day) — cron. Plus `workflow_dispatch`.
- **On publish (optional, phase 2):** any repo's successful Release fires a `repository_dispatch` to `packkit-e2e` so a fresh publish is validated against the rest of the ecosystem within minutes.
- **Not on PRs:** it tests *published* artifacts, so a PR's own code isn't what runs; per-repo gates already cover PRs.
- **Failure:** manage a **single tracking issue** (the proven `dependency-freshness` pattern — open/update/close one issue), plus a red scheduled badge. Optionally a notification later.
- **Toolchain matrix:** ubuntu-latest first; add macos once green. Provisions Node, uv (Python), Go, OpenTofu, GoReleaser via the same setup actions the repos already use.

## 6. Why a separate repo (not `packkit-actions`, not a generator)

- It **execs many published packages** and belongs to none of them.
- Its **cadence is scheduled**, not per-PR — folding it into a generator would either slow that repo's PRs or never run.
- It's the one place whose job *is* the cross-repo claim; a dedicated repo makes "does the ecosystem work?" a single green/red signal.
- It can still **reuse** `packkit-actions` workflows where they fit (e.g. a shared "provision toolchains" step), keeping the DRY-CI principle.

## 7. Decisions (folded into Phase 1)

1. **Channel:** `@latest` only. A `next`/canary lane can be added later.
2. **Cadence:** nightly (`0 7 * * *` UTC) + `workflow_dispatch`.
3. **Publish-triggered runs:** deferred to Phase 2 (schedule first).
4. **Failure surfacing:** a single tracking issue (the dependency-freshness pattern) + the failed scheduled run.
5. **Web (J7):** deferred.
6. **`apply` / real deploys:** **out of scope** — plan / validate / check only. Real deploys stay separate, manual, and credentialed.

## 8. Suggested phasing

- **Phase 1 (high signal, no cloud, ~1 slice):** J1 + J2 + J3 + J6. This alone proves the generator↔provider↔core seams and the version matrix at released versions.
- **Phase 2:** J4 (MCP) + J5 (fullstack) + optional publish-triggered fan-in.
- **Phase 3 (optional):** J7 (deployed web), macOS matrix, notification channel.

## 9. Open risk

`@latest` drift can make a run fail for reasons **outside** Packkit (a transitive dep breaks). Mitigation: `versions.json` pinpoints the culprit, and the tracking-issue body separates "Packkit seam broke" from "an upstream dep broke" by which journey failed (J1 fresh-install failures vs J2 contract-seam failures). We accept some noise as the price of testing reality.
