/**
 * Wraps a failure inside one leg of the SumUp sync while preserving how many
 * records that leg had already received (and persisted) before it failed.
 *
 * Without this, a leg that dies on a bad record after thousands of successful
 * upserts reports `records_received = 0` in `sync_runs`, which reads as "this
 * run did nothing" when in fact most of the work landed in the database.
 *
 * The original message is preserved verbatim so error assertions and log
 * greps behave the same as before the wrapping.
 */
export class SumupSyncLegError extends Error {
  readonly received: number

  constructor(message: string, options: { received: number; cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = 'SumupSyncLegError'
    this.received = options.received
  }
}

/** How many records a leg got through before failing (0 if unknown). */
export function receivedBeforeFailure(error: unknown): number {
  return error instanceof SumupSyncLegError ? error.received : 0
}
