/**
 * Deterministic AgentFuse policy resolution: denylist, approval asklist,
 * allowlist, then default — always failing closed. Ported from the Python
 * `RuntimeGuard._resolve_policy_sync` order, with one DSH-native addition: an
 * `ask` layer that defers to the approval seam instead of deciding.
 *
 * Precedence is fixed: a deny always wins, an asklisted name defers to the
 * human approval chain, an unmatched allowlist always blocks, and only an
 * explicitly configured default action falls through.
 *
 * @module @deepseek-ai/dsh-agentfuse/policy
 */

import type { AgentFuseAction, ToolCallRequest } from './types.ts'

/** Fields shared by every resolution. */
interface PolicyResolutionBase {
  reasonCode: string
  policyId: string
  outcome: 'resolved' | 'no_match'
  matchStage: 'exact' | 'fallback'
  matchKind: 'exact' | 'none'
  matchedPolicyKey?: string
  candidatePolicyKeys: string[]
  fallbackReason?: string
}

/** Final deterministic resolution: allow or block. Evidence-ready via `buildDecision`. */
export interface ResolvedPolicy extends PolicyResolutionBase {
  action: AgentFuseAction
}

/**
 * Deferred resolution: the DSH approval chain decides. Carries no AgentFuse
 * evidence — the approval layer records the `approval/asked` +
 * `approval/decided` audit pair, so the two audits never overlap.
 */
export interface AskResolution extends PolicyResolutionBase {
  action: 'ask'
}

/** The complete resolution: a final allow/block or a deferral to approval. */
export type PolicyResolution = ResolvedPolicy | AskResolution

/**
 * The compiled policy rules the engine evaluates. `askTools` is always
 * consulted (an empty set defers nothing); `allowTools` is `undefined` when no
 * allowlist is configured (every non-denied, non-asklisted name falls through
 * to the default).
 */
export interface PolicyRules {
  denyTools: ReadonlySet<string>
  askTools: ReadonlySet<string>
  allowTools?: ReadonlySet<string>
  defaultAction: AgentFuseAction
}

/**
 * Resolve one request against the compiled rules. Order is fixed and
 * deterministic:
 *
 * 1. denylist match — block (`explicit_denylist`);
 * 2. asklist match — ask the approval chain (`requires_approval`);
 * 3. configured allowlist without the name — block (`not_allowlisted`);
 * 4. configured allowlist containing the name — allow (`allowed`);
 * 5. default action — allow/block (`allowed` / `policy_denied`).
 *
 * @param request - the request to evaluate.
 * @param rules - the compiled policy rules.
 * @returns the settled {@link PolicyResolution}.
 */
export function resolvePolicy(request: ToolCallRequest, rules: PolicyRules): PolicyResolution {
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

  if (rules.askTools.has(request.toolName)) {
    return {
      action: 'ask',
      reasonCode: 'requires_approval',
      policyId: 'agentfuse:asklist',
      outcome: 'resolved',
      matchStage: 'exact',
      matchKind: 'exact',
      matchedPolicyKey: `ask:${request.toolName}`,
      candidatePolicyKeys: [`ask:${request.toolName}`],
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
