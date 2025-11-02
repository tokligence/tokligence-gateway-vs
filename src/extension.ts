import * as vscode from 'vscode';
import axios from 'axios';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as stream from 'stream';
import { promisify } from 'util';
import * as zlib from 'zlib';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';

let child: cp.ChildProcess | undefined;
const pipeline = promisify(stream.pipeline);
let output: vscode.OutputChannel | undefined;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('tokligence-gateway');
  return {
    url: cfg.get<string>('url', 'http://localhost:8080'),
    apiPath: cfg.get<string>('apiPath', '/v1/chat/completions'),
    model: cfg.get<string>('model', 'gpt-4o-mini'),
    healthPath: cfg.get<string>('healthPath', '/healthz'),
    systemPrompt: cfg.get<string>('systemPrompt', 'You are a helpful coding assistant.'),
    version: cfg.get<string>('version', 'v0.2.0'),
    startLocalBinary: cfg.get<boolean>('startLocalBinary', false),
    binaryPath: cfg.get<string>('binaryPath', ''),
    autoDownloadBinary: cfg.get<boolean>('autoDownloadBinary', true),
    useStreaming: cfg.get<boolean>('useStreaming', true),
    requestTimeoutMs: cfg.get<number>('requestTimeoutMs', 60_000),
    requestHeaders: cfg.get<Record<string, string>>('requestHeaders', {}),
  };
}

async function buildHeaders(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cfg = getConfig();
  for (const [k, v] of Object.entries(cfg.requestHeaders)) {
    headers[k] = v;
  }
  const apiKey = await context.secrets.get('tokligence.apiKey');
  if (apiKey) {
    // Default to Authorization: Bearer <key>, can be overridden by requestHeaders
    if (!(headers as any)['Authorization']) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }
  return headers;
}

