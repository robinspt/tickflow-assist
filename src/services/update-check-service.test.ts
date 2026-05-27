import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UpdateCheckService, compareVersions } from "./update-check-service.js";
import type { UpdateCheckState } from "../types/update-check.js";

test("compareVersions compares semver versions with v-prefix support", () => {
  assert.equal(compareVersions("v0.3.11", "0.3.10"), 1);
  assert.equal(compareVersions("0.3.10", "0.3.10"), 0);
  assert.equal(compareVersions("0.3.9", "0.3.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
});

test("runScheduledCheck sends one notification for a newer npm or release version", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-update-check-test-"));
  const sentMessages: string[] = [];

  try {
    const service = createService(tempRoot, {
      currentVersion: "0.3.10",
      sentMessages,
      versions: {
        npm: "0.3.11",
        github: "v0.3.10",
      },
    });

    const first = await service.runScheduledCheck(new Date("2026-05-27T13:00:00.000Z"));
    const second = await service.runScheduledCheck(new Date("2026-05-27T13:05:00.000Z"));
    const state = await readState(tempRoot);

    assert.deepEqual(first, {
      checked: true,
      updateAvailable: true,
      notified: true,
      reason: "update_available",
    });
    assert.equal(second.checked, false);
    assert.equal(second.reason, "already_checked_today");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0] ?? "", /当前版本: v0\.3\.10/);
    assert.match(sentMessages[0] ?? "", /最新版本: v0\.3\.11/);
    assert.equal(state.lastNotifiedVersion, "0.3.11");
    assert.equal(state.latestSource, "npm");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledCheck does not notify when the current version is current", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-update-check-test-"));
  const sentMessages: string[] = [];

  try {
    const service = createService(tempRoot, {
      currentVersion: "0.3.10",
      sentMessages,
      versions: {
        npm: "0.3.10",
        github: "v0.3.10",
      },
    });

    const result = await service.runScheduledCheck(new Date("2026-05-27T13:00:00.000Z"));
    const state = await readState(tempRoot);

    assert.equal(result.checked, true);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.notified, false);
    assert.equal(sentMessages.length, 0);
    assert.equal(state.lastResultType, "up_to_date");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledCheck skips before 21:00 Beijing time", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-update-check-test-"));
  const sentMessages: string[] = [];

  try {
    const service = createService(tempRoot, {
      currentVersion: "0.3.10",
      sentMessages,
      versions: {
        npm: "0.3.11",
      },
    });

    const result = await service.runScheduledCheck(new Date("2026-05-27T12:59:00.000Z"));

    assert.deepEqual(result, {
      checked: false,
      updateAvailable: false,
      notified: false,
      reason: "before_update_check_time",
    });
    assert.equal(sentMessages.length, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledCheck records a failed check without sending a notification", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-update-check-test-"));
  const sentMessages: string[] = [];

  try {
    const service = createService(tempRoot, {
      currentVersion: "0.3.10",
      sentMessages,
      versions: {},
    });

    const result = await service.runScheduledCheck(new Date("2026-05-27T13:00:00.000Z"));
    const state = await readState(tempRoot);

    assert.equal(result.checked, true);
    assert.equal(result.reason, "failed");
    assert.equal(sentMessages.length, 0);
    assert.equal(state.lastResultType, "failed");
    assert.match(state.lastError ?? "", /无法获取最新版本/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createService(
  baseDir: string,
  params: {
    currentVersion: string;
    sentMessages: string[];
    versions: {
      npm?: string;
      github?: string;
    };
  },
): UpdateCheckService {
  return new UpdateCheckService(
    baseDir,
    true,
    {
      async send(message: string) {
        params.sentMessages.push(message);
        return true;
      },
      getLastError() {
        return null;
      },
      formatSystemNotification(title: string, lines: string[]) {
        return [title, ...lines].join("\n");
      },
    } as never,
    {
      currentVersion: params.currentVersion,
      fetchImpl: async (url: string | URL | Request) => {
        const text = String(url);
        if (text.includes("registry.npmjs.org") && params.versions.npm) {
          return new Response(JSON.stringify({ version: params.versions.npm }));
        }
        if (text.includes("api.github.com") && params.versions.github) {
          return new Response(JSON.stringify({
            tag_name: params.versions.github,
            html_url: "https://github.com/robinspt/tickflow-assist/releases/latest",
          }));
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      },
    },
  );
}

async function readState(baseDir: string): Promise<UpdateCheckState> {
  return JSON.parse(
    await readFile(path.join(baseDir, "update-check-state.json"), "utf-8"),
  ) as UpdateCheckState;
}
