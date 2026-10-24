import { initMonitoring, captureError } from './lib/monitoring';
import { bootWorker } from './lib/worker-boot';

/** Turn on error tracking (when SENTRY_DSN is set) and start the background worker. */
export async function startServerServices(): Promise<void> {
  await initMonitoring();
  bootWorker();
}

export function reportRequestError(error: unknown, request: { method: string; path: string }): void {
  // The path is enough to find the route; the query string can carry tokens, so it is dropped.
  captureError(error, { method: request.method, path: request.path.split('?')[0] });
}
