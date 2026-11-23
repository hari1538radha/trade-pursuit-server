export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Parse req.body (or any object) with a zod schema, throwing a 400 on failure. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.join('.') || 'body'}: ${first.message}`, r.error.issues);
  }
  return r.data;
}

export const isObjectId = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
