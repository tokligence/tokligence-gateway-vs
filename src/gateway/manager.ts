import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as stream from 'stream';
import { promisify } from 'util';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import axios from 'axios';
import { getConfig, getDefaultBinaryPath, platformLabels, getConfigDir } from '../utils/config';

const pipeline = promisify(stream.pipeline);

let gatewayProcess: cp.ChildProcess | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Tokligence Gateway');
  }
  return outputChannel;
}

export function isGatewayRunning(): boolean {
  return gatewayProcess !== undefined && !gatewayProcess.killed;
}

export async function startGateway(context: vscode.ExtensionContext): Promise<boolean> {
  if (isGatewayRunning()) {
    vscode.window.showInformationMessage('Tokligence Gateway is already running.');
    return true;
  }

  const consentKey = 'tokligence.binaryStartConsent';
  const consent = context.globalState.get<boolean>(consentKey);
  if (!consent) {
    const pick = await vscode.window.showInformationMessage(
      'Start the local Tokligence Gateway? This runs a local process on your machine for PII filtering and API translation.',
      { modal: true },
      'Allow once', 'Always allow', 'Cancel'
    );
    if (pick === 'Cancel' || !pick) return false;
    if (pick === 'Always allow') await context.globalState.update(consentKey, true);
  }

  const cfg = getConfig();
  let binPath = cfg.binaryPath && cfg.binaryPath.trim().length > 0
    ? cfg.binaryPath
    : getDefaultBinaryPath(context);

  // Check if binary exists
  try {
    await fs.promises.access(binPath, fs.constants.X_OK);
  } catch {
    if (cfg.autoDownloadBinary) {
      const ok = await downloadBinary(context);
      if (!ok) return false;
      binPath = cfg.binaryPath && cfg.binaryPath.trim().length > 0
        ? cfg.binaryPath
        : getDefaultBinaryPath(context);
    } else {
      vscode.window.showErrorMessage(`Gateway binary not found: ${binPath}. Run 'Tokligence: Download Gateway' first.`);
      return false;
    }
  }

  // Build environment variables for gateway
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Set API keys if configured
  if (cfg.openaiApiKey) env.TOKLIGENCE_OPENAI_API_KEY = cfg.openaiApiKey;
  if (cfg.anthropicApiKey) env.TOKLIGENCE_ANTHROPIC_API_KEY = cfg.anthropicApiKey;
  if (cfg.geminiApiKey) env.TOKLIGENCE_GEMINI_API_KEY = cfg.geminiApiKey;

  // Set work mode
  env.TOKLIGENCE_WORK_MODE = cfg.workMode;

  // Set ports
  env.TOKLIGENCE_FACADE_PORT = String(cfg.facadePort);
  if (cfg.multiportMode) {
    env.TOKLIGENCE_MULTIPORT_MODE = 'true';
    env.TOKLIGENCE_OPENAI_PORT = String(cfg.openaiPort);
    env.TOKLIGENCE_ANTHROPIC_PORT = String(cfg.anthropicPort);
    env.TOKLIGENCE_GEMINI_PORT = String(cfg.geminiPort);
  }

  // Set PII firewall
  env.TOKLIGENCE_PROMPT_FIREWALL_ENABLED = cfg.piiFirewallEnabled ? 'true' : 'false';
  env.TOKLIGENCE_PROMPT_FIREWALL_MODE = cfg.piiFirewallMode;

  // Set model routes
  if (cfg.modelRoutes) {
    env.TOKLIGENCE_MODEL_PROVIDER_ROUTES = cfg.modelRoutes;
  }

  // Set log level
  env.TOKLIGENCE_LOG_LEVEL = cfg.logLevel;

  // Disable auth for local development
  env.TOKLIGENCE_AUTH_DISABLED = 'true';

  const binDir = path.dirname(binPath);
  await fs.promises.mkdir(binDir, { recursive: true });

  const output = getOutputChannel();
  output.appendLine(`Starting Tokligence Gateway: ${binPath}`);
  output.appendLine(`Work mode: ${cfg.workMode}`);
  output.appendLine(`PII Firewall: ${cfg.piiFirewallEnabled ? cfg.piiFirewallMode : 'disabled'}`);
  output.appendLine(`Port: ${cfg.facadePort}`);

  gatewayProcess = cp.spawn(binPath, [], {
    cwd: binDir,
    env,
    detached: false
  });

  gatewayProcess.stdout?.on('data', (d) => output.append(d.toString()));
  gatewayProcess.stderr?.on('data', (d) => output.append(d.toString()));
  gatewayProcess.on('exit', (code) => {
    output.appendLine(`Gateway exited with code ${code}`);
    gatewayProcess = undefined;
  });
  gatewayProcess.on('error', (err) => {
    output.appendLine(`Gateway error: ${err.message}`);
    gatewayProcess = undefined;
  });

  // Wait a bit for startup
  await new Promise(resolve => setTimeout(resolve, 1500));

  if (isGatewayRunning()) {
    vscode.window.showInformationMessage(`Tokligence Gateway started on port ${cfg.facadePort}`);
    return true;
  } else {
    vscode.window.showErrorMessage('Gateway failed to start. Check Output panel for details.');
    output.show();
    return false;
  }
}

export async function stopGateway(): Promise<void> {
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill();
    gatewayProcess = undefined;
    vscode.window.showInformationMessage('Tokligence Gateway stopped.');
  } else {
    vscode.window.showInformationMessage('Gateway is not running.');
  }
}