async function testConnection(context: vscode.ExtensionContext) {
  const cfg = getConfig();
  const url = new URL(cfg.healthPath || '/', cfg.url).toString();
  try {
    const headers = await buildHeaders(context);
    const res = await axios.get(url, { headers, timeout: 5000, validateStatus: () => true });
    if (res.status >= 200 && res.status < 300) {
      vscode.window.showInformationMessage(`Tokligence Gateway OK: ${res.status}`);
    } else {
      vscode.window.showWarningMessage(`Tokligence Gateway responded: ${res.status}`);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Tokligence Gateway not reachable: ${err?.message || err}`);
  }
}

function getDefaultBinaryPath(context: vscode.ExtensionContext) {
  const binName = process.platform === 'win32' ? 'tokligence-gateway.exe' : 'tokligence-gateway';
  return path.join(context.globalStorageUri.fsPath, 'bin', binName);
}

async function startLocalGateway(context: vscode.ExtensionContext) {
  if (child && !child.killed) {
    vscode.window.showInformationMessage('Tokligence Gateway is already running.');
    return;
  }
  const consentKey = 'tokligence.binaryStartConsent';
  const consent = context.globalState.get<boolean>(consentKey);
  if (!consent) {
    const pick = await vscode.window.showInformationMessage(
      'Start the local Tokligence Gateway binary? This runs a local process on your machine.',
      { modal: true },
      'Allow once', 'Always allow', 'Cancel'
    );
    if (pick === 'Cancel' || !pick) return;
    if (pick === 'Always allow') await context.globalState.update(consentKey, true);
  }
  const cfg = getConfig();
  let binPath = cfg.binaryPath && cfg.binaryPath.trim().length > 0 ? cfg.binaryPath : getDefaultBinaryPath(context);

  try {
    await fs.promises.access(binPath, fs.constants.X_OK);
  } catch {
    if (cfg.autoDownloadBinary) {
      const ok = await downloadOrUpdateBinary(context).catch((e) => {
        vscode.window.showErrorMessage(`Download failed: ${e?.message || e}`);
        return false;
      });
      if (!ok) return;
      binPath = cfg.binaryPath && cfg.binaryPath.trim().length > 0 ? cfg.binaryPath : getDefaultBinaryPath(context);
      try {
        await fs.promises.access(binPath, fs.constants.X_OK);
      } catch {
        vscode.window.showErrorMessage(`Binary still missing or not executable: ${binPath}`);
        return;
      }
    } else {
      vscode.window.showErrorMessage(`Binary not found or not executable: ${binPath}`);
      return;
    }
  }

  const binDir = path.dirname(binPath);
  await fs.promises.mkdir(binDir, { recursive: true });

  child = cp.spawn(binPath, [], { cwd: binDir, env: process.env });
  if (!output) output = vscode.window.createOutputChannel('Tokligence Gateway');
  child.stdout?.on('data', (d) => output?.append(`[stdout] ${d}`));
  child.stderr?.on('data', (d) => output?.append(`[stderr] ${d}`));
  child.on('exit', (code) => {
    output?.appendLine(`tokligence-gateway exited with code ${code}`);
  });
  vscode.window.showInformationMessage(`Tokligence Gateway started: ${binPath}`);
}

async function stopLocalGateway() {
  if (child && !child.killed) {
    child.kill();
    vscode.window.showInformationMessage('Tokligence Gateway stopped.');
  } else {
    vscode.window.showInformationMessage('Tokligence Gateway is not running.');
  }
}

async function setApiKey(context: vscode.ExtensionContext) {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter API Key (Authorization Bearer)',
    ignoreFocusOut: true,
    password: true,
  });
  if (key) {
    await context.secrets.store('tokligence.apiKey', key);
    vscode.window.showInformationMessage('Tokligence API key saved.');
  }
}

function getWebviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext) {
  const nonce = Math.random().toString(36).slice(2);
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tokligence Chat</title>
  <style>
    body { font-family: var(--vscode-font-family); margin: 0; }
    .wrap { display:flex; flex-direction: column; height: 100vh; }
    .log { flex:1; padding: 12px; overflow:auto; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
    .input { display:flex; gap:8px; padding: 8px; border-top: 1px solid var(--vscode-editorGroup-border); align-items: flex-end; }
    textarea { flex:1; resize: vertical; min-height: 48px; }
    button { padding: 6px 12px; }
    .msg-user { color: var(--vscode-textLink-foreground); }
    .msg-assistant { color: var(--vscode-editor-foreground); }
    .toolbar { display:flex; gap:8px; margin-left: 8px; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <div class="log" id="log"></div>
      <div class="input">
        <textarea id="prompt" placeholder="Ask Tokligence…"></textarea>
        <div class="toolbar">
          <button id="send">Send</button>
          <button id="stop">Stop</button>
          <button id="clear">Clear</button>
        </div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const log = document.getElementById('log');
      const promptEl = document.getElementById('prompt');
      const sendBtn = document.getElementById('send');
      const stopBtn = document.getElementById('stop');
      const clearBtn = document.getElementById('clear');
      let lastAI;
      function setBusy(b) {
        sendBtn.disabled = b; stopBtn.disabled = !b; promptEl.disabled = b;
      }
      function append(role, text) {
        const p = document.createElement('p');
        p.className = role === 'user' ? 'msg-user' : 'msg-assistant';
        p.textContent = (role === 'user' ? 'You: ' : 'AI: ') + text;
        log.appendChild(p);
        if (role !== 'user') lastAI = p;
        log.scrollTop = log.scrollHeight;
      }
      sendBtn.addEventListener('click', () => {
        const text = promptEl.value.trim();
        if (!text) return;
        append('user', text);
        vscode.postMessage({ type: 'send', text });
        setBusy(true);
      });
      stopBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
      });
      clearBtn.addEventListener('click', () => {
        log.innerHTML = '';
        lastAI = undefined;
        vscode.postMessage({ type: 'clear' });
      });
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'resp') {
          if (msg.text) append('assistant', msg.text);
          setBusy(false);
          promptEl.value = '';
        } else if (msg.type === 'delta') {
          if (!lastAI) {
            append('assistant', msg.text || '');
          } else {
            lastAI.textContent += msg.text || '';
            log.scrollTop = log.scrollHeight;
          }
        } else if (msg.type === 'error') {
          append('assistant', 'Error: ' + msg.text);
          setBusy(false);
        }
      });
    </script>
  </body>
  </html>`;
}

async function openChat(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'tokligenceChat',
    'Tokligence Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  panel.webview.html = getWebviewHtml(panel.webview, context);

  const history: Array<{ role: 'system' | 'user' | 'assistant', content: string }> = [];
  const cfg0 = getConfig();
  history.push({ role: 'system', content: cfg0.systemPrompt });
  let currentController: AbortController | undefined;

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type !== 'send') return;
    const text: string = message.text ?? '';
    try {
      const cfg = getConfig();
      const url = new URL(cfg.apiPath, cfg.url).toString();
      const headers = await buildHeaders(context);
      history.push({ role: 'user', content: text });
      const payload: any = {
        model: cfg.model,
        messages: history,
        stream: cfg.useStreaming,
      };

      if (cfg.useStreaming) {
        // cancel any previous stream
        if (currentController) { try { currentController.abort(); } catch {} }
        const controller = new AbortController();
        currentController = controller;
        let acc = '';
        await streamChat(url, headers, payload, (delta) => {
          acc += delta;
          panel.webview.postMessage({ type: 'delta', text: delta });
        }, cfg.requestTimeoutMs, controller);
        history.push({ role: 'assistant', content: acc });
        panel.webview.postMessage({ type: 'resp', text: '' });
      } else {
        const res = await axios.post(url, payload, { headers, timeout: cfg.requestTimeoutMs });
        let content = '';
        if (res?.data?.choices?.[0]?.message?.content) {
          content = res.data.choices[0].message.content;
        } else if (typeof res.data === 'string') {
          content = res.data;
        } else {
          content = JSON.stringify(res.data);
        }
        history.push({ role: 'assistant', content });
        panel.webview.postMessage({ type: 'resp', text: content });
      }
    } catch (err: any) {
      panel.webview.postMessage({ type: 'error', text: err?.message || String(err) });
    }
  });

  panel.webview.onDidReceiveMessage((message) => {
    if (message?.type === 'cancel') {
      if (currentController) {
        try { currentController.abort(); } catch {}
        currentController = undefined;
      }
    } else if (message?.type === 'clear') {
      const cfg = getConfig();
      history.length = 0;
      history.push({ role: 'system', content: cfg.systemPrompt });
    }
  });
}

