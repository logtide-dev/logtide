/**
 * Inbound receiver event processing (#155). The public endpoint stores the raw
 * payload and enqueues this job; here the adapter normalizes it and the result
 * goes through the normal ingestion pipeline (PII masking, quotas, Sigma).
 * Failures are recorded on the event row for the UI; no automatic retry.
 */
import { logSchema, type LogInput } from '@logtide/shared';
import { context } from '@logtide/shared/context';
import type { IJob } from '../abstractions/types.js';
import { receiversService, ReceiversService } from '../../modules/receivers/service.js';
import { getAdapter, type AdapterResult } from '../../modules/receivers/adapters/index.js';
import { ingestionService } from '../../modules/ingestion/service.js';

export const RECEIVER_EVENTS_QUEUE = 'receiver-events';

export interface ReceiverEventJobData {
  eventId: string;
}

export async function processReceiverEvent(job: IJob<ReceiverEventJobData>): Promise<void> {
  const event = await receiversService.getEventWithReceiver(job.data.eventId);
  if (!event) {
    console.warn(`[ReceiverEvent] event ${job.data.eventId} not found, skipping`);
    return;
  }
  if (event.status !== 'pending') {
    return; // idempotent: already terminal
  }

  let result: AdapterResult;
  try {
    const adapter = getAdapter(event.adapterType);
    result = adapter(event.rawPayload, {
      id: event.id,
      name: event.name,
      adapterType: event.adapterType,
      fieldMapping: event.fieldMapping,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await receiversService.completeEvent(event.eventId, {
      status: 'failed',
      error: `adapter error: ${message}`,
    });
    return;
  }

  if (result.kind === 'skipped') {
    await receiversService.completeEvent(event.eventId, {
      status: 'skipped',
      error: result.reason,
    });
    await finalize(event.id);
    return;
  }

  const valid: LogInput[] = [];
  const invalid: string[] = [];
  for (const log of result.logs) {
    const parsed = logSchema.safeParse(log);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push(parsed.error.errors.map((e) => e.message).join('; '));
  }

  if (valid.length === 0) {
    await receiversService.completeEvent(event.eventId, {
      status: 'failed',
      normalized: result.logs,
      error: `adapter produced no valid logs: ${invalid.join(' | ')}`,
    });
    await finalize(event.id);
    return;
  }

  try {
    const ingestResult = await context.runAsSystem('receiver-event', () =>
      context.with(
        { organizationId: event.organizationId, projectId: event.projectId },
        () => ingestionService.ingestLogs(valid, event.projectId)
      )
    );

    if (ingestResult.received === 0) {
      const reasons = ingestResult.rejected.map((r) => r.reason).join('; ');
      await receiversService.completeEvent(event.eventId, {
        status: 'failed',
        normalized: valid,
        error: `all logs rejected by ingestion: ${reasons}`,
      });
    } else {
      const partial =
        ingestResult.rejected.length > 0
          ? `${ingestResult.rejected.length} of ${result.logs.length} logs rejected`
          : null;
      await receiversService.completeEvent(event.eventId, {
        status: 'processed',
        normalized: valid,
        error: partial,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await receiversService.completeEvent(event.eventId, {
      status: 'failed',
      normalized: valid,
      error: `ingestion failed: ${message}`,
    });
  }

  await finalize(event.id);
}

async function finalize(receiverId: string): Promise<void> {
  await receiversService.touchLastReceived(receiverId);
  await receiversService.pruneEvents(receiverId, ReceiversService.MAX_EVENTS_PER_RECEIVER);
}
