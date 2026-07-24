# Pressure Test & Critique — Conduit Spec

> Companion to [`llm-gateway-product-spec.md`](./llm-gateway-product-spec.md) v0.2 and
> [`llm-gateway-research.md`](./llm-gateway-research.md). Last updated 2026-07-24.
>
> Purpose: adversarially stress the spec **before** any code. This is deliberately
> critical — the strengths are covered in the spec itself. Severity: 🔴 high (could
> sink the product / mislead a buyer) · 🟠 medium (real, needs a decision) · 🟡 low
> (tighten the wording).

---

## 0. Bottom line up front

The spec is coherent and the *concepts* are right. But three things are being
under-stated, and each is load-bearing:

1. **The "one binary + SQLite, sub-ms, lots of logging" story quietly contradicts itself.** Every differentiating feature we add (spend reservation, PII scrubbing, rich logging) puts work **on the hot path** or **writes to SQLite**, and SQLite is single-writer. The µs number is *Bifrost's bare-proxy* figure, not ours. We should stop implying we'll match it.
2. **Egress-first PII may be solving the wrong half of the problem.** The bigger compliance exposure is usually PII going **to** a third-party provider (ingress), not coming back. Egress scrubbing is the flashier demo; ingress is the liability.
3. **The business case for *building* (vs. forking LiteLLM/Bifrost) is asserted, not proven** — and the chosen wedge (SSO/SCIM in the base) is exactly what competitors monetize, so it doubles as a *monetization* problem.

None are fatal. All should change how we sequence and how we pitch.

---

## 1. Strategic risks

### 1.1 🔴 Build vs. fork is not actually settled
The research doc concluded "build," but the spec then describes ~8–12 months of
hard work: SSO, **SAML**, **SCIM 2.0**, reversible streaming PII, a maintained
pricing map, reservation-based spend enforcement, an embedded portal, provider
adapters. Two of our five "steal from" sources — **Bifrost (Apache-2.0, Go)** and
**Portkey (Apache-2.0)** — are permissively licensed and already *are* the boring
80% (proxy, providers, keys, budgets, UI).
- **The unasked question:** why not **fork Bifrost** (Go, single binary, built-in UI, virtual keys, budgets, µs perf — already our architecture) and add only the three things it lacks: portal-first SQLite config, reversible **egress** PII, and SSO/SCIM-in-base? That's plausibly 20% of the effort for 80% of the differentiated value.
- **Recommendation:** Before M0, do a **1-week fork spike** on Bifrost: read its `configstore` + plugin system, prototype a PII egress plugin and a SQLite config backend. Decide build-vs-fork on evidence. Right now we're choosing the most expensive path by default.

### 1.2 🟠 The wedge is also the monetization hole
"SSO/SCIM/SAML in the **base**, not paywalled" is a great *adoption* wedge — and a
terrible *revenue* one. Those are precisely the features LiteLLM and Kong charge
for. If everything enterprises pay for is free, what's the business?
- Either this is (a) a genuinely OSS/internal tool with no revenue goal (fine — say so), or (b) a product, in which case we need a paid line that *isn't* the enterprise-identity table stakes: e.g. managed hosting, support/SLA, the auto-router, compliance certifications, multi-region/HA. **Decide which before building**, because it changes the architecture (multi-tenant billing vs. not).

### 1.3 🟠 Crowded market, incumbent trust, provider-coverage treadmill
LiteLLM has overwhelming adoption and **100+ providers**; we start with a handful.
Provider coverage is a maintenance treadmill (new models weekly, API drift). A new
gateway competes against "nobody got fired for using LiteLLM." Differentiators
(portal polish, reversible egress PII) are real but may be **features, not a
product** — easily copied by LiteLLM/Portkey in a release. Name the *durable*
advantage, or accept this is an internal tool.

---

## 2. Technical risks