async function streamChat(url: string, headers: Record<string, string>, payload: any, onDelta: (delta: string) => void, timeoutMs: number, controller?: AbortController) {
  const ctrl = controller ?? new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const h: any = { ...headers, Accept: 'text/event-stream' };
    const res = await fetch(url, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(payload),
      signal: (ctrl as any).signal,
    } as any);

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if ('type' in event && event.type === 'event') {
        const data = event.data;
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? '';
          if (delta) onDelta(delta);
        } catch {
          // Fallback: raw text
          if (data) onDelta(data);
        }
      }
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
    }
  } finally {
    clearTimeout(to);
  }
}

function platformLabels() {
  const p = process.platform;
  const a = process.arch;
  const osLabel = p === 'win32' ? 'windows' : p === 'darwin' ? 'darwin' : 'linux';
  const archLabels = a === 'x64' ? ['amd64', 'x86_64', 'x64'] : a === 'arm64' ? ['arm64', 'aarch64'] : [a];
  return { osLabel, archLabels };
}

async function downloadOrUpdateBinary(context: vscode.ExtensionContext): Promise<boolean> {
  const consentKey = 'tokligence.binaryDownloadConsent';
  const consent = context.globalState.get<boolean>(consentKey);
  if (!consent) {
    const pick = await vscode.window.showInformationMessage(
      'Download/update Tokligence Gateway binary from GitHub Releases?',
      { modal: true },
      'Allow once', 'Always allow', 'Cancel'
    );
    if (pick === 'Cancel' || !pick) return false;
    if (pick === 'Always allow') await context.globalState.update(consentKey, true);
  }
  const cfg = getConfig();
  const version = cfg.version || 'v0.2.0';
  const storageBin = path.dirname(getDefaultBinaryPath(context));
  await fs.promises.mkdir(storageBin, { recursive: true });
  const binName = process.platform === 'win32' ? 'tokligence-gateway.exe' : 'tokligence-gateway';
  const targetBin = path.join(storageBin, binName);

  return await vscode.window.withProgress<boolean>({ location: vscode.ProgressLocation.Notification, title: 'Downloading Tokligence Gateway' }, async (progress) => {
    progress.report({ message: 'Resolving release assets…' });
    const api = `https://api.github.com/repos/tokligence/tokligence-gateway/releases/tags/${encodeURIComponent(version)}`;
    const resp = await axios.get(api, {
      headers: { 'User-Agent': 'Tokligence-VS', 'Accept': 'application/vnd.github+json' },
      timeout: 20_000,
    });
    const assets: any[] = resp?.data?.assets || [];
    if (!Array.isArray(assets) || assets.length === 0) {
      throw new Error('No assets found in release.');
    }
    const { osLabel, archLabels } = platformLabels();
    const candidates = assets.filter(a => {
      const name: string = a?.name || '';
      if (!name) return false;
      if (!name.toLowerCase().includes(osLabel)) return false;
      return archLabels.some(al => name.toLowerCase().includes(al));
    });
    if (candidates.length === 0) {
      const names = assets.map(a => a?.name).filter(Boolean).join(', ');
      throw new Error(`No matching asset for ${osLabel}/${process.arch}. Found: ${names}`);
    }
    // Prefer archives, then raw binary
    const preferred = candidates.sort((a, b) => {
      const an = String(a.name).toLowerCase();
      const bn = String(b.name).toLowerCase();
      const ascore = (an.endsWith('.tar.gz') ? 0 : an.endsWith('.zip') ? 1 : 2);
      const bscore = (bn.endsWith('.tar.gz') ? 0 : bn.endsWith('.zip') ? 1 : 2);
      return ascore - bscore;
    })[0];
    const url = preferred.browser_download_url as string;
    const tmpFile = path.join(os.tmpdir(), `tokligence-${Date.now()}-${path.basename(url)}`);
    progress.report({ message: `Downloading ${path.basename(url)}…` });
    const dl = await axios.get(url, { responseType: 'stream', timeout: 120_000, headers: { 'User-Agent': 'Tokligence-VS' } });
    await pipeline(dl.data, fs.createWriteStream(tmpFile));

    const lower = url.toLowerCase();
    progress.report({ message: 'Extracting…' });
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      await tar.x({ file: tmpFile, cwd: storageBin });
    } else if (lower.endsWith('.zip')) {
      const zip = new AdmZip(tmpFile);
      zip.extractAllTo(storageBin, true);
    } else {
      await fs.promises.copyFile(tmpFile, targetBin);
    }

    // Try to locate the binary if it isn't at targetBin
    let finalBin = targetBin;
    try {
      await fs.promises.access(finalBin);
    } catch {
      // Search for a file starting with tokligence-gateway
      const files = await fs.promises.readdir(storageBin);
      const cand = files.find(f => f.startsWith('tokligence-gateway'));
      if (!cand) throw new Error('Binary not found after extraction.');
      finalBin = path.join(storageBin, cand);
    }
    try { await fs.promises.chmod(finalBin, 0o755); } catch {}

    progress.report({ message: 'Done.' });
    return true;
  });
}

