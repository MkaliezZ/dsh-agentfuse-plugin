/**
 * The DSH-specific durable audit event: AgentFuse decisions merge into the
 * session log vocabulary. The payload shape itself is framework-agnostic and
 * owned by `@dhms-agentfuse/core`; this module only registers it on DSH's
 * `SessionEventMap`.
 * @module @dhms-agentfuse/dsh-agentfuse/types
 */

import type { AgentFuseDecisionEventData } from '@dhms-agentfuse/core'

export type { AgentFuseDecisionEventData } from '@dhms-agentfuse/core'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One AgentFuse pre-dispatch policy decision. Log-only (never derived
     * history; the model-facing deny already reaches the model through the
     * `tool/result` error the pipeline materializes). Its loss cannot change
     * how the rest of the log reconstructs, so writers may skip it as
     * ignorable; it exists so an audit trail can reconstruct the FULL policy
     * decision — reason code, policy id, and canonical arguments hash — rather
     * than only the flattened error message.
     */
    'agentfuse/decision': AgentFuseDecisionEventData
  }
}
