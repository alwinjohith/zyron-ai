import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";
import fs from "fs";

// Use an isolated temporary database for tests so production data
// in ./data/memory.db is never read, modified, or deleted.
const testDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "zyron-memory-")),
  "memory.test.db"
);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // The SQLite test DB is a single shared path; run test files
    // sequentially in one worker so they never interfere.
    fileParallelism: false,
    env: {
      MEMORY_DB_PATH: testDbPath,
    },
  },
});
