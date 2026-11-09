/**
 * The reason the server gave for refusing a weak password, or null.
 * Auth routes answer 400 { error: 'Validation error', details: [{ code: 'weak_password', message }] }.
 */
export function weakPasswordMessage(body: unknown): string | null {
  const details = (body as { details?: unknown } | null)?.details;
  if (!Array.isArray(details)) return null;
  const weak = details.find(
    (d): d is { code: string; message: string } =>
      !!d && typeof d === 'object' && (d as { code?: unknown }).code === 'weak_password'
  );
  return weak && typeof weak.message === 'string' ? weak.message : null;
}
