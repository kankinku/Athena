import { join } from "node:path";
import { homedir } from "node:os";

/** Root config/data directory. Override with ATHENA_HOME env var. */
export const ATHENA_DIR = process.env.ATHENA_HOME ?? join(homedir(), ".athena");
