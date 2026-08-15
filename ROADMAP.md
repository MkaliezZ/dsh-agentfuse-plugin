# Roadmap

AgentFuse's north star: make enterprises comfortable running AI agents in
production — not by filtering bad outputs, but by making every agent action
**authorizable, provable, and auditable**.

## Principles

1. **Deterministic first** — never ask a model what a static rule can decide;
   policy failure always fails closed.
2. **Decision ≠ execution** — a blocked call is a completed policy decision
   with non-execution evidence, not a failed tool execution.
3. **Evidence-first** — every conclusion reconstructs from logs; evidence never
   carries raw arguments or credentials.

## Phases

| Phase | Horizon | Goal | Exit criterion |
|---|---|---|---|
| P0 — DSH plugin | done | Ship the guard plugin | ✅ 3 commits, 12 tests, `dsh-plugin` topic |
| P1 — Ecosystem | 0–3 mo | First real (non-self) deployment | ≥1 deployment by someone else |
| P2 — Product | 3–9 mo | Multi-framework + policy management | ≥2 deployments + ≥1 paid pilot |
| P3 — Commercial | 9–18 mo | Managed audit layer → seed | ARR taking shape |
| P4 — Scale | 18–36 mo | Enterprise agent-security platform | Enterprise motion + compliance certs |

## Phase details

### P1 — Ecosystem (0–3 months)

Goal: the first real deployment by someone else. This is the ticket to
everything after.

- [ ] Extract the framework-agnostic core (`@agentfuse/core`) — policy,
  evidence, and hashing are already pure; turn the DSH package into a thin
  adapter.
- [ ] LangGraph adapter demo — prove this is not a DSH-only toy.
- [ ] One external real deployment — the README can then say "deployed at X".
- [ ] One compliance blog post — "agent action audit × EU AI Act / SOC 2".
- [ ] Three customer-discovery interviews — finance / healthcare / enterprise
  automation CTOs; validate the pain.

**Stop-line:** no external deployment within 3 months → pause the commercial
track and maintain the DSH plugin only.

### P2 — Product (3–9 months)

- [ ] Multi-framework adapters: LangGraph, Claude Code hooks, MCP gateway
  positioning (one decision layer, many entries).
- [ ] Local policy console — edit policies without hand-writing YAML.
- [ ] Audit export — immutable audit stream (JSONL snapshots + hash chain).
- [ ] `agentfuse/policy` extension event — third-party dynamic policy
  contributions, fail-closed on exception.
- [ ] DSH ecosystem depth: awesome list, tutorials, `permission-presets`
  integration.
- [ ] 2–3 design partners with paid pilots in compliance-sensitive industries.

**Exit:** ≥2 real deployments + ≥1 paid pilot.
**Stop-line:** no paid interest in 9 months → revert to open-source component +
consulting revenue, no hosted service.

### P3 — Commercial (9–18 months)

- [ ] Hosted control plane: policy management + multi-tenant audit storage +
  compliance reports.
- [ ] Business model: open core (the engine stays open) + paid hosted service.
- [ ] SOC 2 Type I; target finance/healthcare procurement gates.
- [ ] Add a security-background co-founder (red team / enterprise security /
  compliance) — solo is a seed-stage liability in security.
- [ ] Raise seed at 10+ deployments or 2–3 paid pilots (One raised $4M,
  Runlayer $30M as reference points) on the "auditable agent" story.

### P4 — Scale (18–36 months)

Enterprise sales motion, channel partnerships with agent platforms, SOC 2
Type II, Series A. Planned in detail only when P2 data exists.

## Version line

| Version | Content | Phase |
|---|---|---|
| v0.2 | `agentfuse/policy` custom-policy event (fail-closed) | P1 |
| v0.3 | Core extraction; the DSH package becomes an adapter | P1 |
| v0.4 | LangGraph adapter + Claude Code demo | P1/P2 |
| v0.5 | Policy console + audit export | P2 |
| v1.0 | Evidence schema v1 freeze + semver + docs site | P2 end |

## Known debt

- `logDecisions` defaults to `false` until DSH accepts external PRs or offers
  an out-of-repo session-event registration surface.
- 0.1.0: no compatibility promise before 1.0.

## Global stop-lines

| Signal | Action |
|---|---|
| No external deployment in 3 months | Pause the commercial track |
| No paid interest in 9 months | Revert to open source + consulting |
| A competitor wins flagship customers on post-hoc monitoring | Pivot to the "audit evidence layer" behind all guardrails |
| DSH ships a built-in policy gate | Validation — switch to multi-framework immediately |
