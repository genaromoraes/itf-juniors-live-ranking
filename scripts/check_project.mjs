import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const SCRIPT_DIR = path.resolve("scripts");
const TEST_DIR = path.resolve("tests");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function directoryExists(dir) {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listMjsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listMjsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function main() {
  const files = await listMjsFiles(SCRIPT_DIR);

  if (await directoryExists(TEST_DIR)) {
    files.push(...(await listMjsFiles(TEST_DIR)));
  }

  for (const file of files) {
    await run("node", ["--check", file]);
  }

  console.log(`Checked ${files.length} JavaScript modules.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
