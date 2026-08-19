/**
 * AgentFuse public decision and evidence vocabulary — framework-agnostic.
 *
 * This is a TypeScript port of the DHMS AgentFuse
 * `agentfuse-evidence-schema-v0.1` (Python `dhms_agentfuse`), preserving two
 * of its core contracts:
 *
 * - decision and execution are separate lifecycle facts — a blocked call is a
 *   completed policy decision with non-execution evidence, not a failed
 *   physical tool execution;
 * - evidence never carries raw arguments, paths, or credentials — only a
 *   canonical `argumentsHash` and policy facts.
 *
 * This module imports nothing outside this package; framework adapters (e.g.
 * the DeepSeek Harness plugin) depend on it.
 *
 * @module @dhms-agentfuse/core/types
 */

/** Canonical evidence schema version emitted by every {@link AgentFuseDecision}. */
export const EVIDENCE_SCHEMA_VERSION = 'agentfuse-evidence-schema-v0.1'

/** The two canonical decisions. `allow` permits guarded dispatch; `block` fails closed. */
export type AgentFuseAction = 'allow' | 'block'

/**
 * Provider-neutral tool request the decision engine evaluates. `arguments` is
 * the parsed JSON value handed down by the tool pipeline; evidence records only
 * its hash, never the raw value.
 */
export interface ToolCallRequest {
  toolCallId: string
  toolName: string
  arguments: unknown
}

/**
 * How the policy engine settled one request. `matchStage`/`matchKind` describe
 * whether a named rule matched exactly or the default fell through.
 */
export interface PolicyResolutionEvidence {
  outcome: 'resolved' | 'no_match'
  matchStage: 'exact' | 'fallback'
  matchKind: 'exact' | 'none'
  matchedPolicyKey?: string
  candidatePolicyKeys: string[]
  fallbackReason?: string
}

/** The single decisive gate fact: which policy decided, and how. */
export interface BoundaryDecisionEvidence {
  boundaryType: 'call'
  decision: AgentFuseAction
  policyId: string
  policyHash: string
  reasonCode: string
  decisiveGate: true
}

/** Safe trace metadata: tool identity and policy facts, without raw arguments. */
export interface TraceMetadataEvidence {
  toolName: string
  decision: AgentFuseAction
  policyId: string
  policyHash: string
  reasonCode: string
  boundaryType: 'call'
  argsHash: string
  evidenceRef: string
}

/**
 * Non-execution evidence for a blocked call: the call was NOT dispatched, NOT
 * started, and produced no side effect — recorded as a policy fact, not as a
 * tool failure.
 */
export interface NonExecutionEvidence {
  status: 'not_executed'
  reason: string
  execution: 'not_started'
  payloadExecuted: false
  toolFailure: false
  sideEffectOccurred: false
  approvalId: string
  callId: string
  resultRef: string
}

/** The complete evidence record attached to every {@link AgentFuseDecision}. */
export interface EvidenceRecord {
  recordId: string
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION
  policyResolution: PolicyResolutionEvidence
  boundaryDecision: BoundaryDecisionEvidence
  traceMetadata: TraceMetadataEvidence
  nonExecution?: NonExecutionEvidence
}

/** The canonical pre-dispatch decision plus its structured evidence. */
export interface AgentFuseDecision {
  toolCallId: string
  toolName: string
  action: AgentFuseAction
  reasonCode: string
  policyId: string
  evidence: EvidenceRecord
}

/**
 * Durable log-only evidence payload for one decision — the shape a framework
 * adapter records on its own audit log. Deliberately small and JSON-safe: tool
 * identity, the canonical action, reason/policy facts, and the arguments hash —
 * never raw arguments.
 */
export interface AgentFuseDecisionEventData {
  toolCallId: string
  toolName: string
  action: AgentFuseAction
  reasonCode: string
  policyId: string
  argumentsHash: string
  evidenceSchemaVersion: string
}