### 2.1 🔴 The performance claim is inconsistent with the feature set
NFR1 says **< 1 ms p50**. But on the hot path we now do: a **spend reservation
(SQLite write)**, **PII detection over the full response** (regex, or a **network
hop** to a Presidio sidecar = tens of ms), and a **per-request log**. The honest
statement is: *bare proxy overhead* can be sub-ms; **with scrubbing + reservation +
logging enabled it will not be.** NER-based PII especially blows the budget.
- **Fix the spec:** state two numbers — bare-proxy overhead (target < 1 ms) and
  feature-on overhead (scrubbing/NER measured separately, budgeted in the tens of
  ms). Make PII detection **async where possible** and NER strictly opt-in.

### 2.2 🔴 SQLite single-writer vs. hot-path spend writes
Cumulative spend enforcement wants an **atomic decrement per request** — a **write**.
SQLite serializes writes through one writer. At even moderate RPS, putting a spend
write on the hot path makes SQLite the throughput ceiling, defeating both the perf
target and the "it's just a small config DB" framing.
- **Real design needed:** keep spend counters **in memory** (per-scope atomics),
  enforce against memory, and **flush to SQLite periodically/async**. That
  reintroduces a **crash-consistency gap** (spend since last flush is lost on
  crash → under-counts). The spec hand-waves this as "a sweep expires stale
  reservations"; that sweep does not recover lost *spend*. Call it out and pick a
  tolerance (e.g. "spend accounting is accurate to within one flush interval").

### 2.3 🔴 "Hard cap" is a soft promise (pre-flight estimate problem)
Final cost depends on **output tokens that don't exist yet**. Reservation needs a
worst-case estimate, but:
- Most callers **don't set `max_tokens`** → we either over-reserve (false
  `budget_exceeded` blocks on legit traffic) or can't bound it (overspend).
- With N concurrent in-flight requests, a hard cap can be overshot by up to
  `N × max_request_cost` before any reconciles.
- Streaming responses from some providers **omit `usage`** → cost is *estimated*
  exactly when enforcement matters most.
- **Consequence:** market it as a **budget guardrail with alerting**, not a
  guaranteed hard ceiling. If a true hard stop is required, it can only be
  approximate and will sometimes block good traffic. This is Open-Q #9/#10 — it's
  actually a **must-answer**, not a nice-to-have.

### 2.4 🔴 Streaming + reversible PII can corrupt outputs
Scrubbing a **streamed** response with reversible tokenization across chunk
boundaries is genuinely hard:
- PII split across SSE chunks needs a rolling buffer (spec has this) — but buffering
  **delays first-token**, hurting the UX that streaming exists to provide.
- Tool-calling / structured-output / code responses: naive scrubbing can **break
  JSON**, corrupt function-call arguments, or mangle code. Redacting inside a
  `tool_calls` payload can silently break the caller's app.
- **Fix:** PII scrubbing must be **content-type/structure aware** (skip or
  specially handle tool-call and JSON-mode responses), and reversible reinsertion
  must be exact. Add a compatibility matrix; default PII **off** for tool-calling
  paths until proven safe.

### 2.5 🟠 Egress scrubbing fights prompt caching and the future auto-router
Tokenizing/scrubbing changes payloads. If we later scrub **ingress**, altered
prompt prefixes **break provider prompt caching** (the 90%-off path) and any
semantic cache — silently *raising* cost, the opposite of the spend goal. Document
the interaction; caching and PII-rewrite are partially mutually exclusive.

### 2.6 🟠 "OpenAI-compatible" is a leaky abstraction we'll maintain forever
Tool calls, structured outputs, reasoning params, multimodal, and streaming
semantics differ across OpenAI/Anthropic/Gemini/Bedrock and **drift constantly**.
"Change your base_url" works for chat text; it leaks the moment someone uses
provider-specific features. This is a **permanent maintenance cost**, not a v1
task. Budget for it.

### 2.7 🟠 Pricing map is a perpetual liability
A stale price silently corrupts **every** budget and attribution number. We're
signing up to track a ~600×-range, frequently-changing table across all providers
(incl. cache/reasoning/batch/multimodal sub-rates that providers report
**inconsistently**). The spec acknowledges this but files it under "ongoing
burden" — it's really an **operational commitment** that needs an owner and a
cadence, or budgets rot within weeks.

