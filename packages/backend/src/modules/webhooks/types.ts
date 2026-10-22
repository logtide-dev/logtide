export interface DeliverOnceParams {
  url: string;
  body: unknown;
  organizationId: string | null;
  eventType: string;
  signingSecret?: string;
  headers?: Record<string, string>;
  /** HTTP method, defaults to POST. */
  method?: string;
  /** Extra context forwarded to the beforeWebhookDispatch hook. */
  channelId?: string;
  ruleId?: string;
}

export interface DeliverOnceResult {
  success: boolean;
  statusCode?: number;
  durationMs: number;
  responseExcerpt?: string;
  error?: string;
  /** Whether a failure is worth retrying (network/timeout/5xx/429). */
  retryable: boolean;
}

export interface EnqueueParams {
  url: string;
  payload: unknown;
  organizationId: string;
  eventType: string;
  /** Stable id for idempotency. Defaults to a hash of url+payload if omitted. */
  eventId?: string;
  signingSecret?: string;
  headers?: Record<string, string>;
  /** HTTP method for the queued request, defaults to POST. */
  method?: string;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
  channelId?: string;
  ruleId?: string;
}

export interface WebhookDeliveryJobData {
  deliveryId: string;
}
