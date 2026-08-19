/**
 * @dhms-agentfuse/core — framework-agnostic AgentFuse policy engine.
 *
 * The complete decision vocabulary, deterministic policy resolution, and
 * evidence construction live here with zero runtime dependencies. Framework
 * adapters (e.g. the DeepSeek Harness plugin) import this package and add only
 * their own wiring: config validation, the pre-dispatch hook, and the durable
 * audit event.
 *
 * @module @dhms-agentfuse/core
 */

export * from './types.ts'
export * from './policy.ts'
export * from './evidence.ts'
