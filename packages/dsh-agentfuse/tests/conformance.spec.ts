/** Conformance assertions generated from the pinned DHMS fixture snapshot. */

import { describe, expect, it } from 'vitest'

import {
  conformanceSummary,
  fixtureDigest,
  loadFixtures,
  loadProvenance,
  renderDshMatrix,
  runDshConformance,
} from './conformance.ts'


describe('AgentFuse v3.6.2 cross-adapter conformance', () => {
  it('pins a reproducible byte-identical fixture snapshot', async () => {
    const document = await loadFixtures()
    const provenance = await loadProvenance()

    expect(document.fixture_version).toBe(provenance.fixture_version)
    expect(await fixtureDigest()).toBe(provenance.fixture_sha256)
    expect(provenance.source_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(provenance.tested_dsh_commit).toBe('99f6f02fecdb7dff40c3fbc9470f5907c29f74ca')
    expect(document.canonical_policy_actions).toEqual(['allow', 'block'])
    expect(JSON.stringify(document)).not.toContain('agentfuse-v3.6.2-synthetic-sentinel')
  })

  it('runs every applicable case through the real DSH adapter path', async () => {
    const report = conformanceSummary(await runDshConformance())

    expect(report.result_count).toBe(14)
    expect(report.counts).toEqual({ PASS: 11, FAIL: 0, NOT_APPLICABLE: 3 })
  })

  it('uses N/A only for capabilities the current DSH contract does not expose', async () => {
    const notApplicable = (await runDshConformance()).filter(result => result.verdict === 'NOT_APPLICABLE')

    expect(notApplicable.map(result => result.case_id)).toEqual([
      '05_POLICY_EXCEPTION_FAIL_CLOSED',
      '06_INVALID_POLICY_DECISION_FAIL_CLOSED',
      '13_SYNC_ASYNC_PARITY',
    ])
    expect(notApplicable.every(result => result.verdict_reason.length > 20)).toBe(true)
  })

  it('keeps block, failure, and interruption as separate lifecycle facts', async () => {
    const byCase = new Map((await runDshConformance()).map(result => [result.case_id, result]))

    expect(byCase.get('02_STATIC_BLOCK')).toMatchObject({
      policy_decision: 'block',
      dispatch_observed: false,
      handler_started: false,
      execution_outcome: 'not_executed',
      host_result_is_error: true,
    })
    expect(byCase.get('08_ALLOW_THEN_HANDLER_FAILURE')).toMatchObject({
      policy_decision: 'allow',
      handler_started: true,
      execution_outcome: 'execution_failed',
    })
    expect(byCase.get('09_ALLOW_THEN_INTERRUPT')).toMatchObject({
      policy_decision: 'allow',
      handler_started: true,
      execution_outcome: 'interrupted',
      interruption_observed: true,
    })
  })

  it('preserves identity and one terminal result in the tested DSH path', async () => {
    const byCase = new Map((await runDshConformance()).map(result => [result.case_id, result]))

    expect(byCase.get('12_TOOL_CALL_IDENTITY')).toMatchObject({
      identity_preserved: true,
      terminal_settlement_count: 2,
    })
    expect(byCase.get('14_ONE_TERMINAL_SETTLEMENT')).toMatchObject({
      identity_preserved: true,
      terminal_settlement_count: 1,
    })
  })

  it('renders the matrix from observed results without leaking protected input', async () => {
    const results = await runDshConformance()
    const rendered = JSON.stringify(conformanceSummary(results)) + '\n' + renderDshMatrix(results)

    expect(rendered).not.toContain('agentfuse-v3.6.2-synthetic-sentinel')
    expect(rendered).toContain('11_DETERMINISTIC_REEVALUATION')
    expect(rendered).toContain('NOT_APPLICABLE')
  })
})
