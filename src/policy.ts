/**
 * Deterministic AgentFuse policy resolution: denylist, allowlist, then default,
 * always failing closed. Ported from the Python `RuntimeGuard._resolve_policy_sync`
 * order — a static deny always wins, an unmatched allowlist always blocks, and
 * only an explicitly configured default action falls through.
 *
 * @module @deepseek-ai/dsh-agentfuse/policy
 */

import type { AgentFuseAction, ToolCallRequest } from './types.ts'

/** The settled policy for one request, before evidence is built. */
export interface ResolvedPolicy {
  action: AgentFuseAction
  reasonCode: string
  policyId: string
  outcome: 'resolved' | 'no_match'
  matchStage: 'exact' | 'fallback'
  matchKind: 'exact' | 'none'
  matchedPolicyKey?: string
  candidatePolicyKeys: string[]
  fallbackReason?: string
}

/**
 * The compiled policy rules the engine evaluates. `allowTools` is `undefined`
 * when no allowlist is configured (every non-denied tool falls through to the
 * default); a configured allowlist blocks every name not in it.
 */
export interface PolicyRules {
  denyTools: ReadonlySet<string>
  allowTools?: ReadonlySet<string>
  defaultAction: AgentFuseAction
}

/**
 * Resolve one request against the compiled rules. Order is fixed and
 * deterministic:
 *
 * 1. denylist match — block (`explicit_denylist`);
 * 2. configured allowlist without the name — block (`not_allowlisted`);
 * 3. configured allowlist containing the name — allow (`allowed`);
 * 4. default action — allow/block (`allowed` / `policy_denied`).
 *
 * @param request - the request to evaluate.
 * @param rules - the compiled policy rules.
 * @returns the settled {@link ResolvedPolicy}.
 */
export function resolvePolicy(request: ToolCallRequest, rules: PolicyRules): ResolvedPolicy {
  if (rules.denyTools.has(request.toolName)) {
    return {
      action: 'block',
      reasonCode: 'explicit_denylist',
      policyId: 'agentfuse:denylist',
      outcome: 'resolved',
      matchStage: 'exact',
      matchKind: 'exact',
      matchedPolicyKey: `deny:${request.toolName}`,
      candidatePolicyKeys: [`deny:${request.toolName}`],
    }
  }

  if (rules.allowTools !== undefined) {
    if (!rules.allowTools.has(request.toolName)) {
      return {
        action: 'block',
        reasonCode: 'not_allowlisted',
        policyId: 'agentfuse:allowlist',
        outcome: 'resolved',
        matchStage: 'exact',
        matchKind: 'exact',
        matchedPolicyKey: 'allowlist:configured',
        candidatePolicyKeys: [...rules.allowTools].sort().map(name => `allow:${name}`),
      }
    }
    return {
      action: 'allow',
      reasonCode: 'allowed',
      policyId: 'agentfuse:allowlist',
      outcome: 'resolved',
      matchStage: 'exact',
      matchKind: 'exact',
      matchedPolicyKey: `allow:${request.toolName}`,
      candidatePolicyKeys: [`allow:${request.toolName}`],
    }
  }

  const allow = rules.defaultAction === 'allow'
  return {
    action: rules.defaultAction,
    reasonCode: allow ? 'allowed' : 'policy_denied',
    policyId: `agentfuse:default:${rules.defaultAction}`,
    outcome: 'resolved',
    matchStage: 'fallback',
    matchKind: 'none',
    matchedPolicyKey: `default:${rules.defaultAction}`,
    candidatePolicyKeys: [],
  }
}
