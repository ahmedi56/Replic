/**
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * The Node-only work lives in its own file and is imported inside a positive
 * `NEXT_RUNTIME === 'nodejs'` check. Next.js compiles this file for the edge runtime as well,
 * and only this exact shape lets it drop the import there; otherwise it tries to bundle the
 * database driver for an environment that has no filesystem.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startServerServices } = await import('./instrumentation-node');
    await startServerServices();
  }
}

/** Errors thrown while rendering a page or running a route that Next.js caught. */
export async function onRequestError(error: unknown, request: { method: string; path: string }): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportRequestError } = await import('./instrumentation-node');
    reportRequestError(error, request);
  }
}
