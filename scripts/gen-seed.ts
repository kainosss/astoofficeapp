// Prints the development seed SQL to stdout. Used by `npm run db:seed:local`.
import { seedSql } from "../src/worker/db/seed";

console.log(seedSql().join("\n"));
