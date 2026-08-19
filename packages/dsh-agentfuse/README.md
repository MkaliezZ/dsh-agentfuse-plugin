# dsh-agentfuse

> **Status:** ALPHA · bounded conformance proof · no production-readiness claim

AgentFuse is a fail-closed **pre-dispatch policy boundary** for AI agent tools,
ported from the DHMS AgentFuse Python project to a DeepSeek Harness (DSH) guard
plugin.

This package is a thin DSH adapter over the framework-agnostic engine
[`@agentfuse/core`](../core): the decision vocabulary, deterministic policy
resolution, hashing, and evidence assembly all live in the core. This package
owns only the DSH config schema, the `tools/pre-execute` gate, and the durable
`agentfuse/decision` session event.

In the tested integrated DSH path, model-directed tool calls reach the
`tools/pre-execute` waterfall. AgentFuse evaluates them against a deterministic denylist → asklist →
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

AgentFuse owns only its deterministic `allow | block` decision and bounded
decision evidence. The adapter can return DSH's host-owned `ask` deferral; it
does not own approval or make `ask` a third canonical AgentFuse decision. It is
**not** a process sandbox, malware
detector, intrinsic danger classifier, or universal interceptor. Risk
classification, approval, dispatch, and physical execution remain the
integrating runtime's responsibility — the same boundary the Python
`dhms_agentfuse` documents.

## Config

```yaml
# cordis.yml (or a cordis.patch.yml insert)
- id: agentfuse
  name: '@agentfuse/dsh-agentfuse'
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

## Regression locking with dsh-policy-test

The production policy is also a CI artifact. The
[`dsh-policy-test`](https://github.com/MkaliezZ/dsh-policy-test) evaluator
adapter compiles the **same** `PolicyConfig` through `@agentfuse/core` and runs
a fixture table against it — so configuration drift (a dropped allowlist, a
flipped default) turns red in CI instead of silently becoming an unexpected
`ALLOW` in production. See the
[joint example](https://github.com/MkaliezZ/dsh-policy-test/tree/main/examples/agentfuse).

## Cross-adapter conformance

The v3.6.2 conformance test consumes an exact snapshot of the canonical,
provider-neutral fixture vocabulary from `MkaliezZ/dhms-engine`. Provenance is
recorded in
[`conformance/cross_adapter_v3_6_2/provenance.json`](conformance/cross_adapter_v3_6_2/provenance.json),
including source commit `3ed2ccd0aadfcc61ad48ac5a49a54632f7911a91` and fixture SHA-256
`1f66c9e20ff28ebeeae128b8aaf38a5b251582496a753acded9530b819056d7b`.

The tests overlay this package and `@agentfuse/core` onto DeepSeek Harness
commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` (`0.1.0-rc.7`) and exercise
the real `Context`, `SystemPrompt`, `ToolRuntime`, `tools/pre-execute`,
`tools/execute`, and `tools/result` path. The deterministic result is 11 PASS,
0 FAIL, and 3 N/A across 14 canonical cases.

The N/A cases are bounded:

- policy callback exception and invalid callback output: the current DSH core
  exposes static configuration, not a custom policy callback surface;
- sync/async parity: DSH `ToolRuntime` exposes one asynchronous execution path,
  not separate sync and async APIs.

DSH `ask` remains a host approval deferral and does not appear in the canonical
`allow | block` fixtures. Host `isError` materialization for a denied call also
does not rewrite the earlier policy fact: it remains block/not-executed, not an
executed handler failure. These tests prove only the pinned integrated path;
they do not prove universal DSH interception, global exactly-once execution,
or official DeepSeek certification.

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
