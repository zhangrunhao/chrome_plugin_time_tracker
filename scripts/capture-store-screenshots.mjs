import { chromium } from "playwright";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MINUTE_MS = 60_000;
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const screenshotDirectory = join(projectRoot, "store-assets", "screenshots");

const DEMO_SITES = Object.freeze([
  {
    id: "site-github",
    name: "GitHub",
    domain: "github.com",
    enabled: true,
    createdAt: Date.parse("2026-08-01T09:00:00+08:00"),
  },
  {
    id: "site-mdn",
    name: "MDN Web Docs",
    domain: "developer.mozilla.org",
    enabled: true,
    createdAt: Date.parse("2026-08-01T09:01:00+08:00"),
  },
  {
    id: "site-wikipedia",
    name: "Wikipedia",
    domain: "wikipedia.org",
    enabled: true,
    createdAt: Date.parse("2026-08-01T09:02:00+08:00"),
  },
]);

function localDayStart(now, daysAgo) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

function buildClosedVisit({ id, siteId, openedAt, activeMinutes }) {
  const firstIntervalMs = Math.round(activeMinutes * MINUTE_MS * 0.58);
  const secondIntervalMs = activeMinutes * MINUTE_MS - firstIntervalMs;
  const firstStartedAt = openedAt + MINUTE_MS;
  const firstEndedAt = firstStartedAt + firstIntervalMs;
  const secondStartedAt = firstEndedAt + 5 * MINUTE_MS;
  const secondEndedAt = secondStartedAt + secondIntervalMs;
  const endedAt = secondEndedAt + MINUTE_MS;

  return {
    id,
    siteId,
    openedAt,
    endedAt,
    activeIntervals: [
      { startedAt: firstStartedAt, endedAt: firstEndedAt },
      { startedAt: secondStartedAt, endedAt: secondEndedAt },
    ],
    lastConfirmedAt: endedAt,
    lastActivityAt: endedAt,
  };
}

export function buildDemoVisits(now = Date.now()) {
  const openPattern = [2, 3, 1, 4, 2, 5, 3, 4, 2, 3, 5, 4, 2, 3];
  const visits = [];

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const patternIndex = 13 - daysAgo;
    const dayStart = localDayStart(now, daysAgo);
    const count = openPattern[patternIndex];

    for (let index = 0; index < count; index += 1) {
      const activeMinutes = 12 + ((patternIndex * 7 + index * 11) % 34);
      let openedAt = dayStart + (8 * 60 + 20 + index * 105) * MINUTE_MS;
      if (daysAgo === 0) {
        const latestEndedAt = now - 10 * MINUTE_MS - (count - 1 - index) * 82 * MINUTE_MS;
        openedAt = latestEndedAt - (activeMinutes + 7) * MINUTE_MS;
      }
      visits.push(buildClosedVisit({
        id: `github-${daysAgo}-${index}`,
        siteId: "site-github",
        openedAt,
        activeMinutes,
      }));
    }
  }

  for (const [siteId, dayOffset, activeMinutes] of [
    ["site-mdn", 1, 38],
    ["site-mdn", 4, 24],
    ["site-wikipedia", 2, 19],
    ["site-wikipedia", 7, 31],
  ]) {
    const openedAt = localDayStart(now, dayOffset) + (13 * 60 + dayOffset * 9) * MINUTE_MS;
    visits.push(buildClosedVisit({
      id: `${siteId}-${dayOffset}`,
      siteId,
      openedAt,
      activeMinutes,
    }));
  }

  return visits;
}

async function seedSyntheticData(page, now) {
  const visits = buildDemoVisits(now);
  await page.evaluate(async ({ sites, seededVisits }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ webtraceSitesV1: sites });

    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("webtrace", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("visits", "readwrite");
    const visitStore = transaction.objectStore("visits");
    visitStore.clear();
    for (const visit of seededVisits) {
      visitStore.put(visit);
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { sites: DEMO_SITES, seededVisits: visits });
}

async function captureStoreScreenshots() {
  await mkdir(screenshotDirectory, { recursive: true });
  const profileDirectory = await mkdtemp(join(tmpdir(), "webtrace-store-profile-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      args: [
        `--disable-extensions-except=${projectRoot}`,
        `--load-extension=${projectRoot}`,
      ],
    });

    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", error => runtimeErrors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.goto(`chrome-extension://${extensionId}/analysis.html`);
    await seedSyntheticData(page, Date.now());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#summary .summary-value").first().waitFor();
    await page.waitForFunction(() => (
      document.querySelector("#site-list")?.textContent?.includes("GitHub") === true
    ));

    await page.screenshot({
      path: join(screenshotDirectory, "01-dashboard-1280x800.png"),
      animations: "disabled",
    });

    await page.getByRole("button", { name: "管理网站" }).click();
    await page.locator("#site-manager").waitFor({ state: "visible" });
    await page.screenshot({
      path: join(screenshotDirectory, "02-add-site-1280x800.png"),
      animations: "disabled",
    });

    if (runtimeErrors.length > 0) {
      throw new Error(`Browser errors during capture:\n${runtimeErrors.join("\n")}`);
    }
  } finally {
    await context?.close();
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined
  ? null
  : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  captureStoreScreenshots().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
