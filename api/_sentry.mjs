import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  initialized = true;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    enabled: !!process.env.SENTRY_DSN,
    tracesSampleRate: 0.2,
  });
}

/**
 * Capture une erreur et la reporte à Sentry.
 * @param {Error} err
 * @param {Record<string, any>} [context] - données supplémentaires
 */
export function captureError(err, context = {}) {
  initSentry();
  Sentry.withScope((scope) => {
    scope.setExtras(context);
    Sentry.captureException(err);
  });
}

export { Sentry };