export async function downloadBinary(context: vscode.ExtensionContext): Promise<boolean> {
  const consentKey = 'tokligence.binaryDownloadConsent';
  const consent = context.globalState.get<boolean>(consentKey);
  if (!consent) {
    const pick = await vscode.window.showInformationMessage(
      'Download Tokligence Gateway binary from GitHub Releases?',
      { modal: true },
      'Allow once', 'Always allow', 'Cancel'
    );
    if (pick === 'Cancel' || !pick) return false;
    if (pick === 'Always allow') await context.globalState.update(consentKey, true);
  }

  const cfg = getConfig();
  const version = cfg.version || 'v0.4.0';
  const storageBin = path.dirname(getDefaultBinaryPath(context));
  await fs.promises.mkdir(storageBin, { recursive: true });
  const binName = process.platform === 'win32' ? 'tokligence-gateway.exe' : 'tokligence-gateway';
  const targetBin = path.join(storageBin, binName);

  return await vscode.window.withProgress<boolean>(
    { location: vscode.ProgressLocation.Notification, title: 'Downloading Tokligence Gateway' },
    async (progress) => {
      try {
        progress.report({ message: 'Fetching release info...' });
        const api = `https://api.github.com/repos/tokligence/tokligence-gateway/releases/tags/${encodeURIComponent(version)}`;
        const resp = await axios.get(api, {
          headers: { 'User-Agent': 'Tokligence-VS', 'Accept': 'application/vnd.github+json' },
          timeout: 20000,
        });

        const assets: any[] = resp?.data?.assets || [];
        if (!assets.length) {
          throw new Error('No assets found in release.');
        }

        const { osLabel, archLabels } = platformLabels();
        const candidates = assets.filter((a: any) => {
          const name: string = a?.name || '';
          if (!name.toLowerCase().includes(osLabel)) return false;
          return archLabels.some(al => name.toLowerCase().includes(al));
        });

        if (!candidates.length) {
          const names = assets.map((a: any) => a?.name).filter(Boolean).join(', ');
          throw new Error(`No matching asset for ${osLabel}/${process.arch}. Found: ${names}`);
        }

        // Prefer .tar.gz, then .zip, then raw binary
        const preferred = candidates.sort((a: any, b: any) => {
          const an = String(a.name).toLowerCase();
          const bn = String(b.name).toLowerCase();
          const ascore = an.endsWith('.tar.gz') ? 0 : an.endsWith('.zip') ? 1 : 2;
          const bscore = bn.endsWith('.tar.gz') ? 0 : bn.endsWith('.zip') ? 1 : 2;
          return ascore - bscore;
        })[0];

        const url = preferred.browser_download_url as string;
        const tmpFile = path.join(os.tmpdir(), `tokligence-${Date.now()}-${path.basename(url)}`);

        progress.report({ message: `Downloading ${path.basename(url)}...` });
        const dl = await axios.get(url, {
          responseType: 'stream',
          timeout: 300000,
          headers: { 'User-Agent': 'Tokligence-VS' }
        });
        await pipeline(dl.data, fs.createWriteStream(tmpFile));

        progress.report({ message: 'Extracting...' });
        const lower = url.toLowerCase();
        if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
          await tar.x({ file: tmpFile, cwd: storageBin });
        } else if (lower.endsWith('.zip')) {
          const zip = new AdmZip(tmpFile);
          zip.extractAllTo(storageBin, true);
        } else {
          await fs.promises.copyFile(tmpFile, targetBin);
        }

        // Find the binary
        let finalBin = targetBin;
        try {
          await fs.promises.access(finalBin);
        } catch {
          const files = await fs.promises.readdir(storageBin);
          const cand = files.find(f => f.startsWith('tokligence-gateway'));
          if (!cand) throw new Error('Binary not found after extraction.');
          finalBin = path.join(storageBin, cand);
        }

        // Make executable
        try {
          await fs.promises.chmod(finalBin, 0o755);
        } catch {}

        // Cleanup temp file
        try {
          await fs.promises.unlink(tmpFile);
        } catch {}

        progress.report({ message: 'Done!' });
        vscode.window.showInformationMessage(`Gateway ${version} downloaded successfully.`);
        return true;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Download failed: ${err?.message || err}`);
        return false;
      }
    }
  );
}

export async function testConnection(context: vscode.ExtensionContext): Promise<boolean> {
  const cfg = getConfig();
  const healthUrl = new URL('/health', cfg.url).toString();

  try {
    const res = await axios.get(healthUrl, { timeout: 5000, validateStatus: () => true });
    if (res.status >= 200 && res.status < 300) {
      const data = res.data || {};
      vscode.window.showInformationMessage(
        `Gateway OK: ${data.status || 'healthy'}` +
        (data.pii_firewall_enabled ? ` | PII: ${data.pii_firewall_mode || 'enabled'}` : '')
      );
      return true;
    } else {
      vscode.window.showWarningMessage(`Gateway responded: ${res.status}`);
      return false;
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Gateway not reachable: ${err?.message || err}`);
    return false;
  }
}

export async function getGatewayStatus(): Promise<{
  running: boolean;
  port: number;
  workMode: string;
  piiEnabled: boolean;
  piiMode: string;
  providers: string[];
}> {
  const cfg = getConfig();
  const status = {
    running: false,
    port: cfg.facadePort,
    workMode: cfg.workMode,
    piiEnabled: cfg.piiFirewallEnabled,
    piiMode: cfg.piiFirewallMode,
    providers: [] as string[],
  };

  // Check which providers are configured
  if (cfg.openaiApiKey) status.providers.push('OpenAI');
  if (cfg.anthropicApiKey) status.providers.push('Anthropic');
  if (cfg.geminiApiKey) status.providers.push('Gemini');

  // Check if gateway is reachable
  try {
    const res = await axios.get(new URL('/health', cfg.url).toString(), { timeout: 2000 });
    status.running = res.status >= 200 && res.status < 300;
  } catch {
    status.running = isGatewayRunning();
  }

  return status;
}

export function disposeGateway(): void {
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill();
  }
}
