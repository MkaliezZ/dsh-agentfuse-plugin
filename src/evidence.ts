/**
 * Evidence construction for AgentFuse decisions: canonical arguments hashing,
 * policy hashing, and the {@link EvidenceRecord} assembly that keeps decision
 * and execution as separate lifecycle facts.
 *
 * @module @deepseek-ai/dsh-agentfuse/evidence
 */

import { createHash } from 'node:crypto'

import type {
  AgentFuseDecision,
  EvidenceRecord,
  NonExecutionEvidence,
  ToolCallRequest,
} from './types.ts'
import { EVIDENCE_SCHEMA_VERSION } from './types.ts'
import type { ResolvedPolicy } from './policy.ts'

/** Reason codes whose blocked call is recorded as non-execution (not a failure). */
const NON_EXECUTION_REASONS = new Set([
  'explicit_denylist',
  'not_allowlisted',
  'policy_denied',
  'policy_exception',
  'invalid_policy_decision',
])

/**
 * Deep key-sort of a JSON value so two argument objects that differ only in
 * property order canonicalize identically. Arguments reach the gate as the
 * pipeline's parsed JSON, so JSON's value domain is the whole input domain —
 * no bigint, cycle, or `undefined` handling is reachable here.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/**
 * Canonical, order-independent hash of a call's arguments: deep key-sort, then
 * SHA-256. The fallback string mirrors the Python original — it can only be
 * reached if a hostile value traps serialization, never from the tool pipeline
 * (which guarantees lossless JSON).
 * @param value - the parsed arguments value.
 * @returns `sha256:<hex>` of the canonical serialization.
 */
export function argumentsHash(value: unknown): string {
  try {
    const canonical = JSON.stringify(sortJsonValue(value))
    return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
  } catch {
    return 'sha256:<unserializable-arguments>'
  }
}

/** SHA-256 of a policy id, so evidence can name a policy without trusting its string form. */
export function policyHash(policyId: string): string {
  return `sha256:${createHash('sha256').update(policyId).digest('hex')}`
}

/**
 * Assemble the full evidence record for one settled request. A blocked call
 * carries {@link NonExecutionEvidence}; an allowed call carries none (its
 * execution evidence is the tool's own `tool/result` event).
 *
 * @param request - the evaluated request.
 * @param resolved - the policy resolution for that request.
 * @returns the complete {@link EvidenceRecord}.
 */
export function buildEvidence(request: ToolCallRequest, resolved: ResolvedPolicy): EvidenceRecord {
  const hash = policyHash(resolved.policyId)
  const evidenceRef = `evidence:agentfuse:${request.toolCallId}`
  const nonExecution = resolved.action === 'block'
    ? blockNonExecution(request.toolCallId, resolved.reasonCode)
    : undefined

  return {
    recordId: `agentfuse-evidence:${request.toolCallId}`,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    policyResolution: {
      outcome: resolved.outcome,
      matchStage: resolved.matchStage,
      matchKind: resolved.matchKind,
      ...resolved.matchedPolicyKey === undefined ? {} : { matchedPolicyKey: resolved.matchedPolicyKey },
      candidatePolicyKeys: resolved.candidatePolicyKeys,
      ...resolved.fallbackReason === undefined ? {} : { fallbackReason: resolved.fallbackReason },
    },
    boundaryDecision: {
      boundaryType: 'call',
      decision: resolved.action,
      policyId: resolved.policyId,
      policyHash: hash,
      reasonCode: resolved.reasonCode,
      decisiveGate: true,
    },
    traceMetadata: {
      toolName: request.toolName,
      decision: resolved.action,
      policyId: resolved.policyId,
      policyHash: hash,
      reasonCode: resolved.reasonCode,
      boundaryType: 'call',
      argsHash: argumentsHash(request.arguments),
      evidenceRef,
    },
    ...nonExecution === undefined ? {} : { nonExecution },
  }
}

/** Non-execution evidence for a blocked call (never a tool failure). */
function blockNonExecution(toolCallId: string, reasonCode: string): NonExecutionEvidence {
  const reason = NON_EXECUTION_REASONS.has(reasonCode) ? reasonCode : 'policy_denied'
  return {
    status: 'not_executed',
    reason,
    execution: 'not_started',
    payloadExecuted: false,
    toolFailure: false,
    sideEffectOccurred: false,
    approvalId: `agentfuse-policy:${toolCallId}`,
    callId: toolCallId,
    resultRef: `result:not_executed:${toolCallId}`,
  }
}

/**
 * Build the canonical public decision for one request. This is the pure,
 * side-effect-free decision-only API — the TypeScript analogue of the Python
 * `RuntimeGuard.evaluate()`: it never dispatches a handler.
 *
 * @param request - the request to evaluate.
 * @param resolved - the resolved policy.
 * @returns the {@link AgentFuseDecision}.
 */
export function buildDecision(request: ToolCallRequest, resolved: ResolvedPolicy): AgentFuseDecision {
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    action: resolved.action,
    reasonCode: resolved.reasonCode,
    policyId: resolved.policyId,
    evidence: buildEvidence(request, resolved),
  }
}
