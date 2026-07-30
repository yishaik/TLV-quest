import * as Sentry from "@sentry/nextjs";

export type OperationalErrorContext = {
  correlationId?: string;
  errorCode?: string;
  operationalScope?: "live_run" | "background_worker";
  route?: string;
  statusCode?: number;
};

export const reportOperationalError = (
  error: unknown,
  {
    correlationId,
    errorCode = "internal_error",
    operationalScope,
    route,
    statusCode = 500
  }: OperationalErrorContext = {}
) => {
  const attributes = {
    error_code: errorCode,
    operational_scope: operationalScope ?? "other",
    route: route ?? "unknown",
    status_code: statusCode
  };

  Sentry.metrics.count("tlv_quest.api.errors", 1, { attributes });
  return Sentry.captureException(error, {
    tags: {
      ...(correlationId ? { correlation_id: correlationId } : {}),
      error_code: errorCode,
      ...(operationalScope
        ? { operational_scope: operationalScope }
        : {}),
      ...(route ? { route } : {}),
      status_code: String(statusCode)
    }
  });
};
