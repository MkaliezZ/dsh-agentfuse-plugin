/**
 * Pure coverage for @agentfuse/core: policy precedence, default fail-closed
 * behavior, canonical argument hashing, and decision/evidence assembly.
 * No framework is mounted — these tests run anywhere vitest runs.
 */

import { describe, expect, it } from 'vitest'

import {
  argumentsHash,
  buildDecision,
  compileRules,
  evaluate,
  EVIDENCE_SCHEMA_VERSION,
  resolvePolicy,
  type ToolCallRequest,
} from '../src/index.ts'

function request(name: string, args: unknown = {}): ToolCallRequest {
  return { toolCallId: `call-${name}`, toolName: name, arguments: args }
}

describe('agentfuse policy resolution', () => {
  it('denylist always wins', () => {
    const rules = compileRules({ denyTools: ['danger'], defaultAction: 'allow' })
    expect(resolvePolicy(request('danger'), rules)).toMatchObject({
      action: 'block', reasonCode: 'explicit_denylist', policyId: 'agentfuse:denylist',
    })
  })

  it('asklist defers after the denylist and before the allowlist', () => {
    const askRules = compileRules({ askTools: ['danger'], allowTools: ['safe', 'danger'] })
    expect(resolvePolicy(request('danger'), askRules)).toMatchObject({
      action: 'ask', reasonCode: 'requires_approval', policyId: 'agentfuse:asklist',
    })

    // A deny beats the same name's ask entry.
    const denyBeatsAsk = compileRules({ denyTools: ['danger'], askTools: ['danger'] })
    expect(resolvePolicy(request('danger'), denyBeatsAsk)).toMatchObject({
      action: 'block', reasonCode: 'explicit_denylist',
    })

    // An asklisted name is deferred even when the allowlist would have blocked it.
    const askBeatsAllowlist = compileRules({ askTools: ['other'], allowTools: ['safe'] })
    expect(resolvePolicy(request('other'), askBeatsAllowlist)).toMatchObject({ action: 'ask' })
    expect(resolvePolicy(request('third'), askBeatsAllowlist)).toMatchObject({
      action: 'block', reasonCode: 'not_allowlisted',
    })
  })

  it('configured allowlist blocks a non-listed name and allows a listed one', () => {
    const rules = compileRules({ allowTools: ['safe'] })
    expect(resolvePolicy(request('other'), rules)).toMatchObject({
      action: 'block', reasonCode: 'not_allowlisted', policyId: 'agentfuse:allowlist',
    })
    expect(resolvePolicy(request('safe'), rules)).toMatchObject({
      action: 'allow', reasonCode: 'allowed', policyId: 'agentfuse:allowlist',
    })
  })

  it('fails closed on the default when nothing matches', () => {
    expect(resolvePolicy(request('anything'), compileRules({}))).toMatchObject({
      action: 'block', reasonCode: 'policy_denied', policyId: 'agentfuse:default:block',
    })
    expect(resolvePolicy(request('anything'), compileRules({ defaultAction: 'allow' }))).toMatchObject({
      action: 'allow', reasonCode: 'allowed', policyId: 'agentfuse:default:allow',
    })
  })

  it('evaluate is the pure resolution entry', () => {
    expect(evaluate(request('danger'), compileRules({ denyTools: ['danger'] }))).toMatchObject({
      action: 'block',
    })
  })
})

describe('agentfuse evidence', () => {
  it('argumentsHash is order-independent', () => {
    expect(argumentsHash({ b: 1, a: [2, 3] })).toBe(argumentsHash({ a: [2, 3], b: 1 }))
    expect(argumentsHash({ a: 1 })).not.toBe(argumentsHash({ a: 2 }))
  })

  it('a block decision carries non-execution evidence; an allow does not', () => {
    const blockResolved = resolvePolicy(request('danger'), compileRules({ denyTools: ['danger'] }))
    if (blockResolved.action === 'ask') throw new Error('unreachable: a deny resolves to block')
    const block = buildDecision(request('danger'), blockResolved)
    expect(block.action).toBe('block')
    expect(block.evidence.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION)
    expect(block.evidence.nonExecution).toMatchObject({ status: 'not_executed', execution: 'not_started' })

    const allowResolved = resolvePolicy(request('safe'), compileRules({ defaultAction: 'allow' }))
    if (allowResolved.action === 'ask') throw new Error('unreachable: the default resolves to allow')
    const allow = buildDecision(request('safe'), allowResolved)
    expect(allow.action).toBe('allow')
    expect(allow.evidence.nonExecution).toBeUndefined()
  })
})
