# Product Spec — Self-Hosted LLM Gateway (working codename: **Conduit**)

> Status: **Draft v0.2** · Owner: derek@codecubed.com · Last updated: 2026-07-24
> Companion docs: [`llm-gateway-research.md`](./llm-gateway-research.md) (landscape + build-vs-buy) · [`llm-gateway-spec-critique.md`](./llm-gateway-spec-critique.md) (pressure test)
>
> _"Conduit" is a placeholder codename — swap freely._
>
> **v0.2 changes:** SSO confirmed baked into the base; request logs explicitly **must not** live in the control-plane SQLite; added **account-level spend limits** (§6.9), a first-class **audit** posture (§8.4), and a full **pricing & cost model** (§9). Sections after Pricing renumbered.

---

## 1. TL;DR

Conduit is a **single self-hosted Go binary + SQLite** that sits between an
organization's apps and its LLM providers. It is **dev-friendly first** (change
your `base_url` and go) and **enterprise-capable** (SSO/SCIM/SAML, RBAC, audit,
egress PII scrubbing, a master-admin control plane, deep logging) — all in the
**base** product, not behind a paywall.

**Deliberately *not* in v1:** automatic model selection. The **model is tied to
the API key** and chosen by the user. Auto-routing is a later, flag-gated feature
(the research doc calls this Phase 4; Ramp Router is the reference design).

**Wedge vs. the field:** LiteLLM (Python+Postgres, EE features paywalled), Bifrost
(Go, great perf, config-file-first), Portkey (hosted control plane), Kong (heavy),
and the hosted-only routers (Ramp, Cloudflare, OpenRouter). Conduit's bet:
**portal-first config in SQLite + reversible egress PII + SSO/SCIM in the base +
one binary to run.**

---

## 2. Problem & motivation

Teams adopting LLMs hit the same wall:
1. **Sprawl** — every app hard-codes a provider SDK and its own key. No central control.
2. **No governance** — can't see who spends what, can't rotate keys, can't cap budgets, can't restrict which models a team may call.
3. **Compliance risk** — prompts/responses containing PII flow to third-party providers and into logs, ungoverned.
4. **Weak visibility** — no unified request log, cost attribution, or audit trail.
5. **Ops burden** — the tools that solve the above (LiteLLM, Kong, Portkey) drag in Python+Postgres, Lua, or a hosted control plane.

Conduit collapses this into **one binary you drop in front of your providers**,
governed through a **portal**, storing everything in **one SQLite file**.

---

## 3. Goals / Non-goals

### Goals (v1)
- **G1** — OpenAI-compatible drop-in proxy; integrate by changing `base_url`.
- **G2** — **Virtual API keys** where each key binds to a specific **model + provider + policy**.
- **G3** — **Enterprise identity in the base**: OIDC/SAML SSO + SCIM 2.0 provisioning + RBAC.
- **G4** — **Egress PII scrubbing** on the response path, reversible (tokenized), policy-driven.
- **G5** — **Deep logging**: per-request capture with a Helicone-grade portal drill-down.
- **G6** — **Master admin** control plane governing global defaults, providers, policy, flags.
- **G7** — **One binary + SQLite**, embedded UI, `docker run` / `./conduit` simple.
- **G8** — **Great docs/onboarding** surfaced inside the portal (pre-filled snippets, playground).
- **G9** — **Spend governance**: enforceable, hierarchical **spend limits** (account → team → key) with accurate **cost tracking** built on a maintained per-model **pricing map**, plus a first-class **audit trail**.

### Non-goals (v1)
- **N1** — Automatic/quality-based model selection (deferred; interface stubbed).
- **N2** — Multi-node HA / horizontal scale-out (single-node + backups in v1).
- **N3** — Fine-tuning, training, or model hosting. We proxy, we don't serve models.
- **N4** — Semantic caching (Phase 4+, optional).
- **N5** — Billing/invoicing. We track cost; we don't bill.

---

## 4. Personas

| Persona | Needs | Primary surface |
|---------|-------|-----------------|
| **App Developer** | A key + base URL, copy-paste snippet, see their own usage/errors | Dev portal, docs, playground |
| **Team Lead** | Create keys for the team, set budgets/allowlists, watch spend | Team admin views |
| **Platform/Master Admin** | Providers + credentials, global policy, SSO/SCIM, PII rules, retention, flags | Master-admin console |
| **Security/Compliance** | Audit log, PII scrubber verdicts, data-residency guarantee, exports | Audit + log views (read) |

