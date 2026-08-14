/**
 * Unit + real-load-path coverage for @deepseek-ai/dsh-agentfuse. The pure
 * policy/hash/evidence tests are deterministic; the gate tests drive the real
 * `tools/pre-execute` waterfall through `ctx.tools.execute`; the ask tests
 * compose the real approval service with a scripted answerer to prove the
 * full allow-once/rejected loop.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as agentfuse from '@deepseek-ai/dsh-agentfuse'
import { argumentsHash, buildDecision } from '@deepseek-ai/dsh-agentfuse/src/evidence'
import { resolvePolicy } from '@deepseek-ai/dsh-agentfuse/src/policy'
import { EVIDENCE_SCHEMA_VERSION, type ToolCallRequest } from '@deepseek-ai/dsh-agentfuse/src/types'

const testToolSignal = new AbortController().signal

/** Mount the tool registry plus the agentfuse gate under the given config. */
async function setup(config: agentfuse.Config) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(agentfuse, config)
  return { ctx, fiber }
}

/** Mount the tool registry, the real approval service, and the agentfuse gate. */
async function setupWithApproval(config: agentfuse.Config) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService)
  const fiber = await ctx.plugin(agentfuse, config)
  return { ctx, fiber }
}

const okTool = defineContentToolFixture({
  name: 'safe', description: 'safe tool', parameters: {},
  async execute() { return [{ type: 'text' as const, text: 'ok' }] },
})

const dangerTool = defineContentToolFixture({
  name: 'danger', description: 'dangerous tool', parameters: {},
  async execute() { return [{ type: 'text' as const, text: 'danger-ran' }] },
})

function request(name: string, args: unknown = {}): ToolCallRequest {
  return { toolCallId: CallId(name), toolName: name, arguments: args }
}

/**
 * A minimal Agent stand-in with an open turn (the approval service's
 * turn-enclosure precondition) and a recording append — the same fixture
 * shape the user-approval tests use.
 */
