import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { HttpError } from "../services/quotes";
import { idParam } from "../validation";

/** zod validation that returns a consistent 422 error body. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return c.json({ error: issues[0] ? `${issues[0].path ? issues[0].path + ": " : ""}${issues[0].message}` : "Invalid input", details: issues }, 422);
    }
  });
}

export function parseId(value: string | undefined): number {
  const r = idParam.safeParse(value);
  if (!r.success) throw new HttpError(400, "Invalid id.");
  return r.data;
}
