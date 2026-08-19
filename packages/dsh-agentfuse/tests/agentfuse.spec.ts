/**
 * DSH-adapter coverage for @dhms-agentfuse/dsh-agentfuse. The gate tests drive
 * the real `tools/pre-execute` waterfall through `ctx.tools.execute`; the ask
 * tests compose the real approval service with a scripted answerer to prove
 * the full allow-once/rejected loop. Pure policy/evidence behavior is covered
 * by `@dhms-agentfuse/core`'s own suite — imported here only where the adapter
 * touches it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as agentfuse from '@dhms-agentfuse/dsh-agentfuse'

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

  it('re-exports the core vocabulary for DSH consumers', () => {
    expect(typeof agentfuse.compileRules).toBe('function')
    expect(typeof agentfuse.evaluate).toBe('function')
    expect(typeof agentfuse.argumentsHash).toBe('function')
  })
})
