import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promoteRadar1500Base } from "../scripts/lib/radar_promotion.mjs";

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "radar1500-promotion-"));
  const base = path.join(root, "data/staging/radar_2026-09-07/base");
  const clean = path.join(root, "data/clean");
  await fs.mkdir(base, { recursive: true });
  await fs.mkdir(clean, { recursive: true });

  const players = ["player_id,gender", ...Array.from({ length: 3000 }, (_, i) => `${i + 1},${i % 2 ? "F" : "M"}`)].join("\n") + "\n";
  const snapshot = ["player_id,gender,ranking_date", ...Array.from({ length: 3000 }, (_, i) => `${i + 1},${i % 2 ? "F" : "M"},2026-09-07`)].join("\n") + "\n";
  const ledger = ["player_id", ...Array.from({ length: 3000 }, (_, i) => String(i + 1))].join("\n") + "\n";
  const queue = ["player_id,status", ...Array.from({ length: 1000 }, (_, i) => `${i + 2001},BREAKDOWN_VALIDATED`)].join("\n") + "\n";
  await fs.writeFile(path.join(base, "players.csv"), players);
  await fs.writeFile(path.join(base, "rankings_snapshot.csv"), snapshot);
  await fs.writeFile(path.join(base, "points_ledger.csv"), ledger);
  await fs.writeFile(path.join(base, "queue.csv"), queue);

  const hashes = {};
  for (const file of ["players.csv", "rankings_snapshot.csv", "points_ledger.csv"]) {
    hashes[file] = await sha256(path.join(base, file));
  }
  await fs.writeFile(path.join(base, "manifest.json"), JSON.stringify({
    ranking_date: "2026-09-07",
    public_limit_per_gender: 1000,
    radar_limit_per_gender: 1500,
  }));
  await fs.writeFile(path.join(base, "validation.json"), JSON.stringify({
    valid: true,
    public_limit_per_gender: 1000,
    radar_limit_per_gender: 1500,
    exact: 3000,
    total: 3000,
    pending_additional: 0,
    errors: [],
    hashes,
  }));
  await fs.writeFile(path.join(clean, "players.csv"), "old-players\n");
  await fs.writeFile(path.join(clean, "rankings_snapshot.csv"), "old-snapshot\n");
  await fs.writeFile(path.join(clean, "points_ledger.csv"), "old-ledger\n");
  await fs.mkdir(path.join(root, "data/config"), { recursive: true });
  await fs.writeFile(path.join(root, "data/config/base_state.json"), JSON.stringify({ state: "LEGACY_BASE_500" }));
  return { root, base, clean };
}

test("RADAR1500 promotion is dry-run safe and idempotent", async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.root, { recursive: true, force: true }));

  const dryRun = await promoteRadar1500Base({ cwd: fx.root });
  assert.equal(dryRun.valid, true);
  assert.equal(dryRun.current_state, "LEGACY_BASE_500");
  assert.equal(await fs.readFile(path.join(fx.clean, "players.csv"), "utf8"), "old-players\n");

  const promoted = await promoteRadar1500Base({
    cwd: fx.root,
    confirm: true,
    now: new Date("2026-09-09T00:00:00.000Z"),
  });
  assert.equal(promoted.promoted, true);
  assert.match(await fs.readFile(path.join(fx.root, "data/config/base_state.json"), "utf8"), /RADAR1500_ACTIVE/);
  assert.match(await fs.readFile(path.join(fx.clean, "players.csv"), "utf8"), /^player_id,gender/);
  assert.equal(await fs.stat(path.join(promoted.backup_dir, "players.csv")).then(() => true), true);

  const second = await promoteRadar1500Base({ cwd: fx.root, confirm: true });
  assert.equal(second.already_active, true);
});

test("RADAR1500 promotion restores production after a failed copy", async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.root, { recursive: true, force: true }));

  await assert.rejects(
    promoteRadar1500Base({ cwd: fx.root, confirm: true, failAfterFirstCopy: true }),
    /Falha simulada/
  );
  assert.equal(await fs.readFile(path.join(fx.clean, "players.csv"), "utf8"), "old-players\n");
  assert.match(await fs.readFile(path.join(fx.root, "data/config/base_state.json"), "utf8"), /LEGACY_BASE_500/);
});
