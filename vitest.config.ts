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
    env: {
      MEMORY_DB_PATH: testDbPath,
    },
  },
});