---

## 3. Correctness, security & compliance risks

### 3.1 🔴 Egress-first PII arguably targets the wrong direction
The compliance nightmare is usually **PII leaving your walls to a third-party
provider** (ingress), not PII in the model's reply (egress). The user asked for
egress, and egress is the better *demo* — but a compliance/security buyer will
immediately ask "so you still send our customers' SSNs to OpenAI?" **Ingress
scrubbing should probably be P0 alongside egress**, or we must explicitly frame
egress-scrubbing's threat model (e.g. "prevents the model from *echoing/emitting*
PII into logs and downstream systems"). Right now the value story is muddled.

### 3.2 🔴 Regex PII detection: false negatives = liability, false positives = broken output
Deterministic detectors are precise for *formatted* data (cards, emails) but
**miss** names, addresses, free-form identifiers — exactly the PII compliance cares
about — until the NER sidecar (P2, opt-in, Python, latency). So the **default**
PII posture catches the easy stuff and misses the hard stuff, while giving users a
false sense of "PII is handled." We need: (a) a **PII eval harness** to measure
recall/precision and *publish the numbers*, and (b) honest UI language about what's
covered. Shipping "PII scrubbing" that leaks names is worse than shipping nothing.

### 3.3 🟠 "Immutable / tamper-evident" audit on a SQLite file is overclaimed
A hash-chain is **tamper-evident**, not tamper-proof: anyone who can write the DB
file can recompute the whole chain. True immutability needs **external append-only
/ WORM** storage or shipping audit events off-box. Don't tell compliance buyers
"immutable" when it's "detectable if you also stored the chain head elsewhere."

### 3.4 🟠 Single master-admin + single-box secrets = weak separation of duties & DR
- **MasterAdmin singleton** = bus factor of one, no separation of duties, no
  break-glass. Enterprises expect ≥2 admins and role separation. Make MasterAdmin a
  **role with ≥1 holder**, not a literal singleton.
- **Encryption root key:** in env on the same box → box compromise = all provider
  creds. In KMS → breaks "no external services / air-gapped." Backups: copying the
  SQLite file copies encrypted creds but **not** the root key → restore needs both;
  if they live together, it's not real DR. Pick a threat model and state it.

### 3.5 🟠 Multi-tenant blast radius in a single binary
One process serving multiple accounts means one memory-safety bug or query mistake
can leak **cross-account** prompts/logs/keys. Enterprise buyers with real isolation
needs may reject shared-process multi-tenancy. Either commit to **single-account
per deployment** (simplest, matches "self-hosted") or invest in hard tenant
isolation. Open-Q #11 should be decided *now* — it's architectural.

### 3.6 🟡 Runaway-cost / abuse vectors underspecified
A buggy client in a retry loop, or provider 429s triggering **our** retries, can
amplify token spend fast. Rate limits help but TPM limits need the same
unknown-output-token estimate. Add explicit **retry budgets**, loop detection, and
per-key concurrency caps.

### 3.7 🟡 Pre-filled key snippets in the portal
"Docs pre-filled with the user's key" puts a **live secret** into rendered DOM /
screenshots / support pastes. Use a **one-time reveal** + copy button, mask by
default, and never render the raw key server-side into shared views.

---

## 4. Scope & sequencing risks

### 4.1 🔴 M1 is a mega-milestone
M1 now bundles: accounts, teams, virtual keys, rate limits, allowlists,
**hierarchical spend + reservation/reconcile**, **pricing map + cost breakdown**,
RBAC, MasterAdmin console, **first-class audit**, log explorer, and dev docs. That's
not one milestone; it's three. Risk: nothing ships for months.
- **Resequence:** M0 should be genuinely minimal and *usable* — proxy + one
  provider + a key bound to a model + basic per-request logging to the log sink.
  Split governance (keys/teams/RBAC) from money (pricing/spend) from audit into
  separate increments so each ships and gets feedback.

