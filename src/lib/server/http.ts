// Server-only. Response helpers that keep every endpoint on the same envelope.
import type { z } from 'zod';
import type { ErrorCode, ErrorResponse } from '../schemas/user';

// 400 is for a body that cannot be parsed at all; 422 for well-formed JSON that fails the
// schema (RFC 9110 §15.5.21). See docs/DECISIONS.md.
const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  email_taken: 409,
  payload_too_large: 413,
  validation_error: 422,
  idempotency_key_reused: 422,
  rate_limited: 429,
  internal: 500,
};

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // API responses are per-request and may contain personal data.
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ErrorResponse = { error: { code, message, ...(fields ? { fields } : {}) } };
  const headers: Record<string, string> =
    code === 'unauthorized' ? { 'WWW-Authenticate': 'Bearer' } : {};
  return json(STATUS[code], body, { ...headers, ...extraHeaders });
}

/** 422 validation_error. Root-level issues become the message; field issues go into `fields`. */
export function validationError(error: z.ZodError): Response {
  const fields: Record<string, string> = {};
  let message = 'Invalid request';
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] ??= 'Unrecognized field';
    } else if (issue.path.length === 0) {
      message = issue.message;
    } else {
      fields[issue.path.map(String).join('.')] ??= issue.message;
    }
  }
  return errorResponse(
    'validation_error',
    message,
    Object.keys(fields).length > 0 ? fields : undefined,
  );
}

/** Largest request body the API accepts. Matches `bodySizeLimit` in astro.config.mjs. */
export const MAX_BODY_BYTES = 16 * 1024;

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

const tooLarge = (): BodyResult => ({
  ok: false,
  response: errorResponse(
    'payload_too_large',
    `Request body must be at most ${MAX_BODY_BYTES} bytes`,
  ),
});

const invalidJson = (): BodyResult => ({
  ok: false,
  response: errorResponse('bad_request', 'Request body must be valid JSON'),
});

/** The node adapter's own limit surfaces as this error while the body is read. */
const isAdapterSizeLimitError = (err: unknown) =>
  err instanceof Error && err.message.startsWith('Body size limit exceeded');

/**
 * Reads a JSON body of at most MAX_BODY_BYTES. A declared Content-Length over the cap is
 * rejected unread; otherwise the bytes are counted as they stream in, which also covers chunked
 * requests that send no Content-Length. Oversized is a 413; empty, unreadable or non-JSON is a
 * 400 bad_request; never a 500. Valid JSON of the wrong shape is the schema's job (422).
 */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) return tooLarge();

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    const reader = request.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(value);
    }
  } catch (err) {
    return isAdapterSizeLimitError(err) ? tooLarge() : invalidJson();
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return invalidJson();
  }
}

/** 500 with a generic message. Details go to the server log only, never to the client. */
export function internalError(route: string, err: unknown): Response {
  console.error(`[${route}] unhandled error`, err);
  return errorResponse('internal', 'Something went wrong. Please try again.');
}