async function selectModel(context: vscode.ExtensionContext) {
  const cfg = getConfig();
  const headers = await buildHeaders(context);
  const url = new URL('/v1/models', cfg.url).toString();
  try {
    const res = await axios.get(url, { headers, timeout: 10_000 });
    const data = res?.data;
    let models: string[] = [];
    if (Array.isArray(data?.data)) {
      models = data.data.map((m: any) => m?.id).filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      models = data.models.map((m: any) => m?.id ?? m).filter(Boolean);
    }
    if (models.length === 0) {
      const input = await vscode.window.showInputBox({ prompt: 'Enter model name', value: cfg.model });
      if (!input) return;
      await vscode.workspace.getConfiguration('tokligence-gateway').update('model', input, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Model set to ${input}`);
      return;
    }
    const pick = await vscode.window.showQuickPick(models, { placeHolder: 'Select a model' });
    if (!pick) return;
    await vscode.workspace.getConfiguration('tokligence-gateway').update('model', pick, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Model set to ${pick}`);
  } catch (e: any) {
    const input = await vscode.window.showInputBox({ prompt: 'Enter model name', value: cfg.model });
    if (!input) return;
    await vscode.workspace.getConfiguration('tokligence-gateway').update('model', input, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Model set to ${input}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const disposables: vscode.Disposable[] = [];
  disposables.push(vscode.commands.registerCommand('tokligence.openChat', () => openChat(context)));
  disposables.push(vscode.commands.registerCommand('tokligence.selectModel', () => selectModel(context)));
  disposables.push(vscode.commands.registerCommand('tokligence.testConnection', () => testConnection(context)));
  disposables.push(vscode.commands.registerCommand('tokligence.setApiKey', () => setApiKey(context)));
  disposables.push(vscode.commands.registerCommand('tokligence.startLocalGateway', () => startLocalGateway(context)));
  disposables.push(vscode.commands.registerCommand('tokligence.stopLocalGateway', () => stopLocalGateway()));
  disposables.push(vscode.commands.registerCommand('tokligence.downloadBinary', () => downloadOrUpdateBinary(context)));

  if (getConfig().startLocalBinary) {
    // If binary missing and auto-download enabled, try to fetch it, then start
    const cfg = getConfig();
    const tryStart = async () => startLocalGateway(context).catch(() => { /* surfaced to user */ });
    if (cfg.autoDownloadBinary) {
      const binPath = cfg.binaryPath && cfg.binaryPath.trim().length > 0 ? cfg.binaryPath : getDefaultBinaryPath(context);
      try {
        await fs.promises.access(binPath, fs.constants.X_OK);
        await tryStart();
      } catch {
        await downloadOrUpdateBinary(context).catch(() => {/* handled */});
        await tryStart();
      }
    } else {
      await tryStart();
    }
  }

  context.subscriptions.push(...disposables);
}

export function deactivate() {
  if (child && !child.killed) child.kill();
}
