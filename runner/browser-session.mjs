import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'patchright';
import { ensureExtensions } from './setup-extensions.mjs';

const SOM_EVALUATE_FN = `(() => {
  const existing = document.getElementById('__som_overlay_root');
  if (existing) existing.remove();

  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 840;

  const selectors = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="option"]',
    '[role="switch"]',
    '[role="spinbutton"]',
    '[role="textbox"]',
    '[aria-haspopup]',
    '[contenteditable="true"]',
    'label[for]'
  ].join(',');

  const rawNodes = Array.from(document.querySelectorAll(selectors));
  const seenRects = [];
  const items = [];
  const inputSnapshots = [];

  function isVisible(el, rect) {
    const tag = el.tagName.toLowerCase();
    const isFileInput = tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'file';
    if (rect.width < 6 || rect.height < 6) return false;
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (!isFileInput && Number(style.opacity) === 0) return false;
    if (el.disabled) return false;
    return true;
  }

  function cleanLabel(el) {
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const value = (tag === 'input' || tag === 'textarea') ? (el.value || '') : '';
    const inner = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const raw = (aria || inner || placeholder || value || tag).replace(/\\s+/g, ' ').trim();
    return raw.slice(0, 72);
  }

  for (const el of rawNodes) {
    if (items.length >= 85) break;
    if (el.closest('[class*="vimium"], #vimiumHintMarkerContainer, .vimiumReset')) continue;
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) continue;

    const dup = seenRects.some(r =>
      Math.abs(r.left - rect.left) < 8 &&
      Math.abs(r.top - rect.top) < 8 &&
      Math.abs(r.width - rect.width) < 14 &&
      Math.abs(r.height - rect.height) < 14
    );
    if (dup) continue;
    seenRects.push(rect);

    const id = items.length + 1;
    el.setAttribute('data-som-id', String(id));

    const tag = el.tagName.toLowerCase();
    const inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : undefined;
    const role =
      el.getAttribute('role') ||
      (tag === 'a'
        ? 'link'
        : tag === 'input' || tag === 'textarea' || tag === 'select'
          ? 'input'
          : 'button');
    const href = tag === 'a' ? (el.href || undefined) : undefined;
    const placeholder = el.getAttribute('placeholder') || undefined;
    const inputValue = (tag === 'input' || tag === 'textarea') && inputType !== 'file'
      ? String(el.value || '').trim().slice(0, 140) || undefined
      : undefined;
    const options = tag === 'select'
      ? Array.from(el.options || []).slice(0, 18).map(o => (o.text || o.value || '').trim()).filter(Boolean)
      : undefined;

    if (inputValue && inputSnapshots.length < 12) {
      inputSnapshots.push('[' + id + '] ' + inputValue);
    }

    items.push({
      id,
      tag,
      role,
      text: cleanLabel(el),
      href,
      inputType,
      placeholder,
      inputValue,
      options,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      _rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    });
  }

  const root = document.createElement('div');
  root.id = '__som_overlay_root';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;';

  const palette = ['#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed'];

  for (const item of items) {
    const color = item.role === 'input' ? '#2563eb' : item.role === 'button' ? '#059669' : palette[item.id % palette.length];
    const r = item._rect;

    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed',
      'left:' + Math.max(0, r.left) + 'px',
      'top:' + Math.max(0, r.top) + 'px',
      'width:' + Math.min(vw - Math.max(0, r.left), r.width) + 'px',
      'height:' + Math.min(vh - Math.max(0, r.top), r.height) + 'px',
      'border:2px solid ' + color,
      'border-radius:4px',
      'box-sizing:border-box',
      'background:rgba(255,255,255,0.02)'
    ].join(';');

    const badge = document.createElement('div');
    const badgeTop = Math.max(2, r.top - 10);
    const badgeLeft = Math.max(2, Math.min(vw - 32, r.left - 2));
    badge.textContent = String(item.id);
    badge.style.cssText = [
      'position:fixed',
      'left:' + badgeLeft + 'px',
      'top:' + badgeTop + 'px',
      'background:' + color,
      'color:#ffffff',
      'font-size:12px',
      'font-weight:700',
      'line-height:16px',
      'padding:1px 5px',
      'border-radius:4px',
      'border:1px solid #ffffff',
      'box-shadow:0 1px 3px rgba(0,0,0,0.45)'
    ].join(';');

    root.appendChild(box);
    root.appendChild(badge);
    delete item._rect;
  }

  document.documentElement.appendChild(root);

  const rawBody = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1450);
  const maxScroll = Math.max(0, (document.documentElement?.scrollHeight || document.body?.scrollHeight || vh) - vh);
  const scrollPct = maxScroll > 0 ? Math.round((window.scrollY / maxScroll) * 100) : 0;
  const scrollLine = '\\nViewport Scroll: ' + scrollPct + '% (y=' + Math.round(window.scrollY) + '/' + Math.round(maxScroll) + ')';
  const inputLine = inputSnapshots.length ? ('\\nActive Input Values: ' + inputSnapshots.join(' | ')) : '';
  return {
    elements: items,
    pageTitle: document.title || '',
    currentUrl: location.href,
    pageTextSummary: (rawBody + scrollLine + inputLine).slice(0, 1950)
  };
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SECRET = process.env.INTERNAL_CALLBACK_SECRET || '';
const WORKER_BASE_URL = (process.env.WORKER_BASE_URL || '').trim().replace(/\/+$/, '');
const DISPATCH_SESSION_ID = (process.env.DISPATCH_SESSION_ID || '').trim();
const TEST_MODE = process.env.WORKFLOW_INPUT_TEST || '';
const TEST_URL = process.env.WORKFLOW_INPUT_URL || 'https://example.com';
const DOWNLOAD_DIR = '/tmp/wa-downloads';

function redactLog(msg) {
  return String(msg || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/user:[a-zA-Z0-9_-]+/g, 'user:[redacted]');
}

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`Runner callback returned HTTP ${res.status}`);
  }
  return res;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Runner GET failed with HTTP ${res.status}`);
  }
  return res.json();
}

