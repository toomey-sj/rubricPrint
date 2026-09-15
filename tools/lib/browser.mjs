/* A minimum Chrome DevTools Protocol driver — node builtins only, no puppeteer.

   WHY THIS EXISTS. app/year.js is pure and tools/year-test.mjs covers it in
   milliseconds, which is where every rule about identity and permanence belongs.
   But app.js is now a real amount of logic — which file is being imported and
   into what, what a confirmation says before it writes, whether a refusal left
   the store alone — and none of that is reachable from Node. The first run of
   the suite this drives found four faults that every pure test passed over: a
   cancelled file pick that stayed armed and wrote the next drop-in roster into a
   class, an exception that took the roster list off screen for a student with no
   first name, a seed that created three classes before refusing the fourth, and
   a refusal that wiped the print list while saying nothing had changed.

   NOT PART OF `npm test`. It needs Chrome and a running server, and the point of
   the other two suites is that they need neither. `npm run test:ui`.

   No dependency, because tools/ may use npm but a browser driver is 120 lines of
   WebSocket and Node has had one built in since v22. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Edge is Chromium and speaks the same protocol, so a machine with either can
   run this. RUBRIC_CHROME wins, for anyone whose install is somewhere else. */
const CANDIDATES = [
  process.env.RUBRIC_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

export function findBrowser() {
  return CANDIDATES.find((path) => existsSync(path)) || null;
}

export async function launch({ port = 9333 } = {}) {
  const binary = findBrowser();
  if (!binary) {
    const err = new Error('No Chrome or Edge found. Looked in:\n  ' +
      CANDIDATES.join('\n  ') + '\nSet RUBRIC_CHROME to the executable.');
    err.usage = true;
    throw err;
  }

  const profile = mkdtempSync(join(tmpdir(), 'rubric-ui-'));
  const child = spawn(binary, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not listening yet */ }
  }
  if (!target) throw new Error('The browser did not come up on port ' + port + '.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let next = 1;
  const pending = new Map();
  /* Everything the page said. A suite that passes while the console is full of
     exceptions is a suite that is testing the wrong thing, so the runner prints
     this and treats it as a failure. */
  const logs = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push('console.error: ' +
        msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('uncaught: ' + (msg.params.exceptionDetails.exception?.description ||
        msg.params.exceptionDetails.text));
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  return {
    send,
    logs,
    async goto(url) {
      const loaded = new Promise((resolve) => {
        const on = (e) => {
          if (JSON.parse(e.data).method === 'Page.loadEventFired') {
            ws.removeEventListener('message', on);
            resolve();
          }
        };
        ws.addEventListener('message', on);
      });
      await send('Page.navigate', { url });
      await loaded;
      await new Promise((r) => setTimeout(r, 250));
    },
    async eval(expression) {
      const res = await send('Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text);
      }
      return res.result.value;
    },
    /* Hands a real file to a real <input type=file>. The app reads every file
       through FileReader after a person picked or dropped it (there is no fetch
       of a sibling file to stub), so this is the only honest way in.

       NOTE: this fires `change` itself. Dispatching one as well runs the reader
       twice, which is how the first version of this suite made the app import
       the same file down two different paths. */
    async setFile(selector, path) {
      const doc = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
      if (!node.nodeId) throw new Error('No element matches ' + selector);
      await send('DOM.setFileInputFiles', { files: [path], nodeId: node.nodeId });
    },
    async close() {
      ws.close();
      child.kill();
      await new Promise((r) => setTimeout(r, 200));
      /* Windows holds the profile open a moment after the process goes. It is in
         the temp directory either way, so a failure here is not worth reporting. */
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };
}
