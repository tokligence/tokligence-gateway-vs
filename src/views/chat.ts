import * as vscode from 'vscode';
import axios from 'axios';
import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';
import { getConfig } from '../utils/config';

export async function openChat(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'tokligenceChat',
    'Tokligence Chat',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getChatHtml(panel.webview);

  const history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  const cfg = getConfig();
  history.push({ role: 'system', content: cfg.systemPrompt });

  let currentController: AbortController | undefined;

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === 'send') {
      const text: string = message.text ?? '';
      if (!text.trim()) return;

      try {
        const cfg = getConfig();
        const url = new URL('/v1/chat/completions', cfg.url).toString();
        history.push({ role: 'user', content: text });

        const payload = {
          model: cfg.model,
          messages: history,
          stream: cfg.useStreaming,
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const apiKey = await context.secrets.get('tokligence.apiKey');
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        if (cfg.useStreaming) {
          if (currentController) {
            try { currentController.abort(); } catch {}
          }
          const controller = new AbortController();
          currentController = controller;

          let acc = '';
          await streamChat(url, headers, payload, (delta) => {
            acc += delta;
            panel.webview.postMessage({ type: 'delta', text: delta });
          }, cfg.requestTimeoutMs, controller);

          history.push({ role: 'assistant', content: acc });
          panel.webview.postMessage({ type: 'done' });
        } else {
          const res = await axios.post(url, payload, {
            headers,
            timeout: cfg.requestTimeoutMs
          });

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
    } else if (message?.type === 'cancel') {
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

async function streamChat(
  url: string,
  headers: Record<string, string>,
  payload: any,
  onDelta: (delta: string) => void,
  timeoutMs: number,
  controller?: AbortController
): Promise<void> {
  const ctrl = controller ?? new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const h = { ...headers, Accept: 'text/event-stream' };
    const res = await fetch(url, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

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

function getChatHtml(webview: vscode.Webview): string {
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
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-editorGroup-border);
      --user-color: var(--vscode-textLink-foreground);
      --ai-color: var(--vscode-editor-foreground);
      --input-bg: var(--vscode-input-background);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
    }
    body { font-family: var(--vscode-font-family); margin: 0; background: var(--bg); color: var(--fg); }
    .container { display: flex; flex-direction: column; height: 100vh; }
    .header { padding: 8px 12px; border-bottom: 1px solid var(--border); font-weight: bold; display: flex; align-items: center; gap: 8px; }
    .header .shield { color: var(--vscode-charts-green); }
    .messages { flex: 1; overflow-y: auto; padding: 12px; }
    .msg { margin-bottom: 12px; line-height: 1.5; }
    .msg-user { color: var(--user-color); }
    .msg-user::before { content: '👤 You: '; font-weight: bold; }
    .msg-ai { color: var(--ai-color); white-space: pre-wrap; }
    .msg-ai::before { content: '🤖 AI: '; font-weight: bold; }
    .msg-error { color: var(--vscode-errorForeground); }
    .input-area { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border); align-items: flex-end; }
    textarea { flex: 1; resize: vertical; min-height: 60px; padding: 8px; border: 1px solid var(--border); background: var(--input-bg); color: var(--fg); border-radius: 4px; font-family: inherit; }
    .buttons { display: flex; flex-direction: column; gap: 4px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background: var(--button-bg); color: var(--button-fg); }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-stop { background: var(--vscode-inputValidation-errorBackground); }
    .btn-clear { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="shield">⛨</span>
      <span>Tokligence Gateway Chat</span>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area">
      <textarea id="input" placeholder="Ask anything... (PII protection active)"></textarea>
      <div class="buttons">
        <button id="send">Send</button>
        <button id="stop" class="btn-stop" disabled>Stop</button>
        <button id="clear" class="btn-clear">Clear</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const stopBtn = document.getElementById('stop');
    const clearBtn = document.getElementById('clear');
    let lastAi;

    function setBusy(busy) {
      sendBtn.disabled = busy;
      stopBtn.disabled = !busy;
      input.disabled = busy;
    }

    function appendMsg(role, text) {
      const div = document.createElement('div');
      div.className = 'msg msg-' + role;
      div.textContent = text;
      messages.appendChild(div);
      if (role === 'ai') lastAi = div;
      messages.scrollTop = messages.scrollHeight;
    }

    sendBtn.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      appendMsg('user', text);
      vscode.postMessage({ type: 'send', text });
      input.value = '';
      setBusy(true);
    };

    stopBtn.onclick = () => {
      vscode.postMessage({ type: 'cancel' });
      setBusy(false);
    };

    clearBtn.onclick = () => {
      messages.innerHTML = '';
      lastAi = null;
      vscode.postMessage({ type: 'clear' });
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    };

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'resp') {
        appendMsg('ai', msg.text);
        setBusy(false);
      } else if (msg.type === 'delta') {
        if (!lastAi) {
          appendMsg('ai', msg.text);
        } else {
          lastAi.textContent += msg.text;
          messages.scrollTop = messages.scrollHeight;
        }
      } else if (msg.type === 'done') {
        setBusy(false);
      } else if (msg.type === 'error') {
        const div = document.createElement('div');
        div.className = 'msg msg-error';
        div.textContent = 'Error: ' + msg.text;
        messages.appendChild(div);
        setBusy(false);
      }
    });
  </script>
</body>
</html>`;
}
