#!/usr/bin/env node
/** Print deterministic DSH conformance results and a generated matrix. */

import {
  conformanceSummary,
  renderDshMatrix,
  runDshConformance,
} from './conformance.ts'


const results = await runDshConformance()
const report = conformanceSummary(results)

console.log(JSON.stringify(report))
console.log(renderDshMatrix(results))
if (report.counts.FAIL > 0) {
  throw new Error('AGENTFUSE_DSH_CROSS_ADAPTER_CONFORMANCE_FAIL')
}
console.log('AGENTFUSE_DSH_CROSS_ADAPTER_CONFORMANCE_PASS')
