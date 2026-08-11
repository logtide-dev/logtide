/**
 * Webhook dispatcher (#218).
 *
 * `deliverOnce` is the single-attempt primitive shared by the synchronous
 * notification-channel provider and the queued retry layer: it runs the
 * beforeWebhookDispatch hook, signs the body, and sends via the SSRF guard.
 * `enqueue` layers persistence + retry + DLQ on top.
 */
import { createHash } from 'crypto';
import { config } from '../../config/index.js';
import { safeFetch, SsrfBlockedError } from '../../utils/ssrf-guard.js';
import { hooks, HookRejectionError } from '../../hooks/index.js';
import { buildSignatureHeaders } from './signing.js';
import { formatOutbound } from './formatters/index.js';
import { createQueue } from '../../queue/connection.js';
import { webhookDeliveryService } from './service.js';
import type { DeliverOnceParams, DeliverOnceResult, EnqueueParams, WebhookDeliveryJobData } from './types.js';

const RESPONSE_EXCERPT_MAX = 500;

export async function deliverOnce(params: DeliverOnceParams): Promise<DeliverOnceResult> {
  const started = Date.now();

  /** Fire afterWebhookDispatch fire-and-forget. Covers 5 of the 6 return paths (the
   *  invalid-URL early return intentionally skips it: no delivery attempt was made). */
  function fireAfterDispatch(result: DeliverOnceResult): void {
    if (!hooks.hasHandlers('afterWebhookDispatch')) return;
    void hooks.runAfter('afterWebhookDispatch', {
      organizationId: params.organizationId ?? null,
      channelId: params.channelId,
      ruleId: params.ruleId,
      eventType: params.eventType,
      url: params.url,
      success: result.success,
      statusCode: result.statusCode ?? null,
      durationMs: result.durationMs,
      error: result.error ?? null,
      retryable: result.retryable,
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'LogTide/1.0',
    ...(params.headers ?? {}),
  };

  // Lifecycle hook (#216): last interception point before the outbound call.
  // Runs BEFORE the body is serialized and signed so that header/body mutations
  // made by the hook reach the actual request (and are covered by the signature).
  if (hooks.hasHandlers('beforeWebhookDispatch')) {
    let targetHost: string;
    try {
      targetHost = new URL(params.url).hostname;
    } catch {
      return { success: false, durationMs: Date.now() - started, error: 'Invalid webhook URL', retryable: false };
    }
    try {
      await hooks.run('beforeWebhookDispatch', {
        organizationId: params.organizationId,
        channelId: params.channelId,
        ruleId: params.ruleId,
        url: params.url,
        targetHost,
        headers,
        body: params.body as Record<string, unknown>,
      });
    } catch (e) {
      const msg = e instanceof HookRejectionError ? `rejected: ${e.message}` : 'blocked: hook failed';
      const result: DeliverOnceResult = { success: false, durationMs: Date.now() - started, error: `Webhook dispatch ${msg}`, retryable: false };
      fireAfterDispatch(result);
      return result;
    }
  }

  // Serialize and sign AFTER the hook so mutations are included.
  // Destination-specific body shape runs here too: after the hook, so handlers
  // keep seeing the canonical envelope whatever the destination, and before
  // signing, so the signature covers the bytes actually sent.
  const bodyString = JSON.stringify(formatOutbound(params.url, params.body ?? {}));
  if (params.signingSecret) {
    const unix = Math.floor(Date.now() / 1000);
    Object.assign(headers, buildSignatureHeaders(params.signingSecret, bodyString, unix));
  }
  // Always advertise the envelope version so receivers can version-check without
  // parsing the body. Placed after hook mutation so it cannot be silently overwritten.
  headers['X-Logtide-Event-Version'] = '1';

  try {
    const response = await safeFetch(
      params.url,
      {
        method: params.method ?? 'POST',
        headers,
        body: bodyString,
        signal: AbortSignal.timeout(config.WEBHOOK_REQUEST_TIMEOUT_MS),
      },
      { allowPrivate: config.MONITOR_ALLOW_PRIVATE_TARGETS }
    );

    const durationMs = Date.now() - started;
    if (response.ok) {
      const result: DeliverOnceResult = { success: true, statusCode: response.status, durationMs, retryable: false };
      fireAfterDispatch(result);
      return result;
    }
    const excerpt = (await response.text().catch(() => '')).slice(0, RESPONSE_EXCERPT_MAX);
    const result: DeliverOnceResult = {
      success: false,
      statusCode: response.status,
      durationMs,
      responseExcerpt: excerpt,
      error: `HTTP ${response.status} ${response.statusText}`,
      retryable: response.status >= 500 || response.status === 429,
    };
    fireAfterDispatch(result);
    return result;
  } catch (e) {
    const durationMs = Date.now() - started;
    if (e instanceof SsrfBlockedError) {
      const result: DeliverOnceResult = {
        success: false,
        durationMs,
        error: 'Webhook URLs pointing to private/internal addresses are not allowed',
        retryable: false,
      };
      fireAfterDispatch(result);
      return result;
    }
    // Network errors and timeouts (AbortError) are transient.
    const result: DeliverOnceResult = {
      success: false,
      durationMs,
      error: e instanceof Error ? e.message : 'Unknown error',
      retryable: true,
    };
    fireAfterDispatch(result);
    return result;
  }
}

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
const webhookQueue = createQueue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE);

function deriveEventId(params: EnqueueParams): string {
  if (params.eventId) return params.eventId;
  // When the payload is a webhook envelope its id is already globally unique
  // and stable; use it directly so the jobKey deduplicates on the envelope id.
  // Fall back to a content hash for non-envelope payloads.
  if (
    params.payload !== null &&
    typeof params.payload === 'object' &&
    'id' in params.payload &&
    typeof (params.payload as Record<string, unknown>).id === 'string' &&
    ((params.payload as Record<string, unknown>).id as string).startsWith('evt_')
  ) {
    return (params.payload as Record<string, unknown>).id as string;
  }
  return createHash('sha256')
    .update(`${params.url}\n${JSON.stringify(params.payload ?? {})}`)
    .digest('hex')
    .slice(0, 32);
}

export const webhookDispatcher = {
  deliverOnce,

  /**
   * Persist a delivery row and enqueue it.
   *
   * Deduplication of upstream double-enqueues is done here, explicitly and
   * bounded: an identical event already in flight and created within
   * WEBHOOK_DEDUP_WINDOW_MS returns that delivery instead of creating a second
   * one. It deliberately does NOT ride on the queue's job key, because key
   * retention differs per backend: BullMQ keeps a completed job's id forever
   * unless removeOnComplete is set, which turned dedup into permanent
   * suppression and left every later occurrence stranded at status='pending'.
   * The job key is per delivery row (unique by construction) so the queue can
   * only ever collapse two workers racing the same row.
   *
   * Retries are driven manually by the job re-enqueueing itself, so the queue's
   * own retry is disabled (maxAttempts: 1).
   */
  async enqueue(params: EnqueueParams): Promise<{ deliveryId: string }> {
    const eventId = deriveEventId(params);

    const inFlight = await webhookDeliveryService.findInFlightDelivery({
      organizationId: params.organizationId,
      eventType: params.eventType,
      eventId,
      since: new Date(Date.now() - config.WEBHOOK_DEDUP_WINDOW_MS),
    });
    if (inFlight) return { deliveryId: inFlight.id };

    const delivery = await webhookDeliveryService.createDelivery({
      organizationId: params.organizationId,
      eventType: params.eventType,
      eventId,
      url: params.url,
      maxAttempts: params.maxAttempts ?? config.WEBHOOK_MAX_ATTEMPTS,
      metadata: {
        payload: params.payload as Record<string, unknown>,
        signingSecret: params.signingSecret ?? null,
        headers: params.headers ?? null,
        channelId: params.channelId ?? null,
        ruleId: params.ruleId ?? null,
        ...(params.metadata ?? {}),
      },
    });
    await webhookQueue.add('deliver', { deliveryId: delivery.id }, {
      jobKey: `webhook-${delivery.id}`,
      maxAttempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return { deliveryId: delivery.id };
  },

  /**
   * Re-enqueue an already-persisted delivery (used by manual replay). The
   * jobKey dedupes rapid double-replays of the same delivery; removeOnComplete
   * keeps that dedup window to the job's lifetime instead of forever, so a
   * delivery can be replayed again later.
   */
  async enqueueExisting(deliveryId: string): Promise<void> {
    await webhookQueue.add('deliver', { deliveryId }, {
      jobKey: `webhook-replay-${deliveryId}`,
      maxAttempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  },
};
