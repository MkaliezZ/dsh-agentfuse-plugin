/**
 * Unit + real-load-path coverage for @deepseek-ai/dsh-agentfuse. The pure
 * policy/hash/evidence tests are deterministic; the gate tests drive the real
 * `tools/pre-execute` waterfall through `ctx.tools.execute` and assert the
 * fail-closed deny result without needing a full agent loop.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as agentfuse from '@deepseek-ai/dsh-agentfuse'
import { argumentsHash } from '@deepseek-ai/dsh-agentfuse/src/evidence'
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

const okTool = defineContentToolFixture({
  name: 'safe', description: 'safe tool', parameters: {},
  async execute() { return [{ type: 'text' as const, text: 'ok' }] },
})

function request(name: string, args: unknown = {}): ToolCallRequest {
  return { toolCallId: CallId(name), toolName: name, arguments: args }
}

describe('agentfuse policy resolution', () => {
  it('denylist always wins', () => {
    const rules = agentfuse.compileRules({ denyTools: ['danger'], defaultAction: 'allow' })
    expect(resolvePolicy(request('danger'), rules)).toMatchObject({
      action: 'block', reasonCode: 'explicit_denylist', policyId: 'agentfuse:denylist',
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
    const block = agentfuse.evaluate(request('danger'), agentfuse.compileRules({ denyTools: ['danger'] }))
    expect(block.action).toBe('block')
    expect(block.evidence.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION)
    expect(block.evidence.nonExecution).toMatchObject({ status: 'not_executed', execution: 'not_started' })

    const allow = agentfuse.evaluate(request('safe'), agentfuse.compileRules({ defaultAction: 'allow' }))
    expect(allow.action).toBe('allow')
    expect(allow.evidence.nonExecution).toBeUndefined()
  })
})

describe('agentfuse pre-execute gate', () => {
  it('denies a denylisted tool before dispatch', async () => {
    const { ctx, fiber } = await setup({ denyTools: ['danger'], defaultAction: 'allow' })
    try {
      ctx.tools.register(defineContentToolFixture({
        name: 'danger', description: 'dangerous', parameters: {},
        async execute() { return [{ type: 'text' as const, text: 'should not run' }] },
      }))
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

describe('dsh-agentfuse real-load-path guard', () => {
  it('has no default export and keeps name/apply through unwrapExports', () => {
    expect('default' in agentfuse).toBe(false)
    expect(agentfuse.name).toBe('agentfuse')
    expect(typeof agentfuse.apply).toBe('function')
  })
})