function fakeAgent(): { agent: Agent; appended: Array<{ type: string }> } {
  const appended: Array<{ type: string }> = []
  const agent = {
    session: {
      events: [{ type: 'turn/start' }, { type: 'user/message' }],
      append: (type: string) => {
        appended.push({ type })
        return { type } as unknown as SessionEvent
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

describe('agentfuse policy resolution', () => {
  it('denylist always wins', () => {
    const rules = agentfuse.compileRules({ denyTools: ['danger'], defaultAction: 'allow' })
    expect(resolvePolicy(request('danger'), rules)).toMatchObject({
      action: 'block', reasonCode: 'explicit_denylist', policyId: 'agentfuse:denylist',
    })
  })

  it('asklist defers after the denylist and before the allowlist', () => {
    const askRules = agentfuse.compileRules({ askTools: ['danger'], allowTools: ['safe', 'danger'] })
    expect(resolvePolicy(request('danger'), askRules)).toMatchObject({
      action: 'ask', reasonCode: 'requires_approval', policyId: 'agentfuse:asklist',
    })

    // A deny beats the same name's ask entry.
    const denyBeatsAsk = agentfuse.compileRules({ denyTools: ['danger'], askTools: ['danger'] })
    expect(resolvePolicy(request('danger'), denyBeatsAsk)).toMatchObject({
      action: 'block', reasonCode: 'explicit_denylist',
    })

    // An asklisted name is deferred even when the allowlist would have blocked it.
    const askBeatsAllowlist = agentfuse.compileRules({ askTools: ['other'], allowTools: ['safe'] })
    expect(resolvePolicy(request('other'), askBeatsAllowlist)).toMatchObject({ action: 'ask' })
    expect(resolvePolicy(request('third'), askBeatsAllowlist)).toMatchObject({
      action: 'block', reasonCode: 'not_allowlisted',
    })
  })

  it('configured allowlist blocks a non-listed name and allows a listed one', () => {
    const rules = agentfuse.compileRules({ allowTools: ['safe'] })
    expect(resolvePolicy(request('other'), rules)).toMatchObject({
      action: 'block', reasonCode: 'not_allowlisted', policyId: 'agentfuse:allowlist',
    })
    expect(resolvePolicy(request('safe'), rules)).toMatchObject({
      action: 'allow', reasonCode: 'allowed', policyId: 'agentfuse:allowlist',
    })
  })

  it('fails closed on the default when nothing matches', () => {
    expect(resolvePolicy(request('anything'), agentfuse.compileRules({}))).toMatchObject({
      action: 'block', reasonCode: 'policy_denied', policyId: 'agentfuse:default:block',
    })
    expect(resolvePolicy(request('anything'), agentfuse.compileRules({ defaultAction: 'allow' }))).toMatchObject({
      action: 'allow', reasonCode: 'allowed', policyId: 'agentfuse:default:allow',
    })
  })
})

describe('agentfuse evidence', () => {
  it('argumentsHash is order-independent', () => {
    expect(argumentsHash({ b: 1, a: [2, 3] })).toBe(argumentsHash({ a: [2, 3], b: 1 }))
    expect(argumentsHash({ a: 1 })).not.toBe(argumentsHash({ a: 2 }))
  })

  it('a block decision carries non-execution evidence; an allow does not', () => {
    const blockResolved = resolvePolicy(request('danger'), agentfuse.compileRules({ denyTools: ['danger'] }))
    if (blockResolved.action === 'ask') throw new Error('unreachable: a deny resolves to block')
    const block = buildDecision(request('danger'), blockResolved)
    expect(block.action).toBe('block')
    expect(block.evidence.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION)
    expect(block.evidence.nonExecution).toMatchObject({ status: 'not_executed', execution: 'not_started' })

    const allowResolved = resolvePolicy(request('safe'), agentfuse.compileRules({ defaultAction: 'allow' }))
    if (allowResolved.action === 'ask') throw new Error('unreachable: the default resolves to allow')
    const allow = buildDecision(request('safe'), allowResolved)
    expect(allow.action).toBe('allow')
    expect(allow.evidence.nonExecution).toBeUndefined()
  })
})

describe('agentfuse pre-execute gate', () => {
  it('denies a denylisted tool before dispatch', async () => {
    const { ctx, fiber } = await setup({ denyTools: ['danger'], defaultAction: 'allow' })
    try {
      ctx.tools.register(dangerTool)
      ctx.tools.register(okTool)
      const denied = await ctx.tools.execute({ callId: CallId('c1'), name: 'danger', arguments: {}, signal: testToolSignal })
      expect(denied.isError).toBe(true)
      expect(denied.content[0]).toMatchObject({ text: 'Error: AgentFuse blocked tool "danger" (explicit_denylist)' })
      const allowed = await ctx.tools.execute({ callId: CallId('c2'), name: 'safe', arguments: {}, signal: testToolSignal })
      expect(allowed.isError).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })

  it('fails closed (default block) for an unconfigured name', async () => {
    const { ctx, fiber } = await setup({})
    try {
      ctx.tools.register(okTool)
      const denied = await ctx.tools.execute({ callId: CallId('c1'), name: 'safe', arguments: {}, signal: testToolSignal })
      expect(denied.isError).toBe(true)
      expect(denied.error?.message).toContain('policy_denied')
    } finally {
      await fiber.dispose()
    }
  })
})

describe('agentfuse ask deferral (DSH approval integration)', () => {
  it('degrades an ask to deny when no approval service is composed', async () => {
    const { ctx, fiber } = await setup({ askTools: ['danger'], defaultAction: 'allow' })
    try {
      ctx.tools.register(dangerTool)
      const denied = await ctx.tools.execute({ callId: CallId('c1'), name: 'danger', arguments: {}, signal: testToolSignal })
      expect(denied.isError).toBe(true)
      expect(denied.content[0]).toMatchObject({
        text: 'Error: AgentFuse requires approval for tool "danger" (requires_approval)',
      })
    } finally {
      await fiber.dispose()
    }
  })

  it('honors allowed-once from the approval chain and lets the tool run', async () => {
    const { ctx, fiber } = await setupWithApproval({ askTools: ['danger'], defaultAction: 'allow' })
    try {
      ctx.tools.register(dangerTool)
      const { agent, appended } = fakeAgent()
      ctx.on('approval/request', function () {
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      const result = await ctx.tools.execute({
        callId: CallId('c1'), name: 'danger', arguments: {}, agent, signal: testToolSignal,
      })
      expect(result.isError).toBe(false)
      // The approval layer, not AgentFuse, records the ask audit pair.
      expect(appended.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    } finally {
      await fiber.dispose()
    }
  })

  it('honors rejected from the approval chain and denies the tool', async () => {
    const { ctx, fiber } = await setupWithApproval({ askTools: ['danger'], defaultAction: 'allow' })
    try {
      ctx.tools.register(dangerTool)
      const { agent, appended } = fakeAgent()
      ctx.on('approval/request', function () {
        return Promise.resolve<ApprovalOutcome>('rejected')
      })
      const result = await ctx.tools.execute({
        callId: CallId('c1'), name: 'danger', arguments: {}, agent, signal: testToolSignal,
      })
      expect(result.isError).toBe(true)
      expect(result.error?.message).toContain('user rejected')
      expect(appended.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    } finally {
      await fiber.dispose()
    }
  })
})

describe('dsh-agentfuse real-load-path guard', () => {
  it('has no default export and keeps name/apply through unwrapExports', () => {
    expect('default' in agentfuse).toBe(false)
    expect(agentfuse.name).toBe('agentfuse')
    expect(typeof agentfuse.apply).toBe('function')
  })
})