---

## 5. Key concepts

- **Provider** — an upstream (OpenAI, Anthropic, Bedrock, Vertex, Azure OpenAI, self-hosted/OpenAI-compatible). Holds a **credential** (encrypted) and a base URL.
- **Model** — a named model exposed by a provider (`gpt-4o`, `claude-...`). Mapped to one provider + credential.
- **Virtual Key** — the credential apps use against Conduit. Binds → allowed model(s), provider binding, owner, team, **policy** (budget, rate limit, PII policy, expiry). **The key determines the model** (a request may name a model only within the key's allowlist).
- **Key class** — `usage` (can call `/v1/*`) vs `management` (admin API only, cannot complete). (Pattern from OpenRouter.)
- **Account (Organization)** — the top governance + billing entity. Owns teams, users, a **spend limit**, and default policy. Multi-account is optional (single-tenant orgs run one account); the model still gives a clean place to hang org-wide spend caps and audit scope.
- **Team** — grouping of users + keys inside an account, with inherited budget/policy.
- **User** — a human identity, provisioned via SCIM or created locally; carries an RBAC **role** and belongs to an account/team.
- **Spend limit** — a monetary cap (with optional reset period + soft/hard thresholds) attached at **account, team, or key** level. Enforced cumulatively (§6.9).
- **Policy** — the bundle of controls applied to a request: spend limit, rate limit, model allowlist, PII mode, log level. Resolved by **inheritance**: Global (master) → **Account** → Team → Key, each level may only *tighten*.
- **PII policy mode** — `off` | `mask` | `tokenize` (reversible) | `synthetic`.
- **Pricing map** — the maintained per-model rate table (input/output/cache/reasoning/batch) used for all cost math (§9).
- **Audit event** — an append-only record of any admin/config/identity action.

---

## 6. Functional requirements

Priorities: **P0** = v1 must-have · **P1** = fast-follow · **P2** = later phase.

### 6.1 Gateway / proxy
- **P0** OpenAI-compatible endpoints: `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `GET /v1/models` (filtered to the key's allowlist).
- **P0** **Streaming** (SSE) passthrough with scrubbing applied to the stream (see §7.4).
- **P0** Deterministic routing: `virtual key → provider binding → upstream`. If the request names a `model`, it must be in the key's allowlist or `403`.
- **P0** Provider failover on 5xx/429 **only within the same bound model across equivalent providers** if configured (no cross-model substitution in v1).
- **P1** Anthropic-native and Google-native passthrough endpoints (not just OpenAI shape).
- **P2** `RouterStrategy` interface with `Static` (v1) and later `LatencyAware`/`CostAware`/`Auto` (Ramp-style "cheapest model clearing a quality bar"), flag-gated by master admin.

### 6.2 Keys & model binding
- **P0** Create/revoke/rotate virtual keys in the portal + admin API.
- **P0** Each key stores: owner, team, `key_class`, allowed models, provider binding, budget, rate limit, PII mode, expiry, created/last-used.
- **P0** Key value shown **once** on creation; stored **hashed** (argon2/bcrypt) — never retrievable.
- **P0** Per-key **budget** (hard/soft cap) and **rate limit** (RPM/TPM). Soft cap warns; hard cap blocks. Budgets stack with team + account limits — see §6.9.
- **P1** Key rotation with grace window (old + new valid for N hours).
- **P1** Management keys for programmatic admin (scoped, cannot complete).

### 6.3 Providers & credentials
- **P0** Master admin registers providers + credentials; credentials **encrypted at rest** (envelope encryption, root key from env/KMS — see §11).
- **P0** Per-provider base URL override (for Azure/self-hosted/OpenAI-compatible).
- **P0** **Bring-your-own-keys** — provider credentials are the org's own (pattern from Requesty).
- **P1** Credential health checks + "test connection" in portal.
- **P1** Multiple credentials per provider (for failover / rate-limit spreading).

### 6.4 Identity, SSO & RBAC (in the base)
- **P0** Local users + master-admin bootstrap (first-run).
- **P0** **OIDC SSO** (Okta / Azure AD / Google / generic) for portal login.
- **P1** **SAML 2.0** SSO.
- **P1** **SCIM 2.0** provisioning endpoint: create/update/deactivate users + groups; map IdP groups → roles + teams.
- **P0** **RBAC roles**: `Viewer`, `Developer`, `TeamAdmin`, `Admin`, plus singleton **MasterAdmin**. (Base set adapted from Requesty.)
- **P0** Role → capability matrix enforced on every admin API + portal action (see §9.3).
- **P1** JWT/OIDC auth on the **gateway** path (not just portal) for machine identities.

### 6.5 PII scrubbing (egress-only, by design — D-006) — see §7 for the full spec
- **P0** Scrub PII on the **response** path before it leaves Conduit and before it's logged. (Egress-only is a deliberate choice, not an oversight.)
- **P0** Policy modes `off | mask | tokenize | synthetic`, resolvable per key/team/account/global.
- **P0** **Regex/"reflex" detectors** (regex + Luhn/validators): email, phone, credit card, SSN/national IDs, IBAN, IP, API-key/secret patterns. Ships first.
- **P1** **Small local PII model** (GLiNER2-PII / OpenAI Privacy Filter / Piiranha) for names/addresses/free-form PII — runs locally (no Python, no cloud); mechanism per D-006a (bundled sidecar vs CGO build).
- **P1** **Reversible tokenization** — replace with placeholders, keep an in-memory `{token→original}` map for the request, optionally reinsert for the end user (Kong pattern).
- **P0** **Configurable + logged** (`PIIConfig`): enable/disable each layer, choose model + categories + threshold, per-scope mode; verdict always logged, per-finding detail opt-in, raw values never (unless admin opts in).
- **P0** Every request logs a **scrubber verdict** (categories hit, count, mode applied).

### 6.6 Logging & observability — see §8
- **P0** Async, non-blocking per-request log: id, ts, key/owner/team, model, provider, token counts, cost, latency (queue/upstream/total), status, error, PII verdict, client IP, request id. Prompt/response stored **post-scrub** by default.
- **P0** Portal **log explorer**: filter by team/user/key/model/status/date; single-request inspector.
- **P0** **Cost attribution** rollups by team/user/key/model.
- **P0** Prometheus `/metrics` + `/healthz`.
- **P1** Log retention policy + rotation (see §8.3 + SQLite caveat).
- **P1** Export (CSV/JSONL) for compliance/forensics.
- **P2** Pluggable `LogSink` → DuckDB/ClickHouse/object storage for scale.

### 6.7 Master admin & config
- **P0** Single **MasterAdmin** console owning: providers/credentials, **global default policy**, PII defaults, log/retention defaults, SSO/SCIM setup, feature flags, branding.
- **P0** **Policy inheritance**: Global → Team → Key; child levels may only *tighten*, never loosen.
- **P0** Config source of truth = **SQLite**, edited live via portal/API (no YAML reload). Bootstrap file/env only for first-run secrets.
- **P1** Versioned settings with history (who changed what, when) — ties into audit.

### 6.8 Portal & docs (dev-friendly)
- **P0** Embedded SPA served by the binary (`//go:embed`).
- **P0** **Dev home**: my keys, my usage, my errors, copy-paste snippets **pre-filled** with the user's key + base URL (curl + Python + Node + OpenAI SDK).
- **P0** **Admin home**: keys, teams, providers, logs, policy, audit — gated by role.
- **P1** **Playground**: send a test prompt through a chosen key, see the scrubbed result + verdict + cost.
- **P0** In-portal **docs/onboarding** (getting started, auth, errors, rate limits).
- **P1** First-run wizard (`./conduit --init`): create master admin, add first provider, mint first key.

### 6.9 Spend limits & budgets
- **P0** Spend limits settable at **account, team, and key** level; each has: `amount`, `currency`, `reset_period` (`none|daily|weekly|monthly`), and **soft** + **hard** thresholds.
- **P0** **Cumulative enforcement** — a request must clear the *remaining* budget at **every** level in its chain (key ∧ team ∧ account). The tightest wins.
- **P0** **Hot-path check before upstream.** Because final cost depends on **output tokens not yet generated**, enforcement is two-phase:
  1. **Pre-flight estimate/reservation** — estimate worst-case cost from `max_tokens` (or a policy default cap) × the model's output rate + measured input cost; **reserve** it against each level's remaining budget with an atomic decrement so concurrent requests can't oversubscribe.
  2. **Reconciliation** — on completion (and incrementally for streaming), replace the reservation with **actual** cost from the pricing map (§9). Release the unused reservation.
- **P0** **Behavior on breach:** soft threshold → alert (portal + email/webhook), request proceeds; hard threshold → **block** with a clear `402`/`429` and a machine-readable error (`{code:"budget_exceeded", scope:"team", ...}`).
- **P1** **Alert thresholds** at configurable percentages (e.g., 50 / 80 / 100%), fired once per period per scope.
- **P1** **Reset scheduler** rolls period counters over (UTC or account-tz) and re-arms alerts.
- **P1** **Overage grace** option (allow N% or $N over hard cap before hard-blocking) — master-admin toggle.
- Every limit **change** and every **breach** is an **audit event** (§8.4). Race-safety note: reservations use atomic counters; a crash between reserve and reconcile is repaired by a sweep that expires stale reservations (see critique §risks).

---

## 7. PII scrubbing spec (detail)

### 7.1 Pipeline placement
Response middleware, after the upstream returns and **before** (a) the client
sees it and (b) the logger persists it. Ordering: `upstream → detect → transform
→ [reinsert?] → client`, with the **log tap reading the transformed copy**.

### 7.2 Detection layers (pluggable `Detector` chain) — DECISION D-006
Egress-only by design. Configurable chain, logged verdicts, no cloud/Python.
1. **Regex / "reflex" (P0, in-binary):** regex + validators — email, phone (E.164 + national), credit card (Luhn), SSN + common national IDs, IBAN, IPv4/6, and secret patterns (AWS keys, bearer tokens, private-key headers). High precision, zero deps. Ships first.
2. **Small local model (P1):** a purpose-built PII model run **locally** — candidates: **GLiNER2-PII** (~0.3B, 42–60+ categories, ONNX), **OpenAI Privacy Filter** (Apache-2.0), **Piiranha** (multilingual). Zero-shot label sets → configurable categories. Catches names/addresses/free-form PII the regex layer misses.
   - **Mechanism (open, D-006a):** in-process ONNX needs CGO + native runtime (breaks pure-Go). Leaning toward a **bundled local sidecar** (model + tiny inference process Conduit launches over localhost) to stay CGO-free yet fully on-prem. Alternatives: a CGO `conduit-pii` build, or calling a local Ollama/llama.cpp if present.
3. **Config + logging (`PIIConfig`):** toggles each layer, model choice, category set, threshold, per-scope mode; detections are logged (verdict always; per-finding detail opt-in; raw values never, unless an admin explicitly opts in).

### 7.3 Transform modes
- `off` — no change.
- `mask` — destructive replace (`•••` / `[REDACTED:EMAIL]`).
- `tokenize` — replace with stable placeholder `⟦EMAIL_1⟧`; hold `{token→original}` in a **per-request, in-memory** map. **Never persisted raw** (default).
- `synthetic` — category-preserving fake (valid-looking but fake email/phone) so downstream formatting survives (Kong pattern).

### 7.4 Streaming
For SSE, scrub on a **rolling buffer** with a lookback window so PII split across
chunk boundaries is still caught; flush safe prefixes as they clear the window.

### 7.5 Reversibility
When mode = `tokenize` and `reinsert=true`, the original values are re-inserted
into the **final** user-facing response (so the human sees real data) while the
**provider and the logs only ever saw tokens**. Token map lifetime = single
request; dropped after response. Persisting the map is opt-in and, if enabled,
encrypted.

### 7.6 Verdict record (always logged)
`{categories:[email,phone], counts:{email:2,phone:1}, mode:tokenize, reinserted:true, detector:deterministic, ms:0.4}`

---

## 8. Logging spec (detail)

### 8.1 Hot path
Handler emits a log struct to a **buffered channel**; a worker pool writes
asynchronously. Logging **must not** add latency or fail the request (drop-with-
counter on overflow, surfaced in `/metrics`).

### 8.2 Record shape
`request_id, ts, key_id, owner_id, team_id, model, provider, endpoint,
prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms{queue,
upstream, total}, status, error_code, pii_verdict, client_ip, user_agent,
prompt_ref, completion_ref` — where prompt/completion are stored **post-scrub**
(or as references into the log-body store).

### 8.3 Storage (respect the SQLite caveat from the research doc)
- **Control plane** (keys/users/teams/policy/providers/audit) → **SQLite**, WAL mode, single writer, `busy_timeout`, pure-Go `modernc.org/sqlite`.
- **Request logs** → behind a **`LogSink` interface**. v1 impl = **separate SQLite log DB** with **enforced retention + rotation**; message bodies optionally to append-only **JSONL** with SQLite holding the index. This keeps the control-plane DB small ("won't get that big") while allowing "lots of log capture."
- v2 impl = DuckDB/ClickHouse/object storage — swap without touching the gateway.

### 8.4 Audit log (P0, first-class)
Separate, **append-only, immutable** store: distinct from request logs, **never
auto-pruned** by the request-log retention job, exportable (CSV/JSONL), and
tamper-evident (optional hash-chain per row). Each event: `actor, role, action,
target, before_json, after_json, ts, source_ip, request_id`.

**Audited events (non-exhaustive):**
- **Keys:** mint / revoke / rotate (never the key value).
- **Spend:** limit created/changed, **soft breach**, **hard breach/block**, overage-grace use, period reset.
- **Providers/credentials:** add / edit / delete / test; credential rotation.
- **Policy:** PII-mode change, allowlist change, rate-limit change, log-level change.
- **Identity:** user create/deactivate, **role change**, team membership change, SSO login (success/fail), **SCIM** provisioning/deprovisioning.
- **Config:** any master-admin setting change (with before/after), **feature-flag** toggles (e.g., enabling auto-router).

Compliance/Security personas get **read** access to audit; only MasterAdmin (and,
scoped, Admin) can read others' — enforced by the RBAC matrix (§10.3).

---

## 9. Pricing & cost model

Accurate cost is the foundation of spend limits (§6.9), attribution (§8), and any
future auto-router. Get this wrong and every downstream number is wrong.

### 9.1 How providers actually price (2026 reality)
- **Per-token, directional:** input and output priced separately; **output typically 2–6× input**. Rates span a ~600× range across models ($0.10 → $60+ per MTok).
- **Cached input:** cache **read** ≈ **10% of input** (~90% discount); cache **write/creation** ≈ **1.25–2× input**. Only counts when a prompt prefix is reused.
- **Reasoning tokens:** "thinking" tokens are billed (generally at the **output** rate) and may not appear in the visible completion.
- **Batch API:** flat **~50% discount** on async batch jobs.
- **Multimodal:** image/audio/video priced on their own units (per image / per second / per tile), separate from text tokens.
- **Implication:** a single "price per token" is insufficient. Cost is a **sum over token classes**.

### 9.2 The pricing map
- A maintained **per-model rate table** (LiteLLM-style `model_prices` JSON) with fields:
  `input_cost_per_token, output_cost_per_token, cache_read_input_token_cost,
  cache_creation_input_token_cost, reasoning_cost_per_token (defaults to output),
  batch_multiplier, image_cost_per_unit, currency, context_window,
  source_url, updated_at`.
- **Bundled offline default** ships in the binary (works air-gapped) **+** master-admin **overrides** per model (edited in portal, stored in SQLite, takes precedence) **+** optional **periodic import** (manual upload or fetch of a newer map). Every price row carries `source` + `updated_at` for auditability.
- **Custom/self-hosted models:** admin sets a flat or zero rate.

### 9.3 Cost calculation
```
cost = input_tokens        × input_cost_per_token
     + cached_read_tokens   × cache_read_input_token_cost
     + cache_write_tokens   × cache_creation_input_token_cost
     + output_tokens        × output_cost_per_token
     + reasoning_tokens     × reasoning_cost_per_token
     ( × batch_multiplier if batch )
     + Σ multimodal_units   × unit_cost
```
- **Token source of truth:** prefer the provider's **`usage` block** (authoritative token counts incl. cache/reasoning splits when reported); fall back to a local tokenizer estimate only when the provider omits usage (e.g., some streaming modes) — and **flag** such rows as `cost_estimated=true`.
- Persist a **per-request cost breakdown** (not just a total) in the log for defensible attribution and dispute resolution.

### 9.4 Keeping prices current (this is an ongoing burden, not a one-off)
- Prices change often; a stale map silently corrupts every budget. Mitigations: visible `updated_at` per model + a portal **"prices last updated N days ago"** banner; a shippable map-update channel; and **reconciliation** against provider-reported cost where an API exposes it.
- **Known gaps to accept & surface** (see critique): providers don't uniformly report cached/reasoning token splits; pre-flight estimates can diverge from actuals; FX for non-USD. None are blockers, but all must be *visible* rather than silently wrong.

---

## 10. Data & API

### 10.1 SQLite schema sketch (control plane)
```sql
accounts(id, name, policy_json, created_at)                          -- top governance/billing entity
providers(id, name, kind, base_url, created_at)
credentials(id, provider_id, enc_secret, label, created_at)          -- enc_secret = envelope-encrypted
models(id, provider_id, credential_id, display_name, upstream_name, price_id)
model_prices(id, model_key, input_cost_per_token, output_cost_per_token,
             cache_read_input_token_cost, cache_creation_input_token_cost,
             reasoning_cost_per_token, batch_multiplier, image_cost_per_unit,
             currency, context_window, source, updated_at)           -- overridable pricing map
teams(id, account_id, name, parent_id, policy_json)
users(id, account_id, email, display_name, role, team_id, scim_external_id, status, created_at)
virtual_keys(id, hash, key_class, owner_id, account_id, team_id, allowed_models_json,
             provider_binding_id, policy_json, expires_at, last_used_at, created_at, revoked_at)
policies(id, scope, scope_id, ratelimit_json, pii_mode, log_level)   -- scope: global|account|team|key
spend_limits(id, scope, scope_id, amount, currency, reset_period,
             soft_pct, hard_pct, spent_current, reserved, period_started_at)  -- scope: account|team|key
settings(id, singleton, defaults_json, feature_flags_json, updated_by, updated_at) -- versioned
audit_events(id, ts, actor_id, role, action, target, before_json, after_json, source_ip, prev_hash, row_hash)
sso_config(id, kind, oidc_json, saml_json, scim_token_hash, enabled)
```
Request logs live in a **separate** DB/sink (§8.3): `request_logs(... , cost_breakdown_json, cost_estimated)`, `log_bodies(...)`.

### 10.2 API surface
- **Data plane:** `/v1/*` (OpenAI-compatible), `/healthz`, `/metrics`.
- **Admin API** (management keys / portal session, RBAC-gated):
  `/api/accounts`, `/api/keys`, `/api/teams`, `/api/users`, `/api/providers`, `/api/credentials`,
  `/api/models`, `/api/prices`, `/api/policies`, `/api/spend-limits`, `/api/settings`,
  `/api/logs`, `/api/audit`, `/api/usage`.
- **Identity:** `/auth/oidc/*`, `/auth/saml/*`, `/scim/v2/*`.

### 10.3 RBAC capability matrix (v1)
| Capability | Viewer | Developer | TeamAdmin | Admin | MasterAdmin |
|---|---|---|---|---|---|
| See own usage/logs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create/rotate own keys | — | ✅ (own) | ✅ (team) | ✅ | ✅ |
| Manage team members/budgets | — | — | ✅ (team) | ✅ | ✅ |
| Set account-level spend limits | — | — | — | ✅ (own acct) | ✅ |
| See all logs/audit | — | — | team only | ✅ (acct) | ✅ |
| Manage providers/credentials | — | — | — | ✅ | ✅ |
| Edit pricing map | — | — | — | ✅ | ✅ |
| Global policy / PII / retention | — | — | — | — | ✅ |
| SSO/SCIM/feature flags | — | — | — | — | ✅ |

---

## 11. Non-functional requirements
- **NFR1 — Perf:** gateway overhead target **< 1 ms p50** at 1k RPS on a single node (Bifrost proves µs-scale is possible in Go; we budget generously for scrubbing + logging). Scrubbing/logging never block the hot path.
- **NFR2 — Footprint:** one static binary, no external services required to boot; SQLite file(s) only.
- **NFR3 — Security:** credentials + optional token maps encrypted at rest; key values hashed; TLS by default; audit on all privileged actions.
- **NFR4 — Data residency:** self-hosted; **no request data leaves the org** except to the chosen provider. (This is the on-prem answer the hosted routers can't give.)
- **NFR5 — Portability:** pure-Go SQLite driver → CGO-free cross-compilation (Linux/macOS/arm64/amd64).
- **NFR6 — Reliability:** logging degrades gracefully (drop+count), provider failover configurable, graceful shutdown drains the log buffer.
- **NFR7 — Backups:** control-plane DB backup = copy the file (or Litestream); documented restore.

---

## 12. Architecture & key tech decisions
- **Language:** Go. Single binary; UI embedded via `//go:embed`.
- **DB driver:** default **`modernc.org/sqlite`** (pure Go, CGO-free) for the one-binary promise; reevaluate `mattn/go-sqlite3` (CGO) only if write throughput demands it.
- **Encryption:** envelope encryption for credentials — data keys wrapped by a root key sourced from env / file / KMS (master-admin-supplied). Open question §14.
- **Interfaces to keep swappable:** `Provider`, `Detector` (PII), `LogSink`, `RouterStrategy`, `IdentityProvider`. These are the seams that let v1 stay small and v2 scale.
- **Deploy:** `docker run` one-liner; `./conduit --init` first-run wizard; `/metrics` + `/healthz` out of the box.

---

## 13. Milestones (maps to research-doc phases)
- **M0 — Skeleton (Phase 0):** OpenAI-compatible proxy, static key→model→provider binding, SQLite control plane, embedded minimal portal, async request logging, `/metrics`, Docker + `--init`.
- **M1 — Governance + portal (Phase 1):** accounts/teams, virtual keys w/ rate limits/allowlists, **hierarchical spend limits + reservation/reconcile**, **pricing map + per-request cost breakdown**, RBAC, MasterAdmin console, **first-class audit log**, log explorer, dev docs/snippets.
- **M2 — Enterprise identity (Phase 2):** OIDC + SAML SSO, SCIM 2.0, group→role mapping, key rotation, retention policies.
- **M3 — PII egress (Phase 3):** reversible egress scrubber (deterministic detectors), per-scope PII modes, scrubbed-by-default logging, streaming scrub, optional Presidio sidecar.
- **M4 — Scale + intelligence (Phase 4):** `LogSink`→DuckDB/ClickHouse, semantic cache, and the **optional auto-router** (Ramp-style), flag-gated.

---

## 14. Open questions / decisions needed
1. **Product name** (Conduit is a placeholder).
2. **CGO or pure-Go SQLite** — default pure-Go; confirm against expected write volume.
3. **Root encryption key location** — env vs file vs KMS; rotation story.
4. **Token-map persistence** for reversible PII — default memory-only; is there a use case requiring persistence (and encrypted storage)?
5. **HA posture** — commit to single-node + backups for v1, or design for rqlite/Litestream read paths now?
6. **Licensing/positioning** — OSS core vs all-in-one; what (if anything) is paid, given SSO/SCIM live in the base as our wedge.
7. **Provider failover semantics** — allow cross-provider-same-model failover in v1, or defer all failover to M-later?
8. **Cost data source** — bundled price map vs. provider-reported usage; who owns keeping prices current, and how often.
9. **Spend-limit strictness** — hard-block on hard cap (risk: kills prod traffic) vs. alert-only with overage grace? Per-account choice, or a global default?
10. **Pre-flight estimate basis** — reserve on `max_tokens` (often unset → over-reserve) vs. a policy default cap vs. rolling per-key average. Affects false-positive blocks.
11. **Multi-account or single-account** default — do we expose accounts/orgs in v1 UI, or keep one implicit account until a customer needs multi-tenancy?

---

## 15. Appendix — developer integration (target experience)
```bash
# The entire integration:
export OPENAI_BASE_URL="https://conduit.internal/v1"
export OPENAI_API_KEY="ck_live_…"        # a Conduit virtual key; model is bound to it
```
```python
from openai import OpenAI
client = OpenAI(base_url="https://conduit.internal/v1", api_key="ck_live_…")
resp = client.chat.completions.create(
    model="gpt-4o",                       # must be in the key's allowlist, else 403
    messages=[{"role": "user", "content": "Summarize this ticket…"}],
)
# PII in the response is scrubbed on egress per this key's policy;
# the request is logged (post-scrub) with a scrubber verdict + cost.
```
