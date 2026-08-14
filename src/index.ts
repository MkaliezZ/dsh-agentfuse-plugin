/**
 * AgentFuse: an experimental in-process pre-dispatch policy boundary for AI
 * agent tools, ported to DeepSeek Harness as a guard plugin.
 *
 * A `tools/pre-execute` listener evaluates every tool call against a
 * deterministic denylist/allowlist/default policy, fails closed on block, and
 * appends a durable `agentfuse/decision` session event carrying the canonical
 * evidence (reason code, policy id, arguments hash — never raw arguments).
 *
 * AgentFuse is not a process sandbox, malware detector, intrinsic danger
 * classifier, or universal interceptor. It owns only the deterministic
 * `allow|block` decision and its evidence; dispatch and risk classification
 * remain the integrating runtime's responsibility.
 *
 * @module @deepseek-ai/dsh-agentfuse
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

import { buildDecision } from './evidence.ts'
import { resolvePolicy, type PolicyRules } from './policy.ts'
import type { AgentFuseDecision, AgentFuseDecisionEventData, ToolCallRequest } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agentfuse'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud). `denyTools`
 * always wins; `allowTools`, when non-empty, blocks every other tool name;
 * `defaultAction` is the fall-through for names covered by neither.
 */
export interface Config {
  /** Tool names blocked outright. Denylist always wins over allowlist. */
  denyTools?: string[]
  /** When non-empty, only these tool names may run; everything else is blocked. */
  allowTools?: string[]
  /** Action for a name covered by neither rule. Default `block` (fail-closed). */
  defaultAction?: 'allow' | 'block'
  /**
   * Append a durable `agentfuse/decision` session event for every BLOCKED call
   * (default `true`). Allowed calls are never durably logged — their execution
   * evidence is already the tool's own `tool/result`.
   */
  logDecisions?: boolean
}

export const Config: z<Config> = z.object({
  denyTools: z.array(z.string()).default([]),
  allowTools: z.array(z.string()).default([]),
  defaultAction: z.union(['allow', 'block'] as const).default('block'),
  logDecisions: z.boolean().default(true),
})

/** Compile a validated {@link Config} into the rules the engine evaluates. */
export function compileRules(config: Config): PolicyRules {
  const allowTools = (config.allowTools ?? []).length > 0 ? new Set(config.allowTools) : undefined
  return {
    denyTools: new Set(config.denyTools ?? []),
    ...allowTools === undefined ? {} : { allowTools },
    defaultAction: config.defaultAction ?? 'block',
  }
}

/**
 * The pure, side-effect-free decision-only API: evaluate one request and return
 * its canonical {@link AgentFuseDecision} without dispatching anything. The
 * TypeScript analogue of the Python `RuntimeGuard.evaluate()`.
 *
 * @param request - the request to evaluate.
 * @param rules - compiled policy rules.
 * @returns the {@link AgentFuseDecision} with its evidence.
 */
export function evaluate(request: ToolCallRequest, rules: PolicyRules): AgentFuseDecision {
  return buildDecision(request, resolvePolicy(request, rules))
}

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

/**
 * Install the pre-dispatch gate. Every model-directed tool call flows through
 * the `tools/pre-execute` waterfall; a blocked decision returns `deny` without
 * delegating (short-circuit), so no later listener can turn the block back into
 * permission. A direct `ctx.tools.execute()` caller has no agent, so it is
 * still gated but carries no durable evidence event.
 *
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const rules = compileRules(config)
  const logDecisions = config.logDecisions ?? true

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const request: ToolCallRequest = {
      toolCallId: String(exec.callId),
      toolName: exec.name,
      arguments: exec.arguments,
    }
    const decision = evaluate(request, rules)

    if (decision.action === 'block') {
      if (logDecisions && exec.agent !== undefined) {
        exec.agent.session.append('agentfuse/decision', toEventData(decision))
      }
      return { kind: 'deny', reason: denyReason(decision) }
    }
    return next()
  })
}
