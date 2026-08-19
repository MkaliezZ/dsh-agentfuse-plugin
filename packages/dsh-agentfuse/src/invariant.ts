/**
 * Package-owned invariant companion for `@dhms-agentfuse/dsh-agentfuse`.
 * @module @dhms-agentfuse/dsh-agentfuse/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dhms-agentfuse/dsh-agentfuse'

/** Cordis companion plugin name. */
export const name = 'agentfuse-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless policy plugin owns no package-local
 * event history or mutable data relation beyond the seam it intercepts. The
 * durable `agentfuse/decision` event is validated by the session layer's own
 * JSON-serializability check at append time.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
