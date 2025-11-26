import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export interface GatewayConfig {
  url: string;
  startOnActivation: boolean;
  autoDownloadBinary: boolean;
  version: string;
  workMode: 'auto' | 'passthrough' | 'translation';
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  modelRoutes: string;
  piiFirewallEnabled: boolean;
  piiFirewallMode: 'monitor' | 'redact' | 'enforce';
  autoConfigureAgents: boolean;
  model: string;
  systemPrompt: string;
  useStreaming: boolean;
  requestTimeoutMs: number;
  binaryPath: string;
  multiportMode: boolean;
  facadePort: number;
  openaiPort: number;
  anthropicPort: number;
  geminiPort: number;
  showStatusBar: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function getConfig(): GatewayConfig {
  const cfg = vscode.workspace.getConfiguration('tokligence-gateway');
  return {
    url: cfg.get<string>('url', 'http://localhost:8081'),
    startOnActivation: cfg.get<boolean>('startOnActivation', true),
    autoDownloadBinary: cfg.get<boolean>('autoDownloadBinary', true),
    version: cfg.get<string>('version', 'v0.4.0'),
    workMode: cfg.get<'auto' | 'passthrough' | 'translation'>('workMode', 'auto'),
    openaiApiKey: cfg.get<string>('openaiApiKey', ''),
    anthropicApiKey: cfg.get<string>('anthropicApiKey', ''),
    geminiApiKey: cfg.get<string>('geminiApiKey', ''),
    modelRoutes: cfg.get<string>('modelRoutes', 'claude*=>anthropic,gpt-*=>openai,o*=>openai,gemini-*=>gemini'),
    piiFirewallEnabled: cfg.get<boolean>('piiFirewallEnabled', true),
    piiFirewallMode: cfg.get<'monitor' | 'redact' | 'enforce'>('piiFirewallMode', 'redact'),
    autoConfigureAgents: cfg.get<boolean>('autoConfigureAgents', false),
    model: cfg.get<string>('model', 'gpt-4o-mini'),
    systemPrompt: cfg.get<string>('systemPrompt', 'You are a helpful coding assistant.'),
    useStreaming: cfg.get<boolean>('useStreaming', true),
    requestTimeoutMs: cfg.get<number>('requestTimeoutMs', 120000),
    binaryPath: cfg.get<string>('binaryPath', ''),
    multiportMode: cfg.get<boolean>('multiportMode', false),
    facadePort: cfg.get<number>('facadePort', 8081),
    openaiPort: cfg.get<number>('openaiPort', 8082),
    anthropicPort: cfg.get<number>('anthropicPort', 8083),
    geminiPort: cfg.get<number>('geminiPort', 8084),
    showStatusBar: cfg.get<boolean>('showStatusBar', true),
    logLevel: cfg.get<'debug' | 'info' | 'warn' | 'error'>('logLevel', 'info'),
  };
}

export async function updateConfig(key: string, value: any, global = true): Promise<void> {
  const target = global ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
  await vscode.workspace.getConfiguration('tokligence-gateway').update(key, value, target);
}

export function getDefaultBinaryPath(context: vscode.ExtensionContext): string {
  const binName = process.platform === 'win32' ? 'tokligence-gateway.exe' : 'tokligence-gateway';
  return path.join(context.globalStorageUri.fsPath, 'bin', binName);
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.tokligence');
}

export function platformLabels(): { osLabel: string; archLabels: string[] } {
  const p = process.platform;
  const a = process.arch;
  const osLabel = p === 'win32' ? 'windows' : p === 'darwin' ? 'darwin' : 'linux';
  const archLabels = a === 'x64' ? ['amd64', 'x86_64', 'x64'] : a === 'arm64' ? ['arm64', 'aarch64'] : [a];
  return { osLabel, archLabels };
}
