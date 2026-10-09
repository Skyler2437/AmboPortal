import * as Sentry from '@sentry/nextjs';

/** Record actionable failures without post text, RSVP explanations or credentials. */
export function reportOperationError(operation: string, error: unknown) {
  const detail = error as { code?: unknown; status?: unknown; stage?: unknown } | null;
  const code = typeof detail?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(detail.code) ? detail.code : 'unknown';
  Sentry.captureException(new Error(`Operation failed: ${operation}`), scope => {
    scope.setTag('operation', operation);
    scope.setTag('error_code', code);
    if (typeof detail?.status === 'number') scope.setTag('http_status', detail.status);
    if (['prepare', 'upload', 'publish'].includes(String(detail?.stage))) scope.setTag('stage', String(detail?.stage));
    scope.addEventProcessor(event => ({ ...event, request: undefined, breadcrumbs: undefined }));
    return scope;
  });
  console.error(`[${operation}] failed`, { code });
}
