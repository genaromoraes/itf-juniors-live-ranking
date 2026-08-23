import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { brotliCompress, gzip } from "node:zlib";

import { chromium } from "playwright";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const EXPORT_DIR = path.join(ROOT_DIR, "data", "exports");
const INDEX_FILE = path.join(EXPORT_DIR, "index.html");

function readNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readStringArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function round(value) {
  return Number(Number(value || 0).toFixed(1));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeRuns(runs) {
  const numericKeys = Object.keys(runs[0] || {}).filter((key) =>
    runs.every((run) => typeof run[key] === "number")
  );

  return Object.fromEntries(
    numericKeys.map((key) => {
      const values = runs.map((run) => run[key]);
      return [
        key,
        {
          median: round(median(values)),
          min: round(Math.min(...values)),
          max: round(Math.max(...values)),
        },
      ];
    })
  );
}

function runGenerator() {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, ["scripts/09_generate_live_ranking_html.mjs"], {
      cwd: ROOT_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Gerador terminou com código ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(round(performance.now() - startedAt));
    });
  });
}

async function measureArtifact() {
  const source = await fs.readFile(INDEX_FILE);
  const [gzipSource, brotliSource] = await Promise.all([
    gzipAsync(source),
    brotliAsync(source),
  ]);

  return {
    bytes: source.length,
    gzipBytes: gzipSource.length,
    brotliBytes: brotliSource.length,
  };
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function createStaticServer() {
  const compressedCache = new Map();

  async function getFile(filePath) {
    if (!compressedCache.has(filePath)) {
      const source = await fs.readFile(filePath);
      compressedCache.set(filePath, {
        source,
        gzip: await gzipAsync(source),
      });
    }
    return compressedCache.get(filePath);
  }

  const initialFiles = (await fs.readdir(EXPORT_DIR))
    .filter((fileName) => /^(index\.html|player-details-.+\.js)$/.test(fileName))
    .map((fileName) => getFile(path.join(EXPORT_DIR, fileName)));
  await Promise.all(initialFiles);

  const server = http.createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.resolve(EXPORT_DIR, relativePath);
      const relativeToExport = path.relative(EXPORT_DIR, filePath);

      if (relativeToExport.startsWith("..") || path.isAbsolute(relativeToExport)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const file = await getFile(filePath);
      const acceptsGzip = /\bgzip\b/.test(request.headers["accept-encoding"] || "");
      const body = acceptsGzip ? file.gzip : file.source;
      response.writeHead(200, {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": getContentType(filePath),
        "Content-Length": body.length,
        ...(acceptsGzip ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function measureBrowser({ runs, cpuRate, latencyMs, downloadKbps }) {
  const { server, url } = await createStaticServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (let index = 0; index < runs; index += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(() => {
        window.__benchmarkLongTasks = [];
        new PerformanceObserver((list) => {
          window.__benchmarkLongTasks.push(
            ...list.getEntries().map((entry) => ({
              startTime: entry.startTime,
              duration: entry.duration,
            }))
          );
        }).observe({ type: "longtask", buffered: true });
      });

      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: latencyMs,
        downloadThroughput: (downloadKbps * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
        connectionType: "cellular4g",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForFunction(
        () => document.querySelectorAll("#rankingBody tr").length > 0,
        null,
        { timeout: 30_000 }
      );

      const initial = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        const longTasks = window.__benchmarkLongTasks || [];
        return {
          ttfbMs: navigation.responseStart,
          responseEndMs: navigation.responseEnd,
          domInteractiveMs: navigation.domInteractive,
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          fcpMs: fcp?.startTime || 0,
          readyMs: performance.now(),
          longTaskCount: longTasks.length,
          longTaskTotalMs: longTasks.reduce((sum, task) => sum + task.duration, 0),
          longestTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)),
          domNodes: document.getElementsByTagName("*").length,
          initialRows: document.querySelectorAll("#rankingBody tr").length,
          initialTransferBytes: navigation.transferSize,
        };
      });

      await page.evaluate(() => {
        window.__benchmarkDetailStartedAt = performance.now();
      });
      await page.locator("#rankingBody tr").first().click();
      await page.locator("#profileCard .cartel-grid").waitFor({ state: "attached", timeout: 30_000 });
      const detail = await page.evaluate(() => {
        const resources = performance.getEntriesByType("resource");
        return {
          detailReadyMs: performance.now() - window.__benchmarkDetailStartedAt,
          resourceTransferBytes: resources.reduce(
            (sum, resource) => sum + (resource.transferSize || 0),
            0
          ),
          resourceCount: resources.length,
        };
      });

      if (pageErrors.length) {
        throw new Error(`Erros na página: ${pageErrors.join(" | ")}`);
      }

      results.push(
        Object.fromEntries(
          Object.entries({ ...initial, ...detail }).map(([key, value]) => [key, round(value)])
        )
      );
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return results;
}

async function main() {
  const browserRuns = Math.max(0, Math.round(readNumberArg("runs", 5)));
  const generatorRuns = Math.round(readNumberArg("generate-runs", 3));
  const cpuRate = Math.max(1, readNumberArg("cpu", 4));
  const latencyMs = readNumberArg("latency", 150);
  const downloadKbps = Math.max(1, readNumberArg("download-kbps", 1600));
  const outputPath = readStringArg("output");
  const generationMs = [];

  for (let index = 0; index < generatorRuns; index += 1) {
    generationMs.push(await runGenerator());
  }

  const artifact = await measureArtifact();
  const browser = browserRuns
    ? await measureBrowser({
        runs: browserRuns,
        cpuRate,
        latencyMs,
        downloadKbps,
      })
    : [];
  const report = {
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: "chromium",
      browserRuns,
      generatorRuns,
      cpuRate,
      latencyMs,
      downloadKbps,
    },
    artifact,
    generation: generationMs.length
      ? { runsMs: generationMs, summaryMs: summarizeRuns(generationMs.map((durationMs) => ({ durationMs }))) }
      : null,
    browser: {
      runs: browser,
      summary: summarizeRuns(browser),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (outputPath) {
    const absoluteOutput = path.resolve(ROOT_DIR, outputPath);
    await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
    await fs.writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}

await main();
