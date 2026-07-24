# LLM Gateway / Router Research + Build Plan

> **Goal:** Understand the LLM router/gateway landscape (LiteLLM, OpenRouter/Requesty,
> Portkey, Kong, Bifrost, Helicone, etc.) and use it to design **our own** gateway:
> a developer-friendly, enterprise-capable, single Go binary backed by SQLite, with a
> portal, strong logging, egress PII scrubbing, and a master admin config.
>
> _Research date: July 2026._

---

## 1. What we actually want to build (requirements)

Decoded from the brief:

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | **Dev-friendly** | Drop-in, OpenAI-compatible base URL, great docs, fast start |
| 2 | **Enterprise auth** | **SSO, SCIM, SAML** (the "SSL/Scam/Seam" in the brief) + OIDC |
| 3 | **Portal feel** | A real admin/user portal, not just a config file |
| 4 | **Good instructions / docs** | First-class onboarding + self-serve docs |
| 5 | **Good logging** | Lots of request/response log capture |
| 6 | **No auto-routing (yet)** | Users pick the model; model is **tied to the API key**. Auto model selection is a *later* feature, behind a flag |
| 7 | **PII scrubbing on egress** | Redact PII **on the way out** (response path), extensible to request path |
| 8 | **Master admin config** | A single super-admin control surface over everything |
| 9 | **Standalone "fat" binary** | One Go binary, embed the UI, minimal ops |
| 10 | **SQLite** | For config + control-plane data ("won't get that big") |

Key architectural implication of #6: we are a **policy + governance + observability**
gateway first, and a *routing* gateway second. The differentiator is the **portal +
logging + PII + admin**, not smart routing. That's good — it's exactly where the
existing tools are weakest in their open-source tiers.

---

## 2. The landscape

### 2.1 LiteLLM (BerriAI) — the incumbent to beat
- **Lang/stack:** Python + **PostgreSQL**. MIT core, OpenAI-compatible proxy in front of 100+ providers.
- **Dev-friendly:** Yes — the de-facto standard base URL, huge provider coverage, virtual keys, per-key/team budgets, cost tracking, fallbacks, admin UI.
- **Enterprise (paid, license-key gated on same Docker image):** SSO (Okta/Azure AD/Google/any OIDC/SAML), **SCIM** provisioning, OIDC/JWT auth with group-based access, audit logs, key rotation, Prometheus, team-admin delegation, SLA support.
- **PII:** Guardrails framework with **Presidio** integration — masks PII before it hits the LLM (request path), GDPR/HIPAA/CCPA framing.
- **Logging:** Postgres-backed request/response logging with optional PII redaction + retention.
- **Weaknesses for us:** Python runtime + Postgres = heavier ops than "one binary + SQLite." Enterprise features are paywalled. Perf overhead is high (~tens of ms — see Bifrost benchmarks).
- **Takeaway:** This is the **feature checklist** to match (virtual keys, budgets, guardrails, audit, SSO/SCIM). We win on ops simplicity and portal polish.

### 2.2 Bifrost (Maxim AI) — the closest to our vision ⭐
- **Lang/stack:** **Go, single binary** (npx / Docker / native). Apache-2.0. This is basically the architecture we're proposing.
- **Storage:** File-based config + env vars, with a `framework/configstore/` for **pluggable storage backends** (no hard Postgres dependency). Also has a vector store for semantic cache.
- **Portal:** **Built-in web UI** on `:8080` for config, real-time monitoring, analytics — zero-config startup, dynamic provider management.
- **Governance:** Virtual API keys, hierarchical budgets (keys/teams/customers), rate limiting; OAuth2/OIDC login with **background directory sync** for teams/roles/business units (their SCIM-ish story).
- **Perf:** Their headline claim — **~11–100µs overhead at 5k RPS vs ~40ms for LiteLLM** ("50x faster"). Go concurrency + low memory. This is the proof point that Go is the right call.
- **Enterprise:** Guardrails, cluster mode, adaptive load balancing, Prometheus/tracing.
- **Takeaway:** Strong evidence our stack (Go single binary + pluggable/embedded store + built-in UI) is viable **and** performant. Study their configstore abstraction and UI. Where we differ: they lean file-config; **we want SQLite as the source of truth** so the portal is the primary config surface, not YAML.