async function clearOverlays(page) {
  try {
    await page.evaluate(() => {
      const el = document.getElementById('__som_overlay_root');
      if (el) el.remove();
    });
  } catch {
    // Ignore evaluation errors during navigation
  }
}

function detectBlockState(title, bodyText) {
  const hay = `${title || ''}\n${bodyText || ''}`.toLowerCase();
  if (
    hay.includes('just a moment...') ||
    hay.includes('checking your browser') ||
    hay.includes('verify you are human')
  ) {
    return 'challenge';
  }
  if (
    hay.includes('attention required! | cloudflare') ||
    hay.includes('sorry, you have been blocked') ||
    hay.includes('you have been blocked')
  ) {
    return 'blocked';
  }
  return 'ok';
}

async function waitForChallengeClear(page) {
  for (let i = 0; i < 6; i++) {
    const info = await page
      .evaluate(() => ({
        title: document.title || '',
        text: (document.body?.innerText || '').slice(0, 800),
      }))
      .catch(() => ({ title: '', text: '' }));
    const state = detectBlockState(info.title, info.text);
    if (state !== 'challenge') return state;
    console.log('Waiting for JS challenge auto-resolution...');
    await sleep(1800);
  }
  const finalInfo = await page
    .evaluate(() => ({
      title: document.title || '',
      text: (document.body?.innerText || '').slice(0, 800),
    }))
    .catch(() => ({ title: '', text: '' }));
  return detectBlockState(finalInfo.title, finalInfo.text);
}

async function captureAnnotatedState(page, seenSet) {
  await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
  await sleep(900);
  await waitForChallengeClear(page);

  const som = await page.evaluate(SOM_EVALUATE_FN);
  let buf = await page.screenshot({ type: 'jpeg', quality: 82, fullPage: false });
  if (buf.byteLength > 4_600_000) {
    buf = await page.screenshot({ type: 'jpeg', quality: 62, fullPage: false });
  }

  let elements = som.elements || [];
  if (seenSet && seenSet.size > 0 && (som.currentUrl || '').includes('google.com/search')) {
    elements = elements.filter((el) => !el.href || !seenSet.has(el.href));
  }

  return {
    elements,
    pageTitle: som.pageTitle || '',
    currentUrl: som.currentUrl || page.url(),
    pageSummary: som.pageTextSummary || '',
    screenshotBase64: buf.toString('base64'),
  };
}

async function closeBrowserSession(session) {
  if (!session) return;
  try {
    await session.context?.close().catch(() => {});
  } catch {
    // Ignore close error
  }
  try {
    await session.browser?.close().catch(() => {});
  } catch {
    // Ignore close error
  }
  if (session.userDataDir) {
    fs.rmSync(session.userDataDir, { recursive: true, force: true });
  }
}

