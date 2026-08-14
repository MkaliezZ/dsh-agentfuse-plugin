/**
 * AgentFuse: an experimental in-process pre-dispatch policy boundary for AI
 * agent tools, ported to DeepSeek Harness as a guard plugin.
 *
 * A `tools/pre-execute` listener evaluates every tool call against a
 * deterministic denylist/asklist/allowlist/default policy, fails closed on
 * block, defers asklisted tools to the DSH approval chain, and appends a
 * durable `agentfuse/decision` session event for blocked calls carrying the
 * canonical evidence (reason code, policy id, arguments hash — never raw
 * arguments). Ask deferrals carry no AgentFuse evidence: the approval layer
 * records the `approval/asked` + `approval/decided` audit pair instead.
 *
 * AgentFuse is not a process sandbox, malware detector, intrinsic danger
 * classifier, or universal interceptor. It owns only the deterministic
 * `allow|block` decision, the approval deferral, and their evidence; dispatch
 * and risk classification remain the integrating runtime's responsibility.
 *
 * @module @deepseek-ai/dsh-agentfuse
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

import { buildDecision } from './evidence.ts'
import { resolvePolicy, type PolicyRules, type PolicyResolution } from './policy.ts'
import type { AgentFuseDecision, AgentFuseDecisionEventData, ToolCallRequest } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agentfuse'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud). `denyTools`
 * always wins; `askTools` defers to the DSH approval chain; `allowTools`, when
 * non-empty, blocks every other tool name; `defaultAction` is the fall-through
 * for names covered by none of them.
 */
export interface Config {
  /** Tool names blocked outright. Denylist always wins over everything. */
  denyTools?: string[]
  /**
   * Tool names that defer to the DSH approval chain instead of a deterministic
   * decision. Checked after `denyTools` and before the allowlist, so a deny
   * always wins and an unlisted name can still be blocked. The approval layer
   * (`@deepseek-ai/dsh-user-approval`) prompts the configured answerers and
   * records the `approval/asked` + `approval/decided` audit pair; with no
   * approval service or answerer composed, the ask fails closed to deny.
   */
  askTools?: string[]
  /** When non-empty, only these tool names may run; everything else is blocked. */
  allowTools?: string[]
  /** Action for a name covered by no rule. Default `block` (fail-closed). */
  defaultAction?: 'allow' | 'block'
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

/** Compile a validated {@link Config} into the rules the engine evaluates. */
export function compileRules(config: Config): PolicyRules {
  const allowTools = (config.allowTools ?? []).length > 0 ? new Set(config.allowTools) : undefined
  return {
    denyTools: new Set(config.denyTools ?? []),
    askTools: new Set(config.askTools ?? []),
    ...allowTools === undefined ? {} : { allowTools },
    defaultAction: config.defaultAction ?? 'block',
  }
}

/**
 * The pure, side-effect-free decision-only API: resolve the policy for one
 * request without dispatching anything. The TypeScript analogue of the Python
 * `RuntimeGuard.evaluate()`, extended with the DSH-native third outcome.
 *
 * @param request - the request to evaluate.
 * @param rules - compiled policy rules.
 * @returns the {@link PolicyResolution}: `allow`/`block` (final — build its
 *   evidence with {@link buildDecision}), or `ask` (deferred to the DSH
 *   approval chain; no AgentFuse evidence).
 */
export function evaluate(request: ToolCallRequest, rules: PolicyRules): PolicyResolution {
  return resolvePolicy(request, rules)
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

/** Model-facing ask reason handed to the approval layer as the question's `reason`. */
function askReason(toolName: string, reasonCode: string): string {
  return `AgentFuse requires approval for tool "${toolName}" (${reasonCode})`
}

/**
 * Install the pre-dispatch gate. Every model-directed tool call flows through
 * the `tools/pre-execute` waterfall:
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
