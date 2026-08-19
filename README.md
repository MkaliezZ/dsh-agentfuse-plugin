# AgentFuse

> **Deterministic, fail-closed tool-call authorization for AI agents — with evidence.**
> **Status:** ALPHA · seeking the first real (non-self) deployment

AgentFuse is a pre-dispatch policy boundary for side-effect-capable AI agent
tools, ported from the DHMS AgentFuse Python project
([`MkaliezZ/dhms-engine`](https://github.com/MkaliezZ/dhms-engine)).

```text
AGENTFUSE_IS_A_DANGER_CLASSIFIER=false
AGENTFUSE_IS_A_POLICY_AND_AUTHORIZATION_BOUNDARY=true
AGENTFUSE_DECISIONS=allow|block
AGENTFUSE_DEFERRALS=ask
AGENTFUSE_FAILS_CLOSED=true
```

A blocked call is a **completed policy decision with non-execution evidence** —
never a failed tool execution. Evidence carries reason codes, policy ids, and a
canonical arguments hash, never raw arguments or credentials.

## Packages

| Package | What it is | Depends on |
|---|---|---|
| [`packages/core`](packages/core) · `@dhms-agentfuse/core` | Framework-agnostic engine: decision/evidence vocabulary, deterministic policy resolution, canonical hashing | nothing |
| [`packages/dsh-agentfuse`](packages/dsh-agentfuse) · `@dhms-agentfuse/dsh-agentfuse` | DeepSeek Harness guard plugin: tested `tools/pre-execute` gate, DSH config schema, durable `agentfuse/decision` session event, and host-owned approval deferral (`askTools`) | `@dhms-agentfuse/core`, DSH |

The core defines the bounded policy vocabulary; the DSH package is one
experimental adapter. Potential future integrations are tracked in the
[roadmap](ROADMAP.md), but are not implemented here.

## Quickstart (DeepSeek Harness)

```yaml
# cordis.yml (or a cordis.patch.yml insert)
- id: agentfuse
  name: '@dhms-agentfuse/dsh-agentfuse'
  config:
    defaultAction: block      # fail-closed fall-through
    denyTools: []             # deterministic block, always wins
    askTools: []              # defer to the DSH human-approval chain
    allowTools: []            # non-empty = only these names may run
    logDecisions: false       # durable evidence; needs in-repo catalog
```

See the [adapter README](packages/dsh-agentfuse/README.md) for the policy
order, the approval integration, and the install paths (bundle + PR).

## Cross-adapter conformance

The DSH adapter consumes the provider-neutral DHMS AgentFuse v3.6.2 fixture
snapshot with source commit and SHA-256 provenance. Against DeepSeek Harness
commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, the real integrated
`tools/pre-execute` path records 11 PASS and 3 explicitly justified N/A cases;
it does not claim coverage of unwrapped or future DSH paths.

See the [adapter conformance notes](packages/dsh-agentfuse/README.md#cross-adapter-conformance)
and the checked-in [fixture provenance](packages/dsh-agentfuse/conformance/cross_adapter_v3_6_2/provenance.json).

## Repository layout

```text
packages/
  core/            @dhms-agentfuse/core — zero runtime dependencies
  dsh-agentfuse/   @dhms-agentfuse/dsh-agentfuse — the DSH adapter (bundle)
ROADMAP.md         phases, version line, stop-lines
```

## Relationship to DHMS

AgentFuse is the runtime-execution-control line of DHMS (Digital Hyperthymesia
Memory Systems). The engine is a faithful TypeScript port of
`dhms_agentfuse`'s decision engine and `agentfuse-evidence-schema-v0.1`;
decision and execution remain separate lifecycle facts.

## License

Apache-2.0. See [LICENSE](LICENSE).
