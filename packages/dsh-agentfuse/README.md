# dsh-agentfuse

> **Status:** ALPHA · 12 tests passing · seeking the first real (non-self) deployment

AgentFuse is a fail-closed **pre-dispatch policy boundary** for AI agent tools,
ported from the DHMS AgentFuse Python project to a DeepSeek Harness (DSH) guard
plugin.

This package is a thin DSH adapter over the framework-agnostic engine
[`@agentfuse/core`](../core): the decision vocabulary, deterministic policy
resolution, hashing, and evidence assembly all live in the core. This package
owns only the DSH config schema, the `tools/pre-execute` gate, and the durable
`agentfuse/decision` session event.

Every model-directed tool call flows through the DSH `tools/pre-execute`
waterfall. AgentFuse evaluates it against a deterministic denylist → asklist →
allowlist → default policy, fails closed on `block`, defers asklisted tools to
the DSH human-approval chain, and appends a durable `agentfuse/decision`
session event for blocked calls carrying the canonical evidence — reason
code, policy id, and a canonical arguments hash, **never raw arguments**.

```text
AGENTFUSE_IS_A_DANGER_CLASSIFIER=false
AGENTFUSE_IS_A_POLICY_AND_AUTHORIZATION_BOUNDARY=true
AGENTFUSE_DECISIONS=allow|block
AGENTFUSE_DEFERRALS=ask
AGENTFUSE_FAILS_CLOSED=true
```

## What it is / is not

AgentFuse owns only the deterministic `allow | block` decision, the approval
deferral, and their evidence. It is **not** a process sandbox, malware
detector, intrinsic danger classifier, or universal interceptor. Risk
classification, approval, dispatch, and physical execution remain the
integrating runtime's responsibility — the same boundary the Python
`dhms_agentfuse` documents.

## Config

```yaml
# cordis.yml (or a cordis.patch.yml insert)
- id: agentfuse
  name: '@deepseek-ai/dsh-agentfuse'
  config:
    defaultAction: block      # 'allow' | 'block' — fall-through for unlisted names
    denyTools: []             # always wins
    askTools: []              # defer to the DSH human-approval chain
    allowTools: []            # non-empty = only these names may run
    logDecisions: false       # durable evidence; needs in-repo catalog (see note below)
```

Policy resolution order (fixed, deterministic):

1. `denyTools` match → `block` (`explicit_denylist`)
2. `askTools` match → `ask` (`requires_approval`)
3. configured `allowTools` without the name → `block` (`not_allowlisted`)
4. configured `allowTools` containing the name → `allow` (`allowed`)
5. `defaultAction` → `allow`/`block` (`allowed` / `policy_denied`)

## Approval integration

An `askTools` match returns `{ kind: 'ask' }` from the `tools/pre-execute`
waterfall. The DSH tool registry routes it through the approval service
(`@deepseek-ai/dsh-user-approval`), which prompts the composed answerers (the
Web GUI approval card, CLI answerers, …) and records the `approval/asked` +
`approval/decided` audit pair on the session log.

Outcomes:

- `allowed-once` — the tool runs;
- `rejected` / `cancelled` / `unavailable` — the tool is denied, and the model
  sees a distinct reason for each (a human "no" reads differently from a
  missing approval channel);
- no approval service composed, no answerer, or a `never` approval policy —
  every ask **fails closed** to deny.

AgentFuse emits **no** `agentfuse/decision` evidence for asks: a deferral is
not a final decision, and the approval layer already records the complete
ask/decide chain, so the two audits never overlap.

## Install

### As a bundle

The package declares itself as a DSH bundle (`dsh.bundle.patch` →
`cordis.patch.yml`). Reference it from a profile bundle list or apply the patch
row directly; see the DSH [profiles and bundles
architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#profiles-and-bundles).

### Into the DSH repo (PR path)

This package is structured to drop into the DeepSeek Harness monorepo at
`packages/guard/agentfuse/` unchanged, with the core vendored at
`vendor/agentfuse-core/` (the `vendor/*` workspace glob links it automatically,
so the `@agentfuse/core` dependency resolves as-is). That is the supported
build path: DSH packages are not published to npm, so the `workspace:^`
dependencies resolve only inside the monorepo.

> **Durable event catalog:** the `agentfuse/decision` session event is a new
> `SessionEventMap` member. DSH's persistence read path refuses unknown event
> types unless they are registered in the generated
> `KNOWN_SESSION_EVENT_TYPES` catalog. After the package lands in-repo, run
> `pnpm run gen-persistence-catalog` so the event is recognized. Until then the
> gate still blocks correctly; only the durable decision event is not
> reconstructable on reload. For this reason `logDecisions` defaults to
> `false` — leave it off for standalone installs and enable it only after the
> package lands in-repo and the catalog is regenerated.

## API

The complete core vocabulary (`evaluate`, `resolvePolicy`, `buildDecision`,
`compileRules`, `argumentsHash`, `policyHash`, and all decision/evidence types)
is re-exported from `@agentfuse/core` — see its
[README](../core/README.md). This package adds only:

- `apply(ctx, config)` — the Cordis plugin entry: installs the pre-execute gate.
- `Config` / `Config` schema — the core policy config plus `logDecisions`.
- `agentfuse/decision` — the durable session event type.

## Relationship to DHMS

This is a faithful port of the DHMS AgentFuse decision engine and
`agentfuse-evidence-schema-v0.1` from
[`MkaliezZ/dhms-engine`](https://github.com/MkaliezZ/dhms-engine). Decision and
execution remain separate lifecycle facts; a blocked call is recorded as a
completed policy decision with non-execution evidence, not as a failed tool
execution.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
