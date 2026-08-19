/**
 * Illustrative LangGraph-style wiring for @dhms-agentfuse/core — no DSH imports,
 * no LangGraph imports. The tool-call shape `{ id, name, args }` and the
 * ToolMessage return are the only framework facts assumed; adapt them to your
 * LangGraph (JavaScript) version's ToolNode/AIMessage APIs.
 *
 * The decision logic (compileRules / resolvePolicy / buildDecision) is the
 * real engine — everything else is the adapter layer a production integration
 * would wrap.
 */

import {
  buildDecision,
  compileRules,
  resolvePolicy,
  type AgentFuseDecision,
  type PolicyConfig,
  type ToolCallRequest,
} from '@dhms-agentfuse/core'

/** The policy for one deployment. */
const config: PolicyConfig = {
  denyTools: ['rm_rf'],
  askTools: ['send_email'],
  allowTools: ['search', 'read_file'],
  defaultAction: 'block', // fail closed
}

const rules = compileRules(config)

/** The minimal shape a LangGraph tool invocation presents at dispatch time. */
interface GraphToolCall {
  id: string
  name: string
  args: unknown
}

/** The tool body a graph node would dispatch for an allowed call. */
async function dispatchTool(call: GraphToolCall): Promise<unknown> {
  // The real adapter would route into LangGraph's ToolNode here.
  void call
  return 'tool result'
}

/** Blocking terminal message returned to the model for a denied call. */
function blockedMessage(call: GraphToolCall, decision: AgentFuseDecision | undefined, reasonCode: string): unknown {
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: `Error: AgentFuse blocked tool "${call.name}" (${reasonCode})`,
    // The structured decision (or nothing, for an unresolved deferral) — the
    // audit layer records it; raw arguments never appear.
    ...decision === undefined ? {} : { agentfuse: decision.evidence },
  }
}

/** Guarded dispatch: one LangGraph tool call in, one message (or result) out. */
export async function guardedDispatch(call: GraphToolCall): Promise<unknown> {
  const request: ToolCallRequest = {
    toolCallId: call.id,
    toolName: call.name,
    arguments: call.args,
  }

  const resolved = resolvePolicy(request, rules)

  if (resolved.action === 'ask') {
    // A production adapter defers to its human-approval mechanism here;
    // without one, fail closed. A deferral carries no final decision evidence
    // — the host approval layer owns that audit pair.
    return blockedMessage(call, undefined, resolved.reasonCode)
  }

  const decision = buildDecision(request, resolved)
  if (decision.action === 'block') {
    // Record decision.evidence on your audit log; never log call.args.
    return blockedMessage(call, decision, decision.reasonCode)
  }

  return dispatchTool(call)
}
