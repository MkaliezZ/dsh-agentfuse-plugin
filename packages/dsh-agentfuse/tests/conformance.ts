/** Real-path DSH consumer for the provider-neutral AgentFuse v3.6.2 fixtures. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineContentToolFixture,
  TOOL_ABORTED,
  type ToolExecution,
  type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'

import {
  argumentsHash,
  buildDecision,
  compileRules,
  resolvePolicy,
  type AgentFuseDecisionEventData,
  type PolicyConfig,
  type ResolvedPolicy,
  type ToolCallRequest,
} from '@agentfuse/core'
import * as agentfuse from '../src/index.ts'


const fixtureUrl = new URL('../conformance/cross_adapter_v3_6_2/fixtures.json', import.meta.url)
const provenanceUrl = new URL('../conformance/cross_adapter_v3_6_2/provenance.json', import.meta.url)
const syntheticSentinel = 'agentfuse-v3.6.2-synthetic-sentinel'

export const DSH_ADAPTER_ID = 'dsh-tools-pre-execute'

interface FixturePolicy {
  allow_tools: string[] | null
  deny_tools: string[]
  default_action: 'allow' | 'block'
}

export interface ConformanceCase {
  case_id: string
  tool_call_id: string
  secondary_tool_call_id?: string
  tool_name: string
  policy_mode: 'static' | 'exception' | 'invalid'
  policy: FixturePolicy
  host_scenario: string
  expected_policy: {
    decision: 'allow' | 'block'
    reason: string
    reason_class: string
    dispatch_allowed: boolean
  }
}

export interface FixtureDocument {
  fixture_version: string
  arguments_profile: string
  expected_arguments_digest: string
  canonical_policy_actions: Array<'allow' | 'block'>
  cases: ConformanceCase[]
}

export interface FixtureProvenance {
  source_repository: string
  source_commit: string
  fixture_path: string
  fixture_version: string
  fixture_sha256: string
  tested_dsh_repository: string
  tested_dsh_commit: string
}

export interface DshConformanceResult {
  fixture_version: string
  adapter_id: typeof DSH_ADAPTER_ID
  case_id: string
  policy_decision: 'allow' | 'block' | null
  policy_reason: string | null
  dispatch_observed: boolean | null
  handler_started: boolean | null
  execution_outcome: 'not_executed' | 'executed' | 'execution_failed' | 'interrupted' | null
  interruption_observed: boolean | null
  safe_output: boolean
  terminal_settlement_count: number | null
  identity_preserved: boolean | null
  host_result_is_error: boolean | null
  verdict: 'PASS' | 'FAIL' | 'NOT_APPLICABLE'
  verdict_reason: string
}

interface SessionAppend {
  type: string
  data?: unknown
}

interface RunObservation {
  bodyCount: number
  dispatchCount: number
  results: Array<{ callId: string; result: ToolExecutionResult }>
  decisionEvents: AgentFuseDecisionEventData[]
}

export async function loadFixtures(): Promise<FixtureDocument> {
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as FixtureDocument
}

export async function loadProvenance(): Promise<FixtureProvenance> {
  return JSON.parse(await readFile(provenanceUrl, 'utf8')) as FixtureProvenance
}

export async function fixtureDigest(): Promise<string> {
  return createHash('sha256').update(await readFile(fixtureUrl)).digest('hex')
}

function fixtureArguments(document: FixtureDocument): Record<string, unknown> {
  if (document.arguments_profile !== 'synthetic_sensitive_v1') {
    throw new Error(`unsupported arguments profile: ${document.arguments_profile}`)
  }
  return {
    operation: 'conformance',
    protected: { token: syntheticSentinel },
  }
}

function policyConfig(testCase: ConformanceCase): PolicyConfig {
  return {
    ...testCase.policy.allow_tools === null ? {} : { allowTools: testCase.policy.allow_tools },
    denyTools: testCase.policy.deny_tools,
    defaultAction: testCase.policy.default_action,
  }
}

function requestFor(document: FixtureDocument, testCase: ConformanceCase, callId: string): ToolCallRequest {
  return {
    toolCallId: callId,
    toolName: testCase.tool_name,
    arguments: fixtureArguments(document),
  }
}

function fakeAgent(appended: SessionAppend[]): Agent {
  return {
    session: {
      events: [{ type: 'turn/start' }, { type: 'user/message' }],
      append(type: string, data?: unknown) {
        appended.push({ type, data })
        return { type, data } as unknown as SessionEvent
      },
    },
  } as unknown as Agent
}

function notApplicable(document: FixtureDocument, testCase: ConformanceCase, reason: string): DshConformanceResult {
  return {
    fixture_version: document.fixture_version,
    adapter_id: DSH_ADAPTER_ID,
    case_id: testCase.case_id,
    policy_decision: null,
    policy_reason: null,
    dispatch_observed: null,
    handler_started: null,
    execution_outcome: null,
    interruption_observed: null,
    safe_output: true,
    terminal_settlement_count: null,
    identity_preserved: null,
    host_result_is_error: null,
    verdict: 'NOT_APPLICABLE',
    verdict_reason: reason,
  }
}

export function safeFailureReason(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.replaceAll(syntheticSentinel, '<redacted-sensitive-value>')
}

function failed(document: FixtureDocument, testCase: ConformanceCase, error: unknown): DshConformanceResult {
  const message = safeFailureReason(error)
  return {
    fixture_version: document.fixture_version,
    adapter_id: DSH_ADAPTER_ID,
    case_id: testCase.case_id,
    policy_decision: null,
    policy_reason: null,
    dispatch_observed: null,
    handler_started: null,
    execution_outcome: null,
    interruption_observed: null,
    safe_output: !message.includes(syntheticSentinel),
    terminal_settlement_count: null,
    identity_preserved: null,
    host_result_is_error: null,
    verdict: 'FAIL',
    verdict_reason: message,
  }
}

function toolFor(testCase: ConformanceCase, controller: AbortController, bodyCount: { value: number }) {
  return defineContentToolFixture({
    name: testCase.tool_name,
    description: 'local cross-adapter conformance tool',
    parameters: {
      operation: { type: 'string', required: true },
      protected: {
        type: 'object',
        properties: { token: { type: 'string', required: true } },
        additionalProperties: false,
        required: true,
      },
    },
    async execute() {
      bodyCount.value += 1
      if (testCase.host_scenario === 'handler_failure') {
        throw new Error('synthetic handler failure')
      }
      if (testCase.host_scenario === 'interrupt') {
        controller.abort()
      }
      return [{ type: 'text' as const, text: 'ok' }]
    },
  })
}

async function exerciseRealPath(
  document: FixtureDocument,
  testCase: ConformanceCase,
  callIds: string[],
): Promise<RunObservation> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const plugin = await ctx.plugin(agentfuse, { ...policyConfig(testCase), logDecisions: true })
  const controller = new AbortController()
  const bodyCount = { value: 0 }
  const dispatches: ToolExecution[] = []
  const results: Array<{ callId: string; result: ToolExecutionResult }> = []
  const appended: SessionAppend[] = []
  const useAgent = testCase.host_scenario === 'safe_receipt'
  const agent = useAgent ? fakeAgent(appended) : undefined

  ctx.tools.register(toolFor(testCase, controller, bodyCount))
  ctx.on('tools/execute', async (exec, next) => {
    dispatches.push(exec)
    return await next()
  })
  ctx.on('tools/result', (exec, result) => {
    results.push({ callId: String(exec.callId), result })
  })
  try {
    for (const callId of callIds) {
      await ctx.tools.execute({
        callId: CallId(callId),
        name: testCase.tool_name,
        arguments: fixtureArguments(document),
        ...agent === undefined ? {} : { agent },
        signal: controller.signal,
      })
    }
  } finally {
    await plugin.dispose()
  }
  return {
    bodyCount: bodyCount.value,
    dispatchCount: dispatches.length,
    results,
    decisionEvents: appended
      .filter((entry): entry is SessionAppend & { data: AgentFuseDecisionEventData } => (
        entry.type === 'agentfuse/decision' && entry.data !== undefined
      ))
      .map(entry => entry.data),
  }
}

function classifyOutcome(
  decision: ResolvedPolicy,
  testCase: ConformanceCase,
  observation: RunObservation,
): DshConformanceResult['execution_outcome'] {
  if (decision.action === 'block') return 'not_executed'
  if (testCase.host_scenario === 'handler_failure') return 'execution_failed'
  if (testCase.host_scenario === 'interrupt') return 'interrupted'
  if (observation.bodyCount > 0) return 'executed'
  throw new Error('allowed DSH path produced no recognized lifecycle outcome')
}

async function runCase(document: FixtureDocument, testCase: ConformanceCase): Promise<DshConformanceResult> {
  if (testCase.policy_mode === 'exception' || testCase.policy_mode === 'invalid') {
    return notApplicable(
      document,
      testCase,
      'the current DSH core exposes static PolicyConfig only; it has no call-level custom policy callable to throw or return an invalid decision',
    )
  }
  if (testCase.host_scenario === 'sync_async_parity') {
    return notApplicable(
      document,
      testCase,
      'DSH ToolRuntime exposes one asynchronous execute path rather than separate sync and async policy APIs',
    )
  }
  try {
    const rules = compileRules(policyConfig(testCase))
    const request = requestFor(document, testCase, testCase.tool_call_id)
    const resolution = resolvePolicy(request, rules)
    if (resolution.action === 'ask') throw new Error('canonical fixture resolved to adapter-specific ask')
    const decision = buildDecision(request, resolution)
    if (decision.action !== testCase.expected_policy.decision) throw new Error('policy decision drift')
    if (decision.reasonCode !== testCase.expected_policy.reason) throw new Error('policy reason drift')
    if (argumentsHash(request.arguments) !== document.expected_arguments_digest) throw new Error('arguments digest drift')

    if (testCase.host_scenario === 'reevaluate') {
      const repeated = resolvePolicy(request, rules)
      if (repeated.action === 'ask') throw new Error('canonical fixture reevaluated to adapter-specific ask')
      if (JSON.stringify(buildDecision(request, repeated)) !== JSON.stringify(decision)) {
        throw new Error('deterministic reevaluation drift')
      }
    }

    const callIds = testCase.host_scenario === 'identity'
      ? [testCase.tool_call_id, String(testCase.secondary_tool_call_id)]
      : [testCase.tool_call_id]
    const observation = await exerciseRealPath(document, testCase, callIds)
    const outcomes = observation.results.map(entry => entry.result)
    const outcome = classifyOutcome(resolution, testCase, observation)
    const expectedDispatchCount = decision.action === 'block' ? 0 : callIds.length
    const expectedBodyCount = decision.action === 'block' ? 0 : callIds.length
    if (observation.dispatchCount !== expectedDispatchCount) throw new Error('dispatch count drift')
    if (observation.bodyCount !== expectedBodyCount) throw new Error('protected body count drift')
    if (observation.results.length !== callIds.length) throw new Error('terminal settlement count drift')
    if (observation.results.map(entry => entry.callId).join('|') !== callIds.join('|')) {
      throw new Error('tool-call identity drift')
    }
    if (decision.action === 'block' && outcomes.some(result => !result.isError)) {
      throw new Error('DSH host failed to materialize the blocked path')
    }
    if (testCase.host_scenario === 'handler_failure' && outcomes.some(result => !result.isError)) {
      throw new Error('DSH host failed to materialize handler failure')
    }
    if (testCase.host_scenario === 'interrupt' && outcomes.some(result => result.error?.info?.code !== TOOL_ABORTED)) {
      throw new Error('DSH interruption did not preserve the ABORTED host outcome')
    }
    if (testCase.host_scenario === 'safe_receipt') {
      if (observation.decisionEvents.length !== 1) throw new Error('expected one safe decision event')
      if (observation.decisionEvents[0]?.argumentsHash !== document.expected_arguments_digest) {
        throw new Error('safe decision event digest drift')
      }
    }
    if (JSON.stringify({ decisionEvents: observation.decisionEvents, results: observation.results }).includes(syntheticSentinel)) {
      throw new Error('raw protected argument leaked through a DSH event or host result')
    }
    const serializedSafeOutput = JSON.stringify({
      decision,
      decisionEvents: observation.decisionEvents,
      hostResults: outcomes.map(result => ({
        isError: result.isError,
        errorCode: result.error?.info?.code,
      })),
    })
    if (serializedSafeOutput.includes(syntheticSentinel)) throw new Error('raw protected argument leaked')

    return {
      fixture_version: document.fixture_version,
      adapter_id: DSH_ADAPTER_ID,
      case_id: testCase.case_id,
      policy_decision: decision.action,
      policy_reason: decision.reasonCode,
      dispatch_observed: observation.dispatchCount > 0,
      handler_started: observation.bodyCount > 0,
      execution_outcome: outcome,
      interruption_observed: outcome === 'interrupted',
      safe_output: true,
      terminal_settlement_count: observation.results.length,
      identity_preserved: true,
      host_result_is_error: outcomes[0]?.isError ?? null,
      verdict: 'PASS',
      verdict_reason: 'all applicable invariants passed through the real DSH ToolRuntime path',
    }
  } catch (error: unknown) {
    return failed(document, testCase, error)
  }
}

export async function runDshConformance(): Promise<DshConformanceResult[]> {
  const document = await loadFixtures()
  const results: DshConformanceResult[] = []
  for (const testCase of document.cases) {
    results.push(await runCase(document, testCase))
  }
  return results.sort((left, right) => left.case_id.localeCompare(right.case_id))
}

export function renderDshMatrix(results: DshConformanceResult[]): string {
  const rows = [['CASE', DSH_ADAPTER_ID], ...results.map(result => [result.case_id, result.verdict])]
  const widths = [0, 1].map(index => Math.max(...rows.map(row => row[index]?.length ?? 0)))
  return rows
    .map(row => row.map((value, index) => value?.padEnd(widths[index] ?? 0)).join('  ').trimEnd())
    .join('\n')
}

export function conformanceSummary(results: DshConformanceResult[]) {
  return {
    fixture_version: results[0]?.fixture_version,
    result_count: results.length,
    counts: {
      PASS: results.filter(result => result.verdict === 'PASS').length,
      FAIL: results.filter(result => result.verdict === 'FAIL').length,
      NOT_APPLICABLE: results.filter(result => result.verdict === 'NOT_APPLICABLE').length,
    },
    results,
  }
}