### 2.3 Portkey — control-plane model
- **Lang/stack:** TypeScript/Node. **Open-sourced the whole gateway under Apache-2.0 (March 2026)** — now the most feature-complete OSS option.
- **Strengths:** Semantic caching, guardrails, deep observability, budgets, big model catalog. Strongest **IdP-driven provisioning**: SCIM auto-provisioning, JWT gateway auth, OIDC/SAML SSO (SCIM + JWT gated to Enterprise).
- **Deployment gotcha:** Governance/analytics/config run through a **Portkey-hosted control plane**; only the *data plane* is self-hostable. Full on-prem is enterprise-only. Traffic only stays in your network if you run the data plane yourself.
- **Takeaway:** Great **SSO/SCIM UX reference**. But the split control-plane/data-plane is exactly the friction we avoid by being one self-hosted binary.

### 2.4 Kong AI Gateway — enterprise API-management heritage
- **Lang/stack:** Lua/Go on top of Kong. Heaviest to run; strong plugin ecosystem, SSO, RBAC.
- **PII (very relevant to us):** **AI PII Sanitizer plugin** — intercepts request **and response** bodies, sends to a PII service, applies placeholders or **synthetic replacements** (20+ PII categories, 12 languages). Killer feature: **reversible sanitization** — can reinsert the original values into the response before it reaches the end user, so the LLM never sees raw PII but the user still gets a usable answer. Added automated RAG + PII in AI Gateway 3.10.
- **Takeaway:** The **reversible/tokenized egress redaction** pattern is the gold standard for our PII requirement. Design our scrubber so redaction is reversible via a per-request token map, not just destructive masking.

### 2.5 Helicone — observability leader
- **Lang/stack:** **Rust** gateway runtime — lowest overhead in the field; best OSS observability UI.
- **Strengths:** Per-request logging, cost attribution by user/feature, latency breakdowns.
- **Takeaway:** This is the **logging/portal UX bar**. Our "good logging" requirement should target Helicone-level per-request drill-down (prompt, response, tokens, cost, latency, user, key, model, verdict of PII scrubber).

### 2.6 Ramp Router — the new hosted auto-router (announced ~Jul 2026)
- **What it is:** Ramp (the fintech) productized its **internal** LLM router — the thing keeping 100+ AI features at Ramp on the right model — and opened it to the public. Routes **~2.75 trillion tokens/month**; claims it **cut their LLM costs 30%**.
- **⚠️ Not open source.** Despite "giving it away for free," Ramp Router is a **cloud-hosted, closed managed service**. "Free" = free during beta; you pay **list price** for tokens (first 500 off the waitlist get $100 credit). There is **no self-host / no source**. The *open-source* one is **LiteLLM** — easy to conflate the two.
- **Core idea = pure auto-routing:** sends every request to the **"cheapest approved model that clears your quality bar,"** re-tests new models on real traffic weekly and re-routes automatically, layers caching/compression/100+ optimizations, and **falls back** to another model on outage/rate-limit. OpenAI-compatible (swap base URL).
- **Models:** frontier OpenAI + Google Gemini, plus select open models (e.g. Kimi). No detailed logging/governance/enterprise story published yet.
- **Takeaway for us:** Ramp is the **opposite architecture** to what we're building first — it's *all* auto-routing, *no* self-host, thin on governance/PII/SSO. That's fine: it's the best public reference for the **Phase 4 auto-routing** feature we deferred ("cheapest model that clears a quality bar" is a crisp spec for our later `RouterStrategy`). It is **not** a buy option for an on-prem, PII-scrubbing, SSO enterprise gateway.

