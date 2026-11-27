import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.ts';
import { DEFAULT_ADMIN_EMAIL, evaluateSingleAdminAuthorization } from '../server/adminAuth.ts';
import { createCorsMiddleware, parseAllowedOrigins } from '../server/cors.ts';
import { ServerDatasetStore, resolveDatasetStorePath } from '../server/datasetStore.ts';
import { buildApiUrl, resolveApiBaseUrl } from '../src/utils/apiClient.ts';
import {
  APP_NAVIGATE_EVENT,
  getCurrentPathname,
  isAdminPath,
  navigateToPath,
  normalizeBasePrefix,
  stripBasePath,
  withBasePath,
} from '../src/utils/navigation.ts';

interface CheckResult {
  group: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

async function runCheck(group: string, name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ group, name, passed: true });
    console.log(`[PASS] [${group}] ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ group, name, passed: false, detail: message });
    console.error(`[FAIL] [${group}] ${name} -> ${message}`);
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function listenApp(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to obtain ephemeral server port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function waitForHttpReady(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'khanhhoa-m4-1-'));

  try {
    // =========================================================================
    // GROUP A: Frontend API Client & 13 fetch call sites
    // =========================================================================
    await runCheck('API_CLIENT', 'buildApiUrl normalizes empty, trailing slashes, and duplicate slashes', () => {
      assert.equal(resolveApiBaseUrl(''), '');
      assert.equal(resolveApiBaseUrl('   '), '');
      assert.equal(resolveApiBaseUrl('https://backend.example.com///'), 'https://backend.example.com');
      assert.equal(buildApiUrl('/api/datasets/active', ''), '/api/datasets/active');
      assert.equal(buildApiUrl('api/datasets/active', ''), '/api/datasets/active');
      assert.equal(
        buildApiUrl('/api/admin/datasets', 'https://backend.example.com/'),
        'https://backend.example.com/api/admin/datasets'
      );
      assert.equal(
        buildApiUrl('///api/analyze-photo', 'https://backend.example.com///'),
        'https://backend.example.com/api/analyze-photo'
      );
    });

    await runCheck('API_CLIENT', 'All 13 frontend /api/* fetch calls use buildApiUrl() with 0 hardcoded relative fetches', async () => {
      const srcFiles = (await listFilesRecursive(path.resolve('src'))).filter(
        (f) => f.endsWith('.ts') || f.endsWith('.tsx')
      );
      let buildApiUrlFetchCount = 0;
      const hardcodedHits: string[] = [];

      for (const file of srcFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const directMatches = content.match(/fetch\(\s*['"`]\/api\//g);
        if (directMatches) {
          hardcodedHits.push(`${path.relative(process.cwd(), file)}: ${directMatches.length}`);
        }
        const wrappedMatches = content.match(/fetch\(\s*buildApiUrl\(/g);
        if (wrappedMatches) {
          buildApiUrlFetchCount += wrappedMatches.length;
        }
      }

      assert.equal(hardcodedHits.length, 0, `Found hardcoded /api/ fetch calls: ${hardcodedHits.join(', ')}`);
      assert.equal(buildApiUrlFetchCount, 13, `Expected 13 fetch(buildApiUrl(...)) calls, got ${buildApiUrlFetchCount}`);
    });

    // =========================================================================
    // GROUP B: CORS & A1 Verification
    // =========================================================================
    await runCheck('CORS', 'parseAllowedOrigins rejects wildcards, paths, trailing slashes, and keeps exact origins', () => {
      const parsed = parseAllowedOrigins(
        'https://example-user.github.io, http://localhost:3000, *, https://bad.example.com/, https://bad.example.com/admin, https://*.github.io'
      );
      assert.deepEqual([...parsed.allowedOrigins], [
        'https://example-user.github.io',
        'http://localhost:3000',
      ]);
      assert.equal(parsed.invalidEntries.length, 4);
    });

    await runCheck('CORS', 'Empty CORS_ALLOWED_ORIGINS in production logs warning and emits no ACAO header', () => {
      const warnings: string[] = [];
      const mw = createCorsMiddleware({
        rawAllowedOrigins: '',
        isProduction: true,
        logger: { warn: (msg?: unknown) => warnings.push(String(msg ?? '')) },
      });
      assert.ok(warnings.some((w) => w.includes('CORS_ALLOWED_ORIGINS')));

      const headers: Record<string, string> = {};
      let statusCode = 0;
      let ended = false;
      mw(
        { method: 'OPTIONS', headers: { origin: 'https://any.example.com' } } as never,
        {
          vary: (h: string) => {
            headers['vary'] = h;
          },
          setHeader: (k: string, v: string) => {
            headers[k.toLowerCase()] = v;
          },
          status: (code: number) => {
            statusCode = code;
            return {
              end: () => {
                ended = true;
              },
            };
          },
        } as never,
        () => undefined
      );
      assert.equal(statusCode, 204);
      assert.equal(ended, true);
      assert.equal(headers['vary'], 'Origin');
      assert.equal(headers['access-control-allow-origin'], undefined);
    });

    const corsStorePath = path.join(tmpRoot, 'cors-store.json');
    const corsStore = new ServerDatasetStore(corsStorePath);
    await corsStore.verifyStorageAccess();
    const corsApp = createApp({
      datasetStore: corsStore,
      corsAllowedOrigins: 'https://allowed-user.github.io,http://localhost:5173',
      isProduction: true,
      serveStatic: false,
    });
    const { server: corsServer, baseUrl: corsBaseUrl } = await listenApp(corsApp);

    try {
      await runCheck('CORS', 'Allowed origin receives exact Access-Control-Allow-Origin + Vary + headers + max-age', async () => {
        const res = await fetch(`${corsBaseUrl}/api/health`, {
          headers: { Origin: 'https://allowed-user.github.io' },
        });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed-user.github.io');
        assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, DELETE, OPTIONS');
        assert.equal(res.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
        assert.equal(res.headers.get('access-control-max-age'), '600');
        assert.ok((res.headers.get('vary') || '').toLowerCase().includes('origin'));
      });

      await runCheck('CORS', 'Disallowed origin does NOT receive Access-Control-Allow-Origin', async () => {
        const res = await fetch(`${corsBaseUrl}/api/health`, {
          headers: { Origin: 'https://evil-attacker.example.com' },
        });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), null);
        assert.ok((res.headers.get('vary') || '').toLowerCase().includes('origin'));
      });

      await runCheck('CORS', 'OPTIONS /api/admin/datasets returns 204 without Firebase token (before requireAdminAuth)', async () => {
        const res = await fetch(`${corsBaseUrl}/api/admin/datasets`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://allowed-user.github.io',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Authorization, Content-Type',
          },
        });
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed-user.github.io');
      });

      await runCheck('CORS', 'GET /api/admin/datasets without token still returns 401 (A1 protected)', async () => {
        const res = await fetch(`${corsBaseUrl}/api/admin/datasets`, {
          method: 'GET',
          headers: { Origin: 'https://allowed-user.github.io' },
        });
        assert.equal(res.status, 401);
        assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed-user.github.io');
      });

      await runCheck('CORS', 'Invalid Bearer token returns 401 and A1 rejects wrong/unverified email with 403', async () => {
        const res = await fetch(`${corsBaseUrl}/api/admin/datasets`, {
          method: 'GET',
          headers: {
            Origin: 'https://allowed-user.github.io',
            Authorization: 'Bearer not-a-valid-firebase-jwt',
          },
        });
        assert.equal(res.status, 401);

        assert.equal(DEFAULT_ADMIN_EMAIL, 'linhnk2013@gmail.com');

        const wrongEmail = evaluateSingleAdminAuthorization(
          { uid: 'uid-123456', email: 'other@example.com', email_verified: true },
          {}
        );
        assert.equal(wrongEmail.authorized, false);
        assert.equal(wrongEmail.status, 403);

        const unverified = evaluateSingleAdminAuthorization(
          { uid: 'uid-123456', email: 'linhnk2013@gmail.com', email_verified: false },
          {}
        );
        assert.equal(unverified.authorized, false);
        assert.equal(unverified.status, 403);

        const validAdmin = evaluateSingleAdminAuthorization(
          { uid: 'uid-123456', email: 'LINHNK2013@gmail.com', email_verified: true },
          {}
        );
        assert.equal(validAdmin.authorized, true);
        assert.equal(validAdmin.status, 200);
      });
    } finally {
      await closeServer(corsServer);
    }

    // =========================================================================
    // GROUP C: DATA_STORE_PATH & ServerDatasetStore Persistence/Safety
    // =========================================================================
    await runCheck('DATA_STORE_PATH', 'Custom DATA_STORE_PATH env var is resolved and used', () => {
      const customPath = path.join(tmpRoot, 'nested-disk', 'datasets-store.json');
      const prevEnv = process.env.DATA_STORE_PATH;
      try {
        process.env.DATA_STORE_PATH = customPath;
        const resolved = resolveDatasetStorePath(undefined, process.env.DATA_STORE_PATH);
        assert.equal(resolved, path.resolve(customPath));
        const store = new ServerDatasetStore();
        assert.equal(store.getStorageFilePath(), path.resolve(customPath));
      } finally {
        if (prevEnv === undefined) delete process.env.DATA_STORE_PATH;
        else process.env.DATA_STORE_PATH = prevEnv;
      }
    });

    await runCheck('DATA_STORE_PATH', 'Missing file (ENOENT) initializes valid empty store and verifyStorageAccess succeeds', async () => {
      const missingPath = path.join(tmpRoot, 'fresh-dir', 'datasets-store.json');
      const store = new ServerDatasetStore(missingPath);
      const check = await store.verifyStorageAccess();
      assert.equal(check.ready, true);
      const active = await store.getPublicActiveDatasets();
      assert.equal(active.active.statePrice.records.length, 0);
      assert.equal(active.pdfDocuments.length, 0);
    });

    await runCheck('DATA_STORE_PATH', 'Corrupted JSON fails loudly and is NEVER overwritten with empty store', async () => {
      const corruptPath = path.join(tmpRoot, 'corrupt-store.json');
      const corruptPayload = '{ "schemaVersion": 1, "broken_json": [';
      await fs.writeFile(corruptPath, corruptPayload, 'utf-8');

      const store = new ServerDatasetStore(corruptPath);
      const startupCheck = await store.verifyStorageAccess();
      assert.equal(startupCheck.ready, false);
      assert.equal(startupCheck.errorCode, 'DATASET_STORE_CORRUPT_JSON');

      await assert.rejects(
        () => store.getPublicActiveDatasets(),
        (err: NodeJS.ErrnoException) => err.code === 'DATASET_STORE_CORRUPT_JSON'
      );

      // Even a write attempt must refuse to overwrite the corrupted file
      await assert.rejects(
        () =>
          store.addPdfDocument({
            id: 'pdf-should-fail',
            fileName: 'test.pdf',
            documentTitle: 'Test',
            documentCategory: 'khac',
            pageCount: 1,
            effectiveDate: '2026-01-01',
            appendixNote: '',
            fileSizeBytes: 100,
            uploadedAt: new Date().toISOString(),
          }),
        (err: NodeJS.ErrnoException) => err.code === 'DATASET_STORE_CORRUPT_JSON'
      );

      const rawAfter = await fs.readFile(corruptPath, 'utf-8');
      assert.equal(rawAfter, corruptPayload, 'Corrupted file was unexpectedly modified!');
    });

    await runCheck('DATA_STORE_PATH', 'EACCES / non-ENOENT read errors fail loudly and are never swallowed', async () => {
      // 1. Real filesystem non-ENOENT error (EISDIR — works identically as root or non-root)
      const dirAsFile = path.join(tmpRoot, 'is-a-directory');
      await fs.mkdir(dirAsFile, { recursive: true });
      const dirStore = new ServerDatasetStore(dirAsFile);
      await assert.rejects(
        () => dirStore.getPublicActiveDatasets(),
        (err: NodeJS.ErrnoException) => err.code === 'EISDIR'
      );

      // 2. Explicit EACCES check (real chmod 0o000 if non-root, plus direct EACCES error simulation if root)
      const eaccesPath = path.join(tmpRoot, 'eacces-store.json');
      await fs.writeFile(eaccesPath, '{"schemaVersion":1}', 'utf-8');
      const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

      if (!runningAsRoot) {
        await fs.chmod(eaccesPath, 0o000);
        try {
          const eaccesStore = new ServerDatasetStore(eaccesPath);
          await assert.rejects(
            () => eaccesStore.getPublicActiveDatasets(),
            (err: NodeJS.ErrnoException) => err.code === 'EACCES'
          );
        } finally {
          await fs.chmod(eaccesPath, 0o644);
        }
      } else {
        // Under root container, Linux bypasses chmod 000; intercept fs.readFile to verify EACCES path explicitly
        const originalReadFile = fs.readFile;
        const eaccesErr = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        (fs as unknown as { readFile: typeof fs.readFile }).readFile = (async (target: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
          if (String(target) === path.resolve(eaccesPath)) {
            throw eaccesErr;
          }
          return (originalReadFile as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
        }) as typeof fs.readFile;
        try {
          const eaccesStore = new ServerDatasetStore(eaccesPath);
          await assert.rejects(
            () => eaccesStore.getPublicActiveDatasets(),
            (err: NodeJS.ErrnoException) => err.code === 'EACCES'
          );
        } finally {
          (fs as unknown as { readFile: typeof fs.readFile }).readFile = originalReadFile;
        }
      }
    });

    await runCheck('DATA_STORE_PATH', 'Atomic write persists data across reload and temp-file failure preserves main file', async () => {
      const atomicDir = path.join(tmpRoot, 'atomic-test');
      const atomicPath = path.join(atomicDir, 'datasets-store.json');
      const store1 = new ServerDatasetStore(atomicPath);
      await store1.verifyStorageAccess();

      await store1.addPdfDocument({
        id: 'pdf-persist-01',
        fileName: 'nq15-khanh-hoa.pdf',
        documentTitle: 'NQ 15/2025/NQ-HĐND',
        documentCategory: 'bang_gia_nha_nuoc',
        pageCount: 12,
        effectiveDate: '01/01/2026',
        appendixNote: 'Phụ lục kiểm thử M4.1',
        fileSizeBytes: 1024,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      });

      // Verify zero leftover .tmp files
      const filesAfterWrite = await fs.readdir(atomicDir);
      assert.deepEqual(filesAfterWrite, ['datasets-store.json']);

      const originalContent = await fs.readFile(atomicPath, 'utf-8');

      // Simulate temp-file rename failure -> must clean up .tmp and keep main file intact
      const originalRename = fs.rename;
      (fs as unknown as { rename: typeof fs.rename }).rename = (async () => {
        throw Object.assign(new Error('simulated disk error'), { code: 'EIO' });
      }) as typeof fs.rename;

      try {
        await assert.rejects(
          () =>
            store1.addPdfDocument({
              id: 'pdf-should-fail-02',
              fileName: 'fail.pdf',
              documentTitle: 'Should Fail',
              documentCategory: 'khac',
              pageCount: 1,
              effectiveDate: '01/01/2026',
              appendixNote: '',
              fileSizeBytes: 512,
              uploadedAt: '2026-01-02T00:00:00.000Z',
            }),
          (err: NodeJS.ErrnoException) => err.code === 'EIO'
        );
      } finally {
        (fs as unknown as { rename: typeof fs.rename }).rename = originalRename;
      }

      // Main file untouched and orphan .tmp file cleaned up
      const filesAfterFail = await fs.readdir(atomicDir);
      assert.deepEqual(filesAfterFail, ['datasets-store.json']);
      const contentAfterFail = await fs.readFile(atomicPath, 'utf-8');
      assert.equal(contentAfterFail, originalContent);

      // Fresh instance (simulating Render restart) reads exact persisted state
      const store2 = new ServerDatasetStore(atomicPath);
      const reloaded = await store2.getPublicActiveDatasets();
      assert.equal(reloaded.pdfDocuments.length, 1);
      assert.equal(reloaded.pdfDocuments[0].id, 'pdf-persist-01');
    });

    // =========================================================================
    // GROUP D: Backend-only mode via real `npm run start` (NODE_ENV=production, SERVE_STATIC=false)
    // =========================================================================
    await runCheck('BACKEND_ONLY', 'npm run start succeeds in NODE_ENV=production + SERVE_STATIC=false without dist/', async () => {
      const backendPort = 39481;
      const backendStorePath = path.join(tmpRoot, 'render-disk', 'datasets-store.json');
      const child = spawn('npm', ['run', 'start'], {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          SERVE_STATIC: 'false',
          PORT: String(backendPort),
          DATA_STORE_PATH: backendStorePath,
          CORS_ALLOWED_ORIGINS: 'https://test-pages.github.io',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      child.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
      });

      try {
        await waitForHttpReady(`http://127.0.0.1:${backendPort}/api/health`);

        // 1. GET /api/health returns 200 with ok + storageReady and zero sensitive data
        const healthRes = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
        assert.equal(healthRes.status, 200);
        const healthText = await healthRes.text();
        const healthJson = JSON.parse(healthText) as { ok?: boolean; storageReady?: boolean };
        assert.equal(healthJson.ok, true);
        assert.equal(healthJson.storageReady, true);
        assert.ok(!healthText.includes(backendStorePath), 'Health response must NOT expose DATA_STORE_PATH!');
        assert.ok(!healthText.includes('GEMINI_API_KEY'), 'Health response must NOT expose GEMINI_API_KEY!');
        assert.ok(!healthText.includes('linhnk2013'), 'Health response must NOT expose admin email!');

        // 2. GET /api/datasets/active works
        const activeRes = await fetch(`http://127.0.0.1:${backendPort}/api/datasets/active`);
        assert.equal(activeRes.status, 200);
        const activeJson = (await activeRes.json()) as { storageBackend?: string; active?: unknown };
        assert.equal(activeJson.storageBackend, 'server_json_file');
        assert.ok(activeJson.active);

        // 3. Unknown non-API route returns clean JSON 404 (NOT ENOENT 500 or HTML)
        const notFoundRes = await fetch(`http://127.0.0.1:${backendPort}/some-missing-page`);
        assert.equal(notFoundRes.status, 404);
        assert.ok((notFoundRes.headers.get('content-type') || '').includes('application/json'));
        const notFoundJson = (await notFoundRes.json()) as { error?: string };
        assert.ok(typeof notFoundJson.error === 'string' && notFoundJson.error.length > 0);
      } catch (err) {
        throw new Error(`${err instanceof Error ? err.message : String(err)} | stderr=${stderrBuf.slice(0, 400)}`);
      } finally {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        }
        await Promise.race([
          new Promise((r) => child.once('exit', r)),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      }
    });

    // =========================================================================
    // GROUP E: GitHub Pages Base Path & SPA Routing ('/' and '/<repo>/')
    // =========================================================================
    await runCheck('GH_PAGES_ROUTING', 'Navigation helpers preserve "/" and "/<repo>/" on pushState and reload', () => {
      // Case 1: Root base '/'
      assert.equal(normalizeBasePrefix('/'), '');
      assert.equal(stripBasePath('/', '/'), '/');
      assert.equal(stripBasePath('/admin', '/'), '/admin');
      assert.equal(withBasePath('/', '/'), '/');
      assert.equal(withBasePath('/admin', '/'), '/admin');
      assert.equal(isAdminPath('/admin', '/'), true);
      assert.equal(isAdminPath('/', '/'), false);

      // Case 2: Project Site base '/khanh-hoa-land/'
      const repoBase = '/khanh-hoa-land/';
      assert.equal(normalizeBasePrefix(repoBase), '/khanh-hoa-land');
      assert.equal(stripBasePath('/khanh-hoa-land/', repoBase), '/');
      assert.equal(stripBasePath('/khanh-hoa-land', repoBase), '/');
      assert.equal(stripBasePath('/khanh-hoa-land/admin', repoBase), '/admin');
      assert.equal(withBasePath('/', repoBase), '/khanh-hoa-land/');
      assert.equal(withBasePath('/admin', repoBase), '/khanh-hoa-land/admin');
      assert.equal(isAdminPath('/khanh-hoa-land/admin', repoBase), true);
      assert.equal(isAdminPath('/admin', repoBase), true);
      assert.equal(isAdminPath('/khanh-hoa-land/', repoBase), false);

      // Simulate browser window.location + history.pushState for both bases
      const origWindow = (globalThis as Record<string, unknown>).window;
      const origCustomEvent = (globalThis as Record<string, unknown>).CustomEvent;
      try {
        for (const scenario of [
          { base: '/', start: '/', adminExpected: '/admin', homeExpected: '/' },
          {
            base: '/khanh-hoa-land/',
            start: '/khanh-hoa-land/',
            adminExpected: '/khanh-hoa-land/admin',
            homeExpected: '/khanh-hoa-land/',
          },
        ]) {
          const pushed: string[] = [];
          const dispatched: string[] = [];
          const mockLocation = { pathname: scenario.start };
          (globalThis as Record<string, unknown>).CustomEvent = class MockCustomEvent {
            type: string;
            detail: unknown;
            constructor(type: string, init?: { detail?: unknown }) {
              this.type = type;
              this.detail = init?.detail;
            }
          };
          (globalThis as Record<string, unknown>).window = {
            location: mockLocation,
            history: {
              pushState: (_s: unknown, _t: string, url: string) => {
                pushed.push(url);
                mockLocation.pathname = url;
              },
            },
            dispatchEvent: (ev: { type: string }) => {
              dispatched.push(ev.type);
            },
          };

          assert.equal(getCurrentPathname(scenario.base), '/');
          navigateToPath('/admin', scenario.base);
          assert.equal(mockLocation.pathname, scenario.adminExpected);
          assert.equal(getCurrentPathname(scenario.base), '/admin');
          assert.equal(isAdminPath(getCurrentPathname(scenario.base), scenario.base), true);

          // Simulate direct F5 reload on Admin page
          assert.equal(getCurrentPathname(scenario.base), '/admin');

          // Navigate back home -> base prefix still preserved
          navigateToPath('/', scenario.base);
          assert.equal(mockLocation.pathname, scenario.homeExpected);
          assert.equal(getCurrentPathname(scenario.base), '/');
          assert.deepEqual(pushed, [scenario.adminExpected, scenario.homeExpected]);
          assert.deepEqual(dispatched, [APP_NAVIGATE_EVENT, APP_NAVIGATE_EVENT]);
        }
      } finally {
        if (origWindow === undefined) delete (globalThis as Record<string, unknown>).window;
        else (globalThis as Record<string, unknown>).window = origWindow;
        if (origCustomEvent === undefined) delete (globalThis as Record<string, unknown>).CustomEvent;
        else (globalThis as Record<string, unknown>).CustomEvent = origCustomEvent;
      }
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\n=== M4.1 VALIDATION SUMMARY: ${passedCount}/${results.length} PASS (${failedCount} FAIL) ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled M4.1 validation error:', err);
  process.exit(1);
});