async function launchBrowser(useWarp, extensionDirs = []) {
  const hasDisplay = Boolean(process.env.DISPLAY);
  const hasExtensions = Array.isArray(extensionDirs) && extensionDirs.length > 0;
  const userDataDir = `/tmp/wa-chrome-profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (hasExtensions) {
    const extList = extensionDirs.join(',');
    args.push(`--disable-extensions-except=${extList}`, `--load-extension=${extList}`);
    if (!hasDisplay) {
      args.push('--headless=new');
    }
  }

  const contextOpts = {
    headless: hasExtensions && !hasDisplay ? false : !hasDisplay,
    viewport: { width: 1280, height: 840 },
    locale: 'en-US',
    acceptDownloads: true,
    args,
  };
  if (useWarp) {
    contextOpts.proxy = { server: 'socks5://127.0.0.1:40000' };
  }

  // Branded Google Chrome blocks --load-extension; always use Chromium when extensions are loaded
  let context;
  let browser = null;
  if (hasExtensions) {
    try {
      context = await chromium.launchPersistentContext(userDataDir, contextOpts);
    } catch (extErr) {
      console.warn('Persistent context launch with extensions failed, retrying without extensions:', extErr.message);
      const cleanArgs = args.filter(
        (a) => !a.startsWith('--disable-extensions-except=') && !a.startsWith('--load-extension=')
      );
      context = await chromium.launchPersistentContext(userDataDir, {
        ...contextOpts,
        headless: !hasDisplay,
        args: cleanArgs,
      });
    }
  } else {
    const baseLaunch = {
      headless: !hasDisplay,
      args,
      ...(useWarp ? { proxy: { server: 'socks5://127.0.0.1:40000' } } : {}),
    };
    try {
      browser = await chromium.launch({ ...baseLaunch, channel: 'chrome' });
    } catch (err) {
      console.warn('Chrome channel unavailable, falling back to Patchright chromium:', err.message);
      browser = await chromium.launch(baseLaunch);
    }
    context = await browser.newContext({
      viewport: { width: 1280, height: 840 },
      locale: 'en-US',
      acceptDownloads: true,
    });
  }

  // Wait briefly for MV3 extension service workers / onboarding pages, then close extension tabs
  if (hasExtensions) {
    await sleep(700);
    for (const existingPage of context.pages()) {
      if (existingPage.url().startsWith('chrome-extension://')) {
        await existingPage.close().catch(() => {});
      }
    }
  }

  const page = context.pages().find((p) => !p.url().startsWith('chrome-extension://')) || (await context.newPage());
  console.log(`Browser launched (warp=${useWarp}, extensions=${hasExtensions ? extensionDirs.map((d) => path.basename(d)).join('+') : 'none'})`);
  return { browser, context, page, userDataDir };
}

const PLAYWRIGHT_NAMED_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Space',
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

async function executeKeySequence(page, rawKeys) {
  const tokens = String(rawKeys || 'Enter')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) tokens.push('Enter');

  for (const token of tokens) {
    if (PLAYWRIGHT_NAMED_KEYS.has(token) || token.includes('+') || token.length === 1) {
      await page.keyboard.press(token);
      await sleep(90);
    } else {
      // Multi-char Vimium key sequence like "gg", "gi", "yy", or hint code "ab"
      for (const ch of token) {
        await page.keyboard.press(ch);
        await sleep(60);
      }
    }
  }

  const last = tokens[tokens.length - 1];
  if (last === 'f' || last === 'F' || last === '?') {
    await sleep(250);
  }
}

async function selectOptionRobust(locator, targetValue) {
  const text = String(targetValue || '').trim();
  const matched = await locator
    .selectOption({ label: text }, { timeout: 4000 })
    .catch(async () => locator.selectOption({ value: text }, { timeout: 4000 }))
    .catch(() => null);

  if (matched && matched.length > 0) return;

  const ok = await locator.evaluate((el, needle) => {
    if (!el || el.tagName.toLowerCase() !== 'select') return false;
    const low = needle.toLowerCase();
    const opts = Array.from(el.options || []);
    const hit = opts.find(
      (o) =>
        (o.text || '').trim().toLowerCase().includes(low) ||
        (o.value || '').trim().toLowerCase().includes(low)
    );
    if (!hit) return false;
    el.value = hit.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, text);

  if (!ok) {
    throw new Error(`Could not find option "${text}" in select dropdown.`);
  }
}

async function main() {
  const warpReady = fs.existsSync('/tmp/warp_ready');
  const extensionDirs = await ensureExtensions();
  console.log(
    `WARP SOCKS5 ready: ${warpReady}, DISPLAY: ${process.env.DISPLAY || 'none'}, Extensions: ${extensionDirs.length}`
  );

  if (TEST_MODE === 'smoke') {
    let usingWarp = warpReady;
    let session = await launchBrowser(usingWarp, extensionDirs);
    let { page } = session;
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1000);
    let blockState = await waitForChallengeClear(page);
    console.log(`Smoke check (warp=${usingWarp}) state=${blockState}`);
    if (blockState === 'blocked' && warpReady) {
      await closeBrowserSession(session);
      usingWarp = !usingWarp;
      session = await launchBrowser(usingWarp, extensionDirs);
      ({ page } = session);
      await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1000);
      blockState = await waitForChallengeClear(page);
      console.log(`Smoke retry (warp=${usingWarp}) state=${blockState}`);
    }
    await closeBrowserSession(session);
    return;
  }

  let payload = {};
  if (WORKER_BASE_URL && DISPATCH_SESSION_ID) {
    payload = await getJson(
      `${WORKER_BASE_URL}/api/runner/init?session_id=${encodeURIComponent(DISPATCH_SESSION_ID)}`
    );
  } else if (process.env.CLIENT_PAYLOAD_JSON) {
    payload = JSON.parse(process.env.CLIENT_PAYLOAD_JSON);
  }
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};

  const sessionId = payload.session_id || DISPATCH_SESSION_ID;
  const targetUrl = payload.target_url || 'https://www.google.com';
  const callbackUrl =
    payload.callback_url || (WORKER_BASE_URL ? `${WORKER_BASE_URL}/api/job-callback` : '');
  const pollUrl =
    payload.poll_url || (WORKER_BASE_URL ? `${WORKER_BASE_URL}/api/runner/poll` : '');
  const resultUrl =
    payload.result_url || (WORKER_BASE_URL ? `${WORKER_BASE_URL}/api/runner/result` : '');
  const userId = payload.user_id || payload.to;
  const query = payload.query || meta.query || '';
  const seenUrls = Array.isArray(payload.seen_urls)
    ? payload.seen_urls
    : Array.isArray(meta.seen_urls)
      ? meta.seen_urls
      : [];
  const seenSet = new Set(seenUrls);

  if (!sessionId || !pollUrl || !resultUrl) {
    throw new Error('Missing required session configuration (WORKER_BASE_URL or session_id)');
  }

  let usingWarp = warpReady;
  let browserSession = await launchBrowser(usingWarp, extensionDirs);
  let { context, page } = browserSession;
  let pages = [page];
  let activeTabIndex = 0;

  const downloadedFiles = [];
  const activeDownloadPromises = new Set();

  const pruneClosedPages = () => {
    const alive = pages.filter((p) => !p.isClosed());
    if (alive.length > 0) {
      pages = alive;
      if (activeTabIndex >= pages.length || pages[activeTabIndex]?.isClosed()) {
        activeTabIndex = pages.length - 1;
      }
      page = pages[activeTabIndex];
    }
  };

  const trackPage = (p) => {
    if (!pages.includes(p)) {
      pages.push(p);
    }
    if (!p.__waTracked) {
      p.__waTracked = true;
      p.on('close', () => {
        pruneClosedPages();
      });
      p.on('download', (download) => {
        const dlTask = (async () => {
          try {
            const rawName = path.basename(download.suggestedFilename() || `download-${Date.now()}.bin`);
            const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file.bin';
            const destPath = path.join(DOWNLOAD_DIR, `${Date.now()}-${safeName}`);
            await download.saveAs(destPath);
            const stat = fs.statSync(destPath);
            downloadedFiles.push({
              filename: safeName,
              path: destPath,
              sizeBytes: stat.size,
              url: download.url(),
            });
            console.log(`Downloaded file captured (${stat.size} bytes)`);
          } catch {
            console.warn('Download capture failed');
          }
        })();
        activeDownloadPromises.add(dlTask);
        dlTask.finally(() => activeDownloadPromises.delete(dlTask));
      });
    }
  };

  const waitForInflightDownloads = async () => {
    if (activeDownloadPromises.size > 0) {
      await Promise.race([Promise.allSettled(Array.from(activeDownloadPromises)), sleep(4000)]);
    }
  };

  const serializeDownloads = () =>
    downloadedFiles.map(({ filename, sizeBytes, url }) => ({ filename, sizeBytes, url }));

  const attachPopupHandler = (ctx) => {
    ctx.on('page', async (newPage) => {
      if (newPage.url().startsWith('chrome-extension://')) {
        await newPage.close().catch(() => {});
        return;
      }
      trackPage(newPage);
      activeTabIndex = pages.indexOf(newPage);
      page = newPage;
      await newPage.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      if (newPage.url().startsWith('chrome-extension://')) {
        await newPage.close().catch(() => {});
        pruneClosedPages();
      }
    });
  };
  trackPage(page);
  attachPopupHandler(context);

  const getTabsSummary = async () => {
    pruneClosedPages();
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = '';
      let url = '';
      try {
        url = p.url();
        title = await p.title();
      } catch {
        // Ignore transient navigation race
      }
      out.push({
        index: i,
        title: (title || '').slice(0, 80),
        url: (url || '').slice(0, 220),
        active: i === activeTabIndex,
      });
    }
    return out;
  };

  const recoverIfBlocked = async (snap) => {
    const state = detectBlockState(snap.pageTitle, snap.pageSummary);
    if (state !== 'blocked') return snap;
    if (!warpReady) return snap;

    const failedUrl = snap.currentUrl || page.url();
    console.warn(`Detected block (warp=${usingWarp}), toggling transport...`);
    await closeBrowserSession(browserSession);
    usingWarp = !usingWarp;
    browserSession = await launchBrowser(usingWarp, extensionDirs);
    ({ context, page } = browserSession);
    pages = [page];
    activeTabIndex = 0;
    trackPage(page);
    attachPopupHandler(context);
    await page.goto(failedUrl, { waitUntil: 'domcontentloaded', timeout: 22000 }).catch(() => {});
    return captureAnnotatedState(page, seenSet);
  };

  const executeSingleAction = async (type, p) => {
    if (type === 'click') {
      const id = Number(p.element_id ?? p.elementId);
      const locator = page.locator(`[data-som-id="${id}"]`).first();
      const count = await locator.count();
      if (count > 0) {
        await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await locator.click({ timeout: 6000 });
        } catch {
          try {
            await locator.click({ force: true, timeout: 4000 });
          } catch {
            const box = await locator.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            } else if (p.x && p.y) {
              await page.mouse.click(Number(p.x), Number(p.y));
            } else {
              await locator.evaluate((el) => el.click());
            }
          }
        }
      } else if (p.x && p.y) {
        await page.mouse.click(Number(p.x), Number(p.y));
      } else if (p.href) {
        await page.goto(p.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } else {
        throw new Error(`Element [${id}] is not visible on the current page.`);
      }
      return;
    }

    if (type === 'click_text') {
      const needle = String(p.text ?? '').trim();
      if (!needle) throw new Error('click_text requires non-empty text.');
      const loc = page.getByText(needle, { exact: false }).first();
      if ((await loc.count()) === 0) {
        throw new Error(`No visible element matching text "${needle}".`);
      }
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 6000 }).catch(async () => {
        await loc.click({ force: true, timeout: 4000 });
      });
      return;
    }

    if (type === 'press_key') {
      const key = String(p.text ?? 'Enter').trim() || 'Enter';
      await executeKeySequence(page, key);
      return;
    }

    if (type === 'upload_file') {
      await waitForInflightDownloads();
      if (downloadedFiles.length === 0) {
        throw new Error('No downloaded file is available yet to upload.');
      }
      const needle = String(p.text ?? '').trim().toLowerCase();
      const targetFile =
        (needle
          ? downloadedFiles.find((f) => f.filename.toLowerCase().includes(needle))
          : null) || downloadedFiles[downloadedFiles.length - 1];

      const id = Number(p.element_id ?? p.elementId ?? 0);
      const locator = id > 0 ? page.locator(`[data-som-id="${id}"]`).first() : null;

      if (locator && (await locator.count()) > 0) {
        const isFileInput = await locator
          .evaluate((el) => el.tagName.toLowerCase() === 'input' && el.type === 'file')
          .catch(() => false);
        if (isFileInput) {
          await locator.setInputFiles(targetFile.path);
          return;
        }
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 4500 }).catch(() => null);
        await locator.click({ timeout: 5000 }).catch(async () => {
          await locator.click({ force: true, timeout: 3000 });
        });
        const chooser = await chooserPromise;
        if (chooser) {
          await chooser.setFiles(targetFile.path);
          return;
        }
      }

      const fallbackInput = page.locator('input[type="file"]').first();
      if ((await fallbackInput.count()) > 0) {
        await fallbackInput.setInputFiles(targetFile.path);
        return;
      }
      throw new Error('Could not find a file chooser or <input type="file"> for upload.');
    }

    if (type === 'type') {
      const id = Number(p.element_id ?? p.elementId);
      const textToType = String(p.text ?? '');
      const pressEnter = Boolean(p.press_enter ?? p.pressEnter);
      const locator = page.locator(`[data-som-id="${id}"]`).first();
      if ((await locator.count()) === 0) {
        throw new Error(`Input [${id}] is not visible on the current page.`);
      }
      const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
      if (tag === 'select') {
        await selectOptionRobust(locator, textToType);
        return;
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 6000 }).catch(async () => {
        await locator.click({ force: true, timeout: 3000 });
      });
      await locator.fill(textToType, { timeout: 6000 }).catch(async () => {
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.type(textToType, { delay: 20 });
      });
      if (pressEnter) {
        await page.keyboard.press('Enter');
      }
      return;
    }

    if (type === 'select') {
      const id = Number(p.element_id ?? p.elementId);
      const val = String(p.text ?? '');
      const locator = page.locator(`[data-som-id="${id}"]`).first();
      if ((await locator.count()) === 0) {
        throw new Error(`Select [${id}] is not visible on the current page.`);
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await selectOptionRobust(locator, val);
      return;
    }

    if (type === 'scroll') {
      const delta = p.direction === 'up' ? -620 : 620;
      await page.evaluate((y) => window.scrollBy(0, y), delta);
      return;
    }

    if (type === 'wait') {
      const ms = Math.min(8000, Math.max(500, Number(p.wait_ms ?? 2500)));
      await sleep(ms);
      return;
    }

    if (type === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 14000 }).catch(() => {});
      return;
    }

    if (type === 'navigate') {
      if (Array.isArray(p.seenUrls)) {
        for (const u of p.seenUrls) seenSet.add(u);
      }
      await page.goto(String(p.url), { waitUntil: 'domcontentloaded', timeout: 22000 });
      return;
    }

    if (type === 'new_tab') {
      const newPage = await context.newPage();
      trackPage(newPage);
      activeTabIndex = pages.indexOf(newPage);
      page = newPage;
      await page.goto(String(p.url), { waitUntil: 'domcontentloaded', timeout: 22000 });
      return;
    }

    if (type === 'switch_tab') {
      pruneClosedPages();
      const idx = Math.max(0, Math.min(pages.length - 1, Number(p.tab_index ?? 0)));
      activeTabIndex = idx;
      page = pages[activeTabIndex];
      await page.bringToFront().catch(() => {});
      return;
    }

    if (type === 'more') {
      const clickedNext = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a, button'));
        const nextEl = candidates.find((el) =>
          /^(next|more|load more|show more|›|»)$/i.test((el.textContent || '').trim())
        );
        if (nextEl) {
          nextEl.click();
          return true;
        }
        return false;
      });
      if (!clickedNext) {
        await page.evaluate(() => window.scrollBy(0, 680));
      }
    }
  };

  try {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 22000 });
    } catch (navErr) {
      if (usingWarp) {
        console.warn('WARP navigation failed, retrying direct');
        await closeBrowserSession(browserSession);
        usingWarp = false;
        browserSession = await launchBrowser(false, extensionDirs);
        ({ context, page } = browserSession);
        pages = [page];
        activeTabIndex = 0;
        trackPage(page);
        attachPopupHandler(context);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 22000 });
      } else {
        throw navErr;
      }
    }

    let initialSnap = await captureAnnotatedState(page, seenSet);
    initialSnap = await recoverIfBlocked(initialSnap);

    await postJson(resultUrl, {
      session_id: sessionId,
      status: 'active',
      current_url: initialSnap.currentUrl,
      page_title: initialSnap.pageTitle,
      page_summary: initialSnap.pageSummary,
      elements: initialSnap.elements,
      tabs: await getTabsSummary(),
      downloads: serializeDownloads(),
      screenshot_base64: initialSnap.screenshotBase64,
    });

    if (query && callbackUrl) {
      const newlySeen = initialSnap.elements
        .map((e) => e.href)
        .filter((h) => h && !h.includes('google.com/search'))
        .slice(0, 20);
      await postJson(callbackUrl, {
        session_id: sessionId,
        status: 'active',
        user_id: userId,
        pagination_state: {
          query,
          current_page: Number(meta.page || 1),
          seen_urls: Array.from(new Set([...seenUrls, ...newlySeen])).slice(-120),
        },
      });
    }

    const sessionStart = Date.now();
    let lastCommandAt = Date.now();
    const MAX_RUN_MS = 25 * 60 * 1000;
    const IDLE_TIMEOUT_MS = 12 * 60 * 1000;

    while (Date.now() - sessionStart < MAX_RUN_MS) {
      if (Date.now() - lastCommandAt > IDLE_TIMEOUT_MS) {
        if (callbackUrl) {
          await postJson(callbackUrl, {
            session_id: sessionId,
            status: 'closed',
            error: 'Session closed after 12 minutes of inactivity.',
          });
        }
        break;
      }

      let pollData;
      try {
        pollData = await getJson(`${pollUrl}?session_id=${encodeURIComponent(sessionId)}`);
      } catch (err) {
        console.warn('Poll error:', err.message);
        await sleep(1500);
        continue;
      }

      if (pollData.should_exit && !pollData.command) {
        break;
      }

      const cmd = pollData.command;
      if (!cmd) {
        await sleep(1000);
        continue;
      }

      lastCommandAt = Date.now();
      console.log(`Executing command (${cmd.type})`);

      if (cmd.type === 'close') {
        await postJson(resultUrl, {
          session_id: sessionId,
          command_id: cmd.id,
          status: 'closed',
          note: 'Session closed.',
        });
        break;
      }

      try {
        const p = cmd.payload || {};

        if (cmd.type === 'batch' && Array.isArray(p.actions)) {
          for (let idx = 0; idx < p.actions.length; idx++) {
            const step = p.actions[idx];
            await clearOverlays(page);
            const urlBefore = page.url();
            const tabBefore = activeTabIndex;
            await executeSingleAction(step.action, step);
            await sleep(350);
            if (page.url() !== urlBefore || activeTabIndex !== tabBefore) {
              break;
            }
          }
        } else if (cmd.type !== 'ss') {
          await clearOverlays(page);
          await executeSingleAction(cmd.type, p);
        }

        await waitForInflightDownloads();
        let snap = await captureAnnotatedState(page, seenSet);
        snap = await recoverIfBlocked(snap);
        await postJson(resultUrl, {
          session_id: sessionId,
          command_id: cmd.id,
          status: 'active',
          current_url: snap.currentUrl,
          page_title: snap.pageTitle,
          page_summary: snap.pageSummary,
          elements: snap.elements,
          tabs: await getTabsSummary(),
          downloads: serializeDownloads(),
          screenshot_base64: snap.screenshotBase64,
        });
      } catch (cmdErr) {
        const errMsg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
        await waitForInflightDownloads();
        let fallbackSnap = null;
        try {
          fallbackSnap = await captureAnnotatedState(page, seenSet);
        } catch {
          // Ignore secondary capture error
        }
        await postJson(resultUrl, {
          session_id: sessionId,
          command_id: cmd.id,
          status: 'active',
          error: errMsg,
          current_url: fallbackSnap?.currentUrl,
          page_title: fallbackSnap?.pageTitle,
          page_summary: fallbackSnap?.pageSummary,
          elements: fallbackSnap?.elements,
          tabs: await getTabsSummary().catch(() => []),
          downloads: serializeDownloads(),
          screenshot_base64: fallbackSnap?.screenshotBase64,
        });
      }
    }
  } catch (fatalErr) {
    if (callbackUrl) {
      await postJson(callbackUrl, {
        session_id: sessionId,
        status: 'error',
        error: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
      });
    }
    throw fatalErr;
  } finally {
    await closeBrowserSession(browserSession);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', redactLog(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
