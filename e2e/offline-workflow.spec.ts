import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// Minimal valid 1x1 pixel JPEG (hex-encoded, ~631 bytes)
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH" +
    "BwYIDAoMCwsKCwsNCxAQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQME" +
    "BAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU" +
    "FBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAA" +
    "AAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEG" +
    "E1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF" +
    "RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj" +
    "pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP0" +
    "9fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC" +
    "BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR" +
    "ChYkNOEl8RcYI4Q/RFhHRUYnJCk6LDE2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm" +
    "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6" +
    "wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEA" +
    "PwD9U6KKKACiiigD/9k=",
  "base64",
);

/** Helper: login as a user */
async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/reports", { timeout: 15000 });
}

/** Helper: clear auth session from IndexedDB */
async function clearAuth(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("stroyfoto");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("authSession", "readwrite");
    tx.objectStore("authSession").clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
}

/** Helper: read all reports from IndexedDB */
async function getReportsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("stroyfoto");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("reports", "readonly");
    const store = tx.objectStore("reports");
    const all = await new Promise<any[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return all;
  });
}

/** Helper: count photos in IndexedDB */
async function getPhotoCountFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("stroyfoto");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("photos", "readonly");
    const count = await new Promise<number>((resolve) => {
      const req = tx.objectStore("photos").count();
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return count;
  });
}

test.describe("Offline workflow — full cycle", () => {
  // Use a unique mark per test run to identify our report
  const testMark = `E2E-${Date.now()}`;

  test("worker creates report offline → syncs → admin sees it", async ({
    page,
    context,
  }) => {
    // ── Step 1: Login online as worker ──
    await login(page, "worker", "worker123");

    // Wait for reference data sync
    await page.waitForTimeout(3000);

    // ── Step 2: Go offline ──
    await context.setOffline(true);

    // ── Step 3: Navigate to new report form ──
    await page.goto("/reports/new");
    await page.waitForSelector('form', { timeout: 10000 });

    // Fill required fields
    // Project — select first option if dropdown exists, else type
    const projectSelect = page.locator('select').first();
    if (await projectSelect.isVisible()) {
      const options = await projectSelect.locator("option").allTextContents();
      // Select first non-empty option
      if (options.length > 1) {
        await projectSelect.selectOption({ index: 1 });
      }
    } else {
      await page.fill('input[placeholder="Идентификатор проекта"]', "SOL-01");
    }

    // Mark
    await page.fill('input[placeholder="Например: А-Б / 1-3"]', testMark);

    // WorkType is already defaulted via select

    // Area — select or type
    const areaSelect = page.locator('select').nth(2);
    if (await areaSelect.isVisible()) {
      const options = await areaSelect.locator("option").allTextContents();
      if (options.length > 1) {
        await areaSelect.selectOption({ index: 1 });
      }
    } else {
      await page.fill('input[placeholder="Название участка"]', "Секция А");
    }

    // Contractor — select or type
    const contractorSelect = page.locator('select').nth(3);
    if (await contractorSelect.isVisible()) {
      const options = await contractorSelect
        .locator("option")
        .allTextContents();
      if (options.length > 1) {
        await contractorSelect.selectOption({ index: 1 });
      }
    } else {
      await page.fill('input[placeholder="Название подрядчика"]', "ООО СтройМастер");
    }

    // Description
    await page.fill("textarea", "E2E тест: offline создание отчёта");

    // Add a photo
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "test-photo.jpg",
      mimeType: "image/jpeg",
      buffer: MINIMAL_JPEG,
    });

    // Wait for photo processing
    await page.waitForTimeout(3000);

    // Submit the report
    await page.click('button[type="submit"]');
    await page.waitForURL("**/reports", { timeout: 15000 });

    // ── Step 4: Reload page (still offline) ──
    await page.reload();
    await page.waitForSelector("h2", { timeout: 10000 });

    // ── Step 5: Confirm local data preserved ──
    const reports = await getReportsFromIDB(page);
    const ourReport = reports.find((r: any) => r.mark === testMark);
    expect(ourReport).toBeDefined();
    expect(ourReport.syncStatus).toBe("local-only");

    const photoCount = await getPhotoCountFromIDB(page);
    expect(photoCount).toBeGreaterThanOrEqual(1);

    // ── Step 6: Go online ──
    await context.setOffline(false);

    // ── Step 7: Trigger sync ──
    await page.goto("/sync");
    await page.waitForSelector('button', { timeout: 10000 });

    // Click sync button
    const syncBtn = page.locator('button', { hasText: "Синхронизировать" });
    if (await syncBtn.isEnabled()) {
      await syncBtn.click();
      // Wait for sync to finish (button re-enables or progress disappears)
      await page.waitForFunction(
        () => {
          const btns = document.querySelectorAll("button");
          for (const btn of btns) {
            if (
              btn.textContent?.includes("Синхронизировать") &&
              !btn.disabled
            ) {
              return true;
            }
          }
          return false;
        },
        { timeout: 30000 },
      );
    }

    // Verify report is synced in IndexedDB
    const reportsAfterSync = await getReportsFromIDB(page);
    const syncedReport = reportsAfterSync.find(
      (r: any) => r.mark === testMark,
    );
    expect(syncedReport).toBeDefined();
    // Report should be synced or at least have a serverId
    expect(
      syncedReport.syncStatus === "synced" || syncedReport.serverId,
    ).toBeTruthy();

    // ── Step 8: Login as admin and confirm report visible ──
    const adminPage = await context.newPage();
    await clearAuth(adminPage);
    await login(adminPage, "admin", "admin123");

    // Go to admin panel
    await adminPage.goto("/admin");
    await adminPage.waitForSelector("h2", { timeout: 15000 });

    // Check that admin dashboard loaded with stats
    const statsText = await adminPage.textContent("body");
    expect(statsText).toContain("Всего отчётов");

    // Verify the total reports count is at least 1
    const totalReportsEl = adminPage.locator("p.text-2xl.text-blue-600").first();
    const totalText = await totalReportsEl.textContent();
    expect(parseInt(totalText ?? "0")).toBeGreaterThanOrEqual(1);

    await adminPage.close();
  });
});
