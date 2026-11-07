import type { AuthUser } from "./auth";
import type { Db } from "./db/client";
import type { Env } from "./env";

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser; db: Db } };
