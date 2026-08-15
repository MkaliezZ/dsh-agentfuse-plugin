# LangGraph example

This example shows how `@agentfuse/core` gates tool dispatch in a LangGraph
(JavaScript) agent **without any DeepSeek Harness code** — the same engine the
DSH adapter uses, wired to a different framework.

> This directory is an illustrative example, not a published adapter: it is
> self-contained (imports only `@agentfuse/core`) and demonstrates the wiring
> pattern. A production LangGraph adapter would hide the plumbing below behind
> a guarded `ToolNode` wrapper, exactly like the DSH adapter hides it behind a
> `tools/pre-execute` listener.

## The pattern

1. Build your policy once: `compileRules(config)`.
2. On every tool dispatch, map the LangGraph tool call into a
   `ToolCallRequest`.
3. `resolvePolicy(request, rules)` returns `allow` / `block` / `ask`:
   - `block` — return a terminal error ToolMessage; **do not** call the tool;
   - `ask` — defer to your human-approval mechanism (or fail closed);
   - `allow` — dispatch as usual.
4. For every final decision, `buildDecision()` produces the
   `agentfuse-evidence-schema-v0.1` record for your audit log — it never
   carries raw arguments.

## Sketch

See `guarded-tool.example.ts`. The sketch keeps LangGraph's own API out of the
picture on purpose: the tool-call shape (`{ id, name, args }`) and the
ToolMessage return are the only framework facts it assumes, so it adapts to
LangGraph's JavaScript versions without pinning one.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