### 2.7 OpenRouter / Requesty — hosted routers (the other "route" names)
- **OpenRouter:** Hosted, single key to all models; **Management API keys** for programmatic key creation/rotation (admin keys can't call completions — admin-only). Dashboard usage + per-key credit limits.
- **Requesty:** Hosted gateway to 600+ models; **RBAC (Owner/Admin/Developer/Viewer)**, per-team budgets, model allowlists, usage quotas, full audit trail (who/what/when/where, exportable), **bring-your-own-keys** per provider.
- **Takeaway:** Hosted (not self-hosted), so not direct competitors for an on-prem enterprise buyer — but Requesty's **RBAC role set** and **BYO-provider-keys** model, and OpenRouter's **admin-vs-usage key split**, are clean patterns to copy.

### 2.8 Others worth a mention
- **Cloudflare AI Gateway:** Managed gateway on Cloudflare's edge — monitoring, one of the **most mature caching** implementations in the field, rate limiting, retries, fallbacks, dashboard analytics across providers. But **cloud-only — no self-host, no in-VPC option**; traffic goes through Cloudflare. Best if you already live in the CF ecosystem; a non-starter for on-prem/data-residency requirements.
- **TrueFoundry:** Enterprise AI gateway / LiteLLM alternative; positions on governance + self-host.
- **llm-gateway (OpenZiti):** Small **Go** gateway, "dark by default," zero listening ports via overlay — interesting security posture, tiny provider set.

> **The through-line: hosted vs self-hostable.** The three names that come to mind first — **Ramp Router, Cloudflare AI Gateway, OpenRouter** — are all **cloud-only/closed**. For an on-prem, SSO/SCIM, PII-scrubbing enterprise gateway, only the **self-hostable** set matters: **LiteLLM, Bifrost, Portkey (data plane), Kong, Helicone** — and our own build. The hosted routers are best used as *feature references*, not as the thing we deploy.

### 2.9 Feature matrix (mapped to our requirements)

| Product | Lang | Self-host | Built-in portal | Store | SSO/SCIM/SAML | Egress PII | Perf | License |
|---------|------|-----------|-----------------|-------|---------------|-----------|------|---------|
| LiteLLM | Python | ✅ | ✅ | Postgres | ✅ (paid) | Presidio (req) | ~tens ms | MIT + paid EE |
| **Bifrost** | **Go** | ✅ | ✅ | pluggable/file | OIDC + dir-sync | guardrails | **~µs** | Apache-2.0 |
| Portkey | TS/Node | data-plane only | control-plane hosted | — | ✅ (SCIM paid) | guardrails | low | Apache-2.0 |
| Kong AI | Lua/Go | ✅ | ✅ | yes | ✅ (EE) | ✅ **reversible req+resp** | med | Apache/EE |
| Helicone | Rust | ✅ | ✅ (best) | yes | partial | via guardrails | **lowest** | Apache-2.0 |
| **Ramp Router** | — | ❌ hosted/closed | ✅ | — | — | — | n/a | proprietary (auto-router) |
| OpenRouter | — | ❌ hosted | ✅ | — | account SSO | — | n/a | proprietary |
| Requesty | — | ❌ hosted | ✅ | — | RBAC/audit | — | n/a | proprietary |
| Cloudflare | — | ❌ cloud-only | ✅ | — | — | — | edge | proprietary |
| **Our build** | **Go** | ✅ | ✅ (primary) | **SQLite** | ✅ target | ✅ **reversible egress** | µs target | ours |

---

## 3. Build vs. buy

**Buy/adopt (LiteLLM/Bifrost/Portkey)** gets you 80% instantly, but:
- The enterprise pieces we specifically want (SSO/SCIM/SAML, audit, master admin) are **paywalled** (LiteLLM/Kong) or **hosted-control-plane** (Portkey).
- Ops footprint (Python+Postgres, or Node control plane, or Kong) fights the "one fat Go binary + SQLite" goal.
- **Reversible egress PII** exists mainly in Kong (heavy) — nobody in the lightweight tier nails it.

**Build** is justified because our differentiators (portal-first config in SQLite, reversible egress PII, all-in-one self-hosted binary with SSO/SCIM in the *base* product) are exactly the gaps. Bifrost proves the Go-single-binary architecture performs. We're not out-innovating on routing — we're out-executing on **governance + portal + logging + PII + ops simplicity**.

**Recommendation:** Build, but **steal aggressively**:
- API surface + virtual-key/budget model → LiteLLM
- Single-binary + configstore abstraction + built-in UI + perf → Bifrost
- SSO/SCIM UX → Portkey
- Reversible egress PII (token-map) → Kong AI PII Sanitizer
- Per-request logging drill-down UX → Helicone
- RBAC roles + BYO-keys + admin/usage key split → Requesty / OpenRouter

---

## 4. Proposed architecture ("one fat Go binary + SQLite")

```
                          ┌──────────────────────────────────────────┐
   client apps  ──►  :443  │  Gateway (single Go binary, embedded UI)   │
   (OpenAI SDK,          │                                            │
    base_url override)   │  ┌── HTTP edge ──────────────────────────┐ │
                         │  │ /v1/*  OpenAI-compatible proxy         │ │
                         │  │ /admin portal (embedded SPA)           │ │
                         │  │ /healthz /metrics (Prometheus)         │ │
                         │  └───────────────┬────────────────────────┘ │
                         │   auth (key→model bind, SSO/SCIM/SAML)      │
                         │   policy (rate/budget/allowlist)            │
                         │   ┌── egress PII scrubber (reversible) ──┐  │
                         │   provider router (BYO provider keys)     │
                         │   async logging pipeline                  │
                         │        │                    │             │
                         │   ┌────▼─────┐        ┌──────▼─────────┐   │
                         │   │ SQLite   │        │ log sink       │   │
                         │   │ (control │        │ (see §5)       │   │
                         │   │  plane)  │        └────────────────┘   │
                         │   └──────────┘                            │
                         └──────────────────────────────────────────┘
                                     │ outbound
                                     ▼
                     OpenAI / Anthropic / Bedrock / Vertex / self-hosted
```

### 4.1 Language / packaging
- **Go**, single static binary. Embed the admin SPA via `embed.FO` (`//go:embed`).
- SQLite via a **pure-Go driver** (`modernc.org/sqlite`) to keep it CGO-free and truly one-binary/cross-compilable. (`mattn/go-sqlite3` is faster but needs CGO — decide based on write volume.)
- Config precedence: **SQLite is the source of truth**; a small bootstrap file/env only for first-run secrets (master admin creds, encryption key, listen addr). The portal edits SQLite live — no YAML reload dance.

### 4.2 Auth & the "model tied to the key" model (requirement #6)
- **Virtual API keys** minted in the portal. Each key row carries: `owner`, `team`, allowed `model(s)`, `provider binding` (which upstream + which provider credential), budget, rate limit, PII policy, expiry.
- **No auto model selection at first.** The request's key (or an explicit `model` field constrained to the key's allowlist) determines the upstream. Routing = deterministic lookup, not a model. Leave a `RouterStrategy` interface with a single `Static` impl now; add `LatencyAware` / `CostAware` / `Auto` later behind a flag (Ramp Router's "cheapest model that clears a quality bar" is the reference spec for this). This keeps requirement #6 satisfied while not painting us into a corner.
- **Two key classes** (borrow from OpenRouter): **usage keys** (call `/v1/*`) vs **management keys** (admin API only, cannot complete). 
- **Enterprise identity (SSO/SCIM/SAML):**
  - SSO/OIDC + SAML 2.0 for portal login (Okta/Azure AD/Google/generic).
  - **SCIM 2.0** endpoint for user/group provisioning + deprovisioning → maps IdP groups to RBAC roles + teams.
  - RBAC roles: **Owner / Admin / Developer / Viewer** (Requesty's set) + a distinct **Master Admin** (§4.5).
  - Put these in the **base** product, not a paywall — that's our wedge vs LiteLLM/Kong.

### 4.3 Egress PII scrubbing (requirement #7) — do it *reversibly*
Design the scrubber as a middleware on the **response** path (and pluggable onto the request path later):

1. Detect PII in the outbound text (names, emails, phones, SSNs, cards, secrets…).
2. **Tokenize** each hit → replace with a stable placeholder, store `{token → original}` in a **per-request, in-memory map** (never persisted raw).
3. Choose a policy per key/team: `mask` (destructive), `tokenize` (reversible), or `synthetic` (category-preserving fake, à la Kong).
4. On the **egress** requirement specifically: scrub before the response leaves the gateway; **logs store the scrubbed version** by default, with raw retained only if policy explicitly allows (and then encrypted).
5. **Go-native detection** to stay single-binary:
   - Start with a strong **regex/deterministic detector** (emails, phones, cards w/ Luhn, IBAN, keys/secrets) — covers the high-value, low-false-positive cases with zero deps.
   - Add a Go PII lib (e.g. the "无名/Nameless"-style detectors: 75+ detectors, locale/compliance presets) for breadth.
   - Only reach for **Presidio** (Python, NER) as an *optional external sidecar* for name/entity detection — keep it out of the core binary so we stay "fat binary, no Python."
- Make the detector set a **plugin interface** so we can swap regex → Go-NER → external service without touching the pipeline.

### 4.4 Logging (requirement #5) — lots of capture, done right
- **Async, non-blocking** log pipeline (buffered channel + worker) so logging never adds latency to the hot path (Bifrost/Helicone lesson).
- Per-request record: timestamp, key/owner/team, model, provider, prompt + completion (post-scrub), token counts, cost, latency (queue/upstream/total), status, **PII scrubber verdict** (what categories were hit/redacted), client IP, request ID.
- **Portal drill-down** to Helicone standard: filter by user/key/model/team, cost attribution, latency breakdown, single-request inspector.
- **Audit log** (separate from request log): every admin/config/SCIM action (who/what/when/where), append-only, exportable — for compliance.

### 4.5 Master admin config (requirement #8)
- A **Master Admin** singleton (bootstrapped from env on first run) that owns: global provider credentials, default PII/logging/retention policy, feature flags (e.g. enable auto-routing later), SSO/SCIM setup, license/branding, DB maintenance (vacuum, retention runs).
- Everything the Master Admin sets is a **default** that teams can only tighten, not loosen (policy inheritance). Store as a single versioned `settings` table with history for auditability.

### 4.6 Dev-friendliness & docs (requirements #1, #4)
- **OpenAI-compatible** `/v1/chat/completions`, `/v1/embeddings`, etc. — literally change `base_url`. This alone buys "dev-friendly."
- Ship an **embedded docs/onboarding** in the portal: copy-paste snippets pre-filled with the user's key + base URL, per-language SDK examples, a "test key" playground.
- `./gateway --init` interactive first-run; `docker run` one-liner; healthcheck + `/metrics` out of the box.

---

## 5. The SQLite question (important caveat)

The brief says "SQLite… config won't get that big" **and** "lots of log capture." Those two pull in opposite directions. Recommendation — **split the concerns**:

- **Control plane → SQLite** ✅ (keys, users, teams, policies, providers, settings, audit). This is small, relational, and perfect for SQLite. Use **WAL mode**, a single writer, `busy_timeout`, and pure-Go `modernc.org/sqlite`. Backups = copy the file.
- **Request/response logs → NOT the same SQLite table long-term.** High-volume prompt/response logging will bloat a single SQLite file fast and contend with control-plane writes. Options, in order of increasing scale:
  1. **Separate SQLite log DB** with aggressive **retention + rotation** (e.g. keep N days hot, roll off). Fine for small/medium volume — matches "won't get that big" if we cap retention.
  2. **Append-only JSONL files** on disk + index rows in SQLite (cheap, greppable, easy export).
  3. Later, an analytics store (**DuckDB / ClickHouse / object storage**) behind the same log interface when volume demands.
- Design the **log sink as an interface** (`LogSink`) with a `SQLite` impl now, so we can swap to DuckDB/ClickHouse without touching the gateway. Same trick as Bifrost's configstore abstraction.

**Bottom line:** SQLite is the *right* call for config/control-plane and totally fine for logs **if** we enforce retention. Don't let unbounded prompt logging live in the control-plane DB.

---

## 6. Suggested phased roadmap

**Phase 0 — Skeleton (dev-friendly core)**
- Go binary, OpenAI-compatible proxy, static key→model→provider binding, SQLite control plane (WAL, modernc driver), embedded minimal portal, async request logging to SQLite, Prometheus `/metrics`, Docker one-liner + `--init`.

**Phase 1 — Governance + portal**
- Virtual keys w/ budgets/rate limits/allowlists, teams, RBAC (Owner/Admin/Dev/Viewer), Master Admin config surface, audit log, Helicone-style log drill-down, docs/onboarding in portal.

**Phase 2 — Enterprise identity**
- OIDC/SAML SSO, **SCIM 2.0** provisioning, group→role mapping, key rotation, retention policies. (These ship in base, not paywalled — the wedge.)

**Phase 3 — PII (egress-first)**
- Reversible egress scrubber (regex/deterministic detectors), per-key/team PII policy (mask/tokenize/synthetic), scrubbed-by-default logging, optional Presidio sidecar for NER. Extend to request path.

**Phase 4 — Scale + intelligence**
- LogSink → DuckDB/ClickHouse option, semantic cache, and **finally** the optional **auto model routing** (`RouterStrategy` = latency/cost/quality) behind a Master-Admin feature flag — the "eventually build that in" from the brief.

---

## 7. Open questions to settle next

1. **CGO or not?** `modernc.org/sqlite` (pure Go, easy cross-compile) vs `mattn/go-sqlite3` (faster, needs CGO). Leaning pure-Go for the "one binary everywhere" promise unless write volume proves it too slow.
2. **Provider credential storage:** encrypt provider keys at rest in SQLite with a Master-Admin-supplied key (envelope encryption). Where does the root key live? (env / KMS / file.)
3. **Multi-node later?** SQLite is single-writer. If we ever need HA, do we shard by read-replica (Litestream/rqlite) or is the plan strictly single-node + backups? Decide before we lean too hard on SQLite semantics.
4. **PII detection depth vs. footprint:** how far do we go regex-only before requiring the Presidio sidecar? Affects the "no Python" purity claim.
5. **Reversible PII + logging:** if egress PII is tokenized reversibly, do we ever persist the token map? (Default: no — memory only, dropped after response.)
6. **Licensing/positioning:** OSS core + paid enterprise (LiteLLM model) vs. all-in-one? Our wedge is putting SSO/SCIM in the *base*, so think carefully about what (if anything) is paid.

---

## 8. Sources

- Ramp Router — <https://ramp.com/router/> · launch thread — <https://x.com/RampLabs/status/2079278815465951497> · coverage — <https://runtimewire.com/article/ramp-router-ai-model-gateway-llm-costs>
- Cloudflare AI Gateway (alternatives/analysis) — <https://portkey.ai/alternatives/cloudflare-ai-gateway-alternatives> · best routers — <https://www.edenai.co/post/best-llm-routers>
- LiteLLM Enterprise — <https://docs.litellm.ai/docs/enterprise> · PII masking (Presidio) — <https://docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2>
- LiteLLM review — <https://www.compsmag.com/reviews/litellm-review/> · TrueFoundry on LiteLLM EE — <https://www.truefoundry.com/blog/litellm-enterprise>
- Bifrost (GitHub) — <https://github.com/maximhq/bifrost> · Bifrost vs LiteLLM perf — <https://dev.to/crosspostr/how-a-go-based-llm-gateway-achieves-extreme-performance-gains-bifrost-vs-litellm-1l3o> · Bifrost site — <https://www.getmaxim.ai/bifrost/>
- Portkey SSO — <https://portkey.ai/docs/product/enterprise-offering/org-management/sso> · Portkey vs LiteLLM — <https://api7.ai/portkey-vs-litellm> · AI gateway comparison — <https://api7.ai/ai-gateway-comparison>
- Kong AI PII Sanitizer — <https://developer.konghq.com/plugins/ai-sanitizer/> · protect responses — <https://developer.konghq.com/how-to/protect-sensitive-information-output-with-ai/> · AI Gateway 3.10 — <https://konghq.com/blog/product-releases/ai-gateway-3-10>
- OSS gateway comparison — <https://blog.openziti.io/comparing-open-source-llm-gateways> · LLM gateway guide — <https://klymentiev.com/blog/llm-gateway-guide> · LiteLLM alternatives — <https://www.truefoundry.com/blog/litellm-alternatives>
- Helicone / top gateways — <https://inworld.ai/resources/best-llm-gateways> · <https://guptadeepak.com/tools/top-5-ai-gateways-2026/>
- OpenRouter management keys — <https://openrouter.ai/docs/guides/overview/auth/management-api-keys> · Requesty — <https://www.requesty.ai/> · Requesty vs OpenRouter — <https://www.truefoundry.com/blog/requesty-vs-openrouter>
- Go/OSS PII redaction — <https://github.com/topics/pii-detection> · Presidio — <https://github.com/microsoft/presidio>