### 4.2 🟠 Spend accuracy depends on the pricing map, which depends on provider usage
reporting, which is inconsistent — a **three-link dependency chain** where any weak
link makes hard caps unreliable. Don't ship "hard spend caps" until the pricing +
usage-reporting path is validated per provider. Ship **alerting** first (works even
with rough costs); ship **hard blocking** last.

---

## 5. Top risks, ranked

| # | Risk | Sev | If ignored |
|---|------|-----|-----------|
| 1 | Build-vs-fork never truly evaluated; we take the 10× costlier path | 🔴 | Months burned rebuilding Bifrost |
| 2 | Perf claim contradicts the feature set (hot-path scrub/spend/log) | 🔴 | Broken promise in first benchmark |
| 3 | "Hard" spend cap is approximate (pre-flight estimate + concurrency) | 🔴 | Either overspend or block good traffic; trust lost |
| 4 | Regex PII leaks the PII that matters (names/addresses) | 🔴 | False assurance → compliance incident |
| 5 | Egress-first may be the wrong direction (ingress is the exposure) | 🔴 | Buyer's first question sinks the demo |
| 6 | SQLite single-writer vs. hot-path spend writes | 🔴 | Throughput ceiling; contradicts "just config" |
| 7 | Streaming + reversible PII corrupts tool-call/JSON output | 🟠 | Silently breaks customer apps |
| 8 | Monetization hole (wedge = what rivals charge for) | 🟠 | No revenue path |
| 9 | M1 over-stuffed | 🟠 | Nothing ships |
| 10 | Audit "immutable" overclaimed on a writable file | 🟠 | Compliance credibility gap |

---

## 6. Recommended changes to fold back into the spec

1. **Split NFR1 into two perf numbers** (bare-proxy vs. features-on); stop implying µs with scrubbing on. *(spec §11)*
2. **Reframe spend limits as "guardrails + alerting," hard-block as best-effort/approximate**; document the reservation crash-gap tolerance. *(spec §6.9)*
3. **Promote ingress PII to at least P1 and state the egress threat model explicitly.** *(spec §6.5 / §7)*
4. **Make PII structure-aware; default off for tool-calling/JSON responses; add a PII eval harness as a deliverable.** *(spec §7)*
5. **Downgrade "immutable" → "tamper-evident, with off-box export for true immutability."** *(spec §8.4)*
6. **MasterAdmin = role with ≥1 holder + break-glass, not a singleton.** *(spec §4/§6.7)*
7. **Spend counters in-memory with async flush; note SQLite is control-plane-only and NOT on the per-request write path beyond periodic flush.** *(spec §8.3/§11)*
8. **Resequence milestones**: minimal usable M0; separate governance / money / audit. *(spec §13)*
9. **Decide single-account-per-deploy vs. multi-tenant now** — it's architectural. *(spec §14 Q11)*
10. **Add a pricing-map ownership + update cadence commitment** (who, how often, offline fallback). *(spec §9.4)*

---

## 7. Must-answer questions before writing code

1. **Fork or build?** Run the Bifrost spike; don't default to build.
2. **Product or internal tool?** Determines whether the monetization hole matters and whether multi-tenant/billing is in scope.
3. **Single-account or multi-tenant deployment?** Architectural; changes isolation, RBAC, and blast-radius design.
4. **Is a true hard spend cap a requirement, or is alerting + approximate blocking acceptable?** Determines how much reservation machinery we build.
5. **Ingress PII in scope, or egress-only with a stated threat model?** Determines the entire PII value story.
6. **What perf does the *real* (features-on) configuration need to hit?** Set the honest SLO before we design the hot path around it.

> None of this says "don't build it." It says: the concepts are sound, but the spec
> currently sells a simplicity/perf/hard-guarantee story that the feature set can't
> fully honor. Tighten the claims, resequence the build, and settle build-vs-fork on
> evidence — then the thing that ships will match what we told people it does.
