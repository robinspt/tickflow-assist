import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Database } from "../db.js";
import { Jin10FlashRepository } from "./jin10-flash-repo.js";

test("getLatest returns the record with the greatest published_ts instead of the last appended row", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-jin10-repo-test-"));

  try {
    const repository = new Jin10FlashRepository(new Database(tempRoot));

    await repository.saveAll([
      {
        flash_key: "newer",
        published_at: "2026-04-10 10:31:00",
        published_ts: new Date("2026-04-10T10:31:00+08:00").getTime(),
        content: "较新的快讯",
        url: "https://flash.example/newer",
        ingested_at: "2026-04-10 10:31:05",
        raw: {},
      },
    ]);
    await repository.saveAll([
      {
        flash_key: "older",
        published_at: "2026-04-10 03:39:09",
        published_ts: new Date("2026-04-10T03:39:09+08:00").getTime(),
        content: "较旧的补页快讯",
        url: "https://flash.example/older",
        ingested_at: "2026-04-10 10:32:00",
        raw: {},
      },
    ]);

    const latest = await repository.getLatest();

    assert.ok(latest);
    assert.equal(latest.flash_key, "newer");
    assert.equal(latest.published_at, "2026-04-10 10:31:00");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
