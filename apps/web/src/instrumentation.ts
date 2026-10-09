import * as Sentry from "@sentry/nextjs";
import { redactUploadTelemetry } from "@ambo/utils";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: process.env.NODE_ENV === "production",
      tracesSampleRate: 0.1,
      beforeSend: redactUploadTelemetry,
      beforeSendTransaction: redactUploadTelemetry,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: process.env.NODE_ENV === "production",
      tracesSampleRate: 0.1,
      beforeSend: redactUploadTelemetry,
      beforeSendTransaction: redactUploadTelemetry,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
