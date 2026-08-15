# @agentfuse/core

Framework-agnostic AgentFuse policy engine: deterministic, fail-closed
tool-call authorization with evidence.

```text
AGENTFUSE_IS_A_DANGER_CLASSIFIER=false
AGENTFUSE_IS_A_POLICY_AND_AUTHORIZATION_BOUNDARY=true
AGENTFUSE_DECISIONS=allow|block
AGENTFUSE_DEFERRALS=ask
AGENTFUSE_FAILS_CLOSED=true
```

## What it is

Zero runtime dependencies. This package owns:

- the decision/evidence vocabulary (`agentfuse-evidence-schema-v0.1`);
- deterministic policy resolution (`denyTools` → `askTools` → `allowTools` →
  `defaultAction`, always fail-closed);
- canonical, order-independent argument hashing (deep key-sort + SHA-256);
- decision assembly: a blocked call is a completed policy decision with
  non-execution evidence, never a failed tool execution.

It owns nothing about any framework: no hooks, no config schema, no logging.
A framework adapter maps its own tool-call representation into a
`ToolCallRequest`, calls `resolvePolicy`/`buildDecision`, and wires the
`allow`/`block`/`ask` outcome into its own pre-dispatch pipeline (see the
DeepSeek Harness adapter in `packages/dsh-agentfuse`).

## API

- `resolvePolicy(request, rules)` — the fixed-order policy resolution, returning
  `allow` / `block` / `ask`.
- `evaluate(request, rules)` — the pure decision-only entry (same resolution).
- `buildDecision(request, resolved)` — assemble an `AgentFuseDecision` with
  evidence for a final allow/block resolution.
- `compileRules(config)` — compile a `PolicyConfig` into engine rules.
- `argumentsHash(value)` / `policyHash(id)` — canonical hashing.

## Build

```bash
tsc -b packages/core
```

`tsc` alone emits `lib/` (runtime + types); the package has no dependencies to
bundle.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
