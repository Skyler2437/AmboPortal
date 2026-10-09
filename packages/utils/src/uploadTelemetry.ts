/** Signed upload URLs are temporary credentials, including when captured in HTTP spans. */
export function redactUploadTelemetry<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/(\/object\/upload\/sign\/[^?\s"']+)\?[^\s"']+/g, '$1?[redacted]') as T;
  }
  if (Array.isArray(value)) return value.map(redactUploadTelemetry) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, ['upload_ticket', 'previous_ticket'].includes(key) ? '[redacted]' : redactUploadTelemetry(item),
    ])) as T;
  }
  return value;
}
