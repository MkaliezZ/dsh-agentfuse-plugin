# dsh-agentfuse

AgentFuse is a fail-closed **pre-dispatch policy boundary** for AI agent tools,
ported from the DHMS AgentFuse Python project to a DeepSeek Harness (DSH) guard
plugin.

Every model-directed tool call flows through the DSH `tools/pre-execute`
waterfall. AgentFuse evaluates it against a deterministic denylist →
allowlist → default policy, fails closed on `block`, and appends a durable
`agentfuse/decision` session event carrying the canonical evidence — reason
code, policy id, and a canonical arguments hash, **never raw arguments**.

```text
AGENTFUSE_IS_A_DANGER_CLASSIFIER=false
AGENTFUSE_IS_A_POLICY_AND_AUTHORIZATION_BOUNDARY=true
AGENTFUSE_DECISIONS=allow|block
AGENTFUSE_FAILS_CLOSED=true
```

## What it is / is not

AgentFuse owns only the deterministic `allow | block` decision and its
evidence. It is **not** a process sandbox, malware detector, intrinsic danger
classifier, or universal interceptor. Risk classification, approval, dispatch,
and physical execution remain the integrating runtime's responsibility — the
same boundary the Python `dhms_agentfuse` documents.

## Config

```yaml
# cordis.yml (or a cordis.patch.yml insert)
- id: agentfuse
  name: '@deepseek-ai/dsh-agentfuse'
  config:
    defaultAction: block      # 'allow' | 'block' — fall-through for unlisted names
    denyTools: []             # always wins
    allowTools: []            # non-empty = only these names may run
    logDecisions: true        # append durable agentfuse/decision for BLOCKED calls
```

Policy resolution order (fixed, deterministic):

1. `denyTools` match → `block` (`explicit_denylist`)
2. configured `allowTools` without the name → `block` (`not_allowlisted`)
3. configured `allowTools` containing the name → `allow` (`allowed`)
4. `defaultAction` → `allow`/`block` (`allowed` / `policy_denied`)

## Install

### As a bundle

The package declares itself as a DSH bundle (`dsh.bundle.patch` →
`cordis.patch.yml`). Reference it from a profile bundle list or apply the patch
row directly; see the DSH [profiles and bundles
architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#profiles-and-bundles).

### Into the DSH repo (PR path)

This package is structured to drop into the DeepSeek Harness monorepo at
`packages/guard/agentfuse/` unchanged. That is the supported build path: DSH
packages are not published to npm, so the `workspace:^` peer dependencies
resolve only inside the monorepo.

> **Durable event catalog:** the `agentfuse/decision` session event is a new
> `SessionEventMap` member. DSH's persistence read path refuses unknown event
> types unless they are registered in the generated
> `KNOWN_SESSION_EVENT_TYPES` catalog. After the package lands in-repo, run
> `pnpm run gen-persistence-catalog` so the event is recognized. Until then the
> gate still blocks correctly; only the durable decision event is not
> reconstructable on reload.

## API

- `evaluate(request, rules)` — pure, side-effect-free decision-only API (the
  TypeScript analogue of the Python `RuntimeGuard.evaluate()`): returns an
  `AgentFuseDecision` with evidence, dispatches nothing.
- `compileRules(config)` — validate/compile a `Config` into engine rules.
- `argumentsHash(value)` — canonical, order-independent SHA-256 of arguments.
- `apply(ctx, config)` — the Cordis plugin entry: installs the pre-execute gate.

## Relationship to DHMS

This is a faithful port of the DHMS AgentFuse decision engine and
`agentfuse-evidence-schema-v0.1` from
[`MkaliezZ/dhms-engine`](https://github.com/MkaliezZ/dhms-engine). Decision and
execution remain separate lifecycle facts; a blocked call is recorded as a
completed policy decision with non-execution evidence, not as a failed tool
execution.

## License

Apache-2.0. See [LICENSE](LICENSE).
