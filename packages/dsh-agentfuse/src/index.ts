/**
 * AgentFuse: an experimental in-process pre-dispatch policy boundary for AI
 * agent tools, ported to DeepSeek Harness as a guard plugin.
 *
 * This package is a THIN ADAPTER over `@agentfuse/core`: it owns the DSH
 * config schema, the `tools/pre-execute` gate, and the durable
 * `agentfuse/decision` session event. The decision vocabulary, deterministic
 * policy resolution, hashing, and evidence assembly all live in the core.
 *
 * The gate evaluates every tool call against a deterministic
 * denylist/asklist/allowlist/default policy, fails closed on block, defers
 * asklisted tools to the DSH approval chain, and appends a durable
 * `agentfuse/decision` session event for blocked calls carrying the canonical
 * evidence (reason code, policy id, arguments hash — never raw arguments).
 * Ask deferrals carry no AgentFuse evidence: the approval layer records the
 * `approval/asked` + `approval/decided` audit pair instead.
 *
 * AgentFuse is not a process sandbox, malware detector, intrinsic danger
 * classifier, or universal interceptor. It owns only the deterministic
 * `allow|block` decision and bounded decision evidence. DSH owns approval,
 * dispatch, execution outcomes, and the host-specific `ask` deferral.
 *
 * @module @agentfuse/dsh-agentfuse
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

import {
  buildDecision,
  compileRules,
  resolvePolicy,
  type AgentFuseDecision,
  type AgentFuseDecisionEventData,
  type PolicyConfig,
  type ToolCallRequest,
} from '@agentfuse/core'

// Re-export the complete core vocabulary so `@agentfuse/dsh-agentfuse`
// stays the single import surface for DSH consumers.
export * from '@agentfuse/core'
export type { AgentFuseDecisionEventData } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agentfuse'

/**
 * Plugin config: the core {@link PolicyConfig} plus the DSH-specific durable
 * evidence flag. Validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud).
 */
export interface Config extends PolicyConfig {
  /**
   * Append a durable `agentfuse/decision` session event for every BLOCKED call
   * (default `false`). Allowed calls are never durably logged — their execution
   * evidence is already the tool's own `tool/result`.
   *
   * Defaults to `false` because the event must be registered in the
   * repo-generated `KNOWN_SESSION_EVENT_TYPES` catalog before persistence can
   * reload it. An out-of-repo (standalone bundle) install that enables it
   * without that registration makes sessions fail to load on resume; enable it
   * only when the package runs inside the monorepo (catalog regenerated).
   */
  logDecisions?: boolean
}

export const Config: z<Config> = z.object({
  denyTools: z.array(z.string()).default([]),
  askTools: z.array(z.string()).default([]),
  allowTools: z.array(z.string()).default([]),
  defaultAction: z.union(['allow', 'block'] as const).default('block'),
  logDecisions: z.boolean().default(false),
})

/** Project a decision into the durable, raw-argument-free event payload. */
function toEventData(decision: AgentFuseDecision): AgentFuseDecisionEventData {
  return {
    toolCallId: decision.toolCallId,
    toolName: decision.toolName,
    action: decision.action,
    reasonCode: decision.reasonCode,
    policyId: decision.policyId,
    argumentsHash: decision.evidence.traceMetadata.argsHash,
    evidenceSchemaVersion: decision.evidence.schemaVersion,
  }
}

/** Model-facing deny reason: names the tool and the machine reason code. */
function denyReason(decision: AgentFuseDecision): string {
  return `AgentFuse blocked tool "${decision.toolName}" (${decision.reasonCode})`
}

/** Model-facing ask reason handed to the approval layer as the question's `reason`. */
function askReason(toolName: string, reasonCode: string): string {
  return `AgentFuse requires approval for tool "${toolName}" (${reasonCode})`
}

/**
 * Install the pre-dispatch gate. In the tested integrated DSH path,
 * model-directed tool calls flow through the `tools/pre-execute` waterfall:
 *
 * - `block` returns `deny` without delegating (short-circuit), so no later
 *   listener can turn the block back into permission, and appends the durable
 *   decision evidence when `logDecisions` is on and the call has an agent;
 * - `ask` returns `{ kind: 'ask' }` with a human-readable reason — the tool
 *   registry routes it through the approval service, and a missing service,
 *   missing answerer, or `never` policy fails closed to deny;
 * - `allow` delegates (`next()`), leaving later listeners in the chain.
 *
 * A direct `ctx.tools.execute()` caller has no agent, so it is still gated but
 * carries no durable evidence event and its asks degrade to deny.
 *
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const rules = compileRules(config)
  const logDecisions = config.logDecisions ?? false

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const request: ToolCallRequest = {
      toolCallId: String(exec.callId),
      toolName: exec.name,
      arguments: exec.arguments,
    }
    const resolved = resolvePolicy(request, rules)

    if (resolved.action === 'ask') {
      return { kind: 'ask', reason: askReason(exec.name, resolved.reasonCode) }
    }

    const decision = buildDecision(request, resolved)

    if (decision.action === 'block') {
      if (logDecisions && exec.agent !== undefined) {
        exec.agent.session.append('agentfuse/decision', toEventData(decision))
      }
      return { kind: 'deny', reason: denyReason(decision) }
    }
    return next()
  })
}
