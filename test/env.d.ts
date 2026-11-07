import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends EnvBindings {}
  }
  interface EnvBindings extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
