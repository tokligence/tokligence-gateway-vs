import * as vscode from 'vscode';
import { getConfig, updateConfig } from './utils/config';
import {
  startGateway,
  stopGateway,
  downloadBinary,
  testConnection,
  getGatewayStatus,
  disposeGateway,
  getOutputChannel
} from './gateway/manager';
import {
  detectInstalledAgents,
  configureAgent,
  showDetectedAgents,
  autoConfigureAllAgents
} from './agents/detector';
import { createStatusBar, updateStatusBar, disposeStatusBar } from './views/statusBar';
import { registerTreeViews } from './views/treeViews';
import { openChat } from './views/chat';

let statusProvider: any;
let providersProvider: any;
let agentsProvider: any;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = getOutputChannel();
  output.appendLine('Tokligence Gateway extension activating...');

  // Register tree views
  const views = registerTreeViews(context);
  statusProvider = views.statusProvider;
  providersProvider = views.providersProvider;
  agentsProvider = views.agentsProvider;

  // Create status bar
  createStatusBar(context);

  // Register commands
  const commands: Array<[string, (...args: any[]) => any]> = [
    // Gateway management
    ['tokligence.startLocalGateway', () => startGateway(context).then(() => refreshViews())],
    ['tokligence.stopLocalGateway', () => stopGateway().then(() => refreshViews())],
    ['tokligence.downloadBinary', () => downloadBinary(context)],
    ['tokligence.testConnection', () => testConnection(context)],

    // Chat
    ['tokligence.openChat', () => openChat(context)],

    // Model selection
    ['tokligence.selectModel', () => selectModel(context)],

    // Agent management
    ['tokligence.detectAgents', () => showDetectedAgents().then(() => agentsProvider?.refresh())],
    ['tokligence.configureAgents', (agent) => {
      if (agent) {
        configureAgent(agent).then(() => agentsProvider?.refresh());
      } else {
        showDetectedAgents().then(() => agentsProvider?.refresh());
      }
    }],

    // Provider configuration
    ['tokligence.configureProviders', (provider) => configureProviders(context, provider)],

    // Work mode
    ['tokligence.setWorkMode', () => setWorkMode()],

    // PII Firewall
    ['tokligence.togglePiiFirewall', () => togglePiiFirewall()],

    // Status
    ['tokligence.showStatus', () => showGatewayStatus()],

    // Dashboard
    ['tokligence.openDashboard', () => openDashboard()],

    // Usage
    ['tokligence.viewUsage', () => viewUsage(context)],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // Auto-start gateway if configured
  const cfg = getConfig();
  if (cfg.startOnActivation) {
    output.appendLine('Auto-starting gateway...');
    await startGateway(context);
  }

  // Auto-configure agents if enabled
  if (cfg.autoConfigureAgents) {
    output.appendLine('Auto-configuring coding agents...');
    await autoConfigureAllAgents();
  }

  output.appendLine('Tokligence Gateway extension activated!');
}

export function deactivate(): void {
  disposeGateway();
  disposeStatusBar();
}

function refreshViews(): void {
  statusProvider?.refresh();
  providersProvider?.refresh();
  agentsProvider?.refresh();
  updateStatusBar();
}

async function selectModel(context: vscode.ExtensionContext): Promise<void> {
  const cfg = getConfig();

  try {
    // Try to fetch models from gateway
    const url = new URL('/v1/models', cfg.url).toString();
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json() as any;

    let models: string[] = [];
    if (Array.isArray(data?.data)) {
      models = data.data.map((m: any) => m?.id).filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      models = data.models.map((m: any) => m?.id ?? m).filter(Boolean);
    }

    if (models.length > 0) {
      const pick = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select a model',
        title: 'Available Models'
      });
      if (pick) {
        await updateConfig('model', pick);
        vscode.window.showInformationMessage(`Model set to: ${pick}`);
      }
      return;
    }
  } catch {
    // Gateway not available, show manual input
  }

  // Fallback: manual input with suggestions
  const suggestions = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4-turbo',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
    'gemini-2.0-flash',
    'gemini-pro',
  ];

  const pick = await vscode.window.showQuickPick(
    [...suggestions, '$(edit) Enter custom model...'],
    { placeHolder: 'Select or enter a model name' }
  );

  if (pick?.includes('Enter custom')) {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter model name',
      value: cfg.model
    });
    if (input) {
      await updateConfig('model', input);
      vscode.window.showInformationMessage(`Model set to: ${input}`);
    }
  } else if (pick) {
    await updateConfig('model', pick);
    vscode.window.showInformationMessage(`Model set to: ${pick}`);
  }
}

async function configureProviders(context: vscode.ExtensionContext, provider?: string): Promise<void> {
  const providers = [
    { label: '$(key) OpenAI', id: 'openai', keyName: 'openaiApiKey', placeholder: 'sk-...' },
    { label: '$(key) Anthropic', id: 'anthropic', keyName: 'anthropicApiKey', placeholder: 'sk-ant-...' },
    { label: '$(key) Google Gemini', id: 'gemini', keyName: 'geminiApiKey', placeholder: 'AIza...' },
  ];

  let selected: typeof providers[0] | undefined;

  if (provider) {
    selected = providers.find(p => p.id === provider.toLowerCase());
  }

  if (!selected) {
    const pick = await vscode.window.showQuickPick(providers, {
      placeHolder: 'Select a provider to configure'
    });
    selected = pick;
  }

  if (!selected) return;

  const key = await vscode.window.showInputBox({
    prompt: `Enter ${selected.label.replace('$(key) ', '')} API Key`,
    placeHolder: selected.placeholder,
    password: true,
    ignoreFocusOut: true
  });

  if (key) {
    await updateConfig(selected.keyName, key);
    vscode.window.showInformationMessage(`${selected.label.replace('$(key) ', '')} API key saved!`);
    providersProvider?.refresh();
    statusProvider?.refresh();
  }
}

async function setWorkMode(): Promise<void> {
  const modes = [
    {
      label: '$(symbol-event) Auto',
      description: 'Smart routing - automatically choose passthrough or translation',
      value: 'auto'
    },
    {
      label: '$(arrow-right) Passthrough',
      description: 'Only direct proxy to upstream providers',
      value: 'passthrough'
    },
    {
      label: '$(arrow-swap) Translation',
      description: 'Only protocol translation (OpenAI↔Anthropic↔Gemini)',
      value: 'translation'
    },
  ];

  const pick = await vscode.window.showQuickPick(modes, {
    placeHolder: 'Select work mode',
    title: 'Gateway Work Mode'
  });

  if (pick) {
    await updateConfig('workMode', pick.value);
    vscode.window.showInformationMessage(`Work mode set to: ${pick.value}`);
    statusProvider?.refresh();

    // Restart gateway if running
    const { running } = await getGatewayStatus();
    if (running) {
      const restart = await vscode.window.showInformationMessage(
        'Restart gateway to apply changes?',
        'Restart', 'Later'
      );
      if (restart === 'Restart') {
        await stopGateway();
        // Small delay before restart
        await new Promise(r => setTimeout(r, 1000));
        await vscode.commands.executeCommand('tokligence.startLocalGateway');
      }
    }
  }
}

async function togglePiiFirewall(): Promise<void> {
  const cfg = getConfig();
  const currentEnabled = cfg.piiFirewallEnabled;

  if (currentEnabled) {
    // Show mode options or disable
    const options = [
      { label: '$(shield) Monitor', description: 'Log PII but allow through', value: 'monitor' },
      { label: '$(edit) Redact', description: 'Mask/redact PII automatically', value: 'redact' },
      { label: '$(error) Enforce', description: 'Block requests with PII', value: 'enforce' },
      { label: '$(x) Disable', description: 'Turn off PII firewall', value: 'disable' },
    ];

    const pick = await vscode.window.showQuickPick(options, {
      placeHolder: 'PII Firewall Mode',
      title: `Current: ${cfg.piiFirewallMode}`
    });

    if (pick) {
      if (pick.value === 'disable') {
        await updateConfig('piiFirewallEnabled', false);
        vscode.window.showInformationMessage('PII Firewall disabled');
      } else {
        await updateConfig('piiFirewallMode', pick.value);
        vscode.window.showInformationMessage(`PII Firewall mode: ${pick.value}`);
      }
    }
  } else {
    // Enable with default mode
    await updateConfig('piiFirewallEnabled', true);
    vscode.window.showInformationMessage('PII Firewall enabled (mode: redact)');
  }

  statusProvider?.refresh();
}

async function showGatewayStatus(): Promise<void> {
  const status = await getGatewayStatus();
  const cfg = getConfig();

  const lines = [
    `**Tokligence Gateway Status**`,
    ``,
    `🔌 Status: ${status.running ? '✅ Running' : '❌ Stopped'}`,
    `🌐 Port: ${status.port}`,
    `🔀 Work Mode: ${status.workMode}`,
    `🛡️ PII Firewall: ${status.piiEnabled ? status.piiMode : 'Disabled'}`,
    ``,
    `**Configured Providers:**`,
    status.providers.length > 0 ? status.providers.map(p => `  • ${p}`).join('\n') : '  None',
    ``,
    `**Model Routes:**`,
    `  ${cfg.modelRoutes}`,
  ];

  const action = await vscode.window.showInformationMessage(
    lines.join('\n'),
    { modal: true },
    status.running ? 'Stop Gateway' : 'Start Gateway',
    'Open Output'
  );

  if (action === 'Start Gateway') {
    await vscode.commands.executeCommand('tokligence.startLocalGateway');
  } else if (action === 'Stop Gateway') {
    await vscode.commands.executeCommand('tokligence.stopLocalGateway');
  } else if (action === 'Open Output') {
    getOutputChannel().show();
  }
}

async function openDashboard(): Promise<void> {
  const cfg = getConfig();
  const dashboardUrl = `${cfg.url}/dashboard`;

  try {
    await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
  } catch {
    vscode.window.showWarningMessage(
      'Dashboard not available. Make sure gateway is running with admin endpoints enabled.'
    );
  }
}

async function viewUsage(context: vscode.ExtensionContext): Promise<void> {
  const cfg = getConfig();

  try {
    const url = new URL('/api/v1/admin/usage', cfg.url).toString();
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as any;

    const lines = [
      `**Token Usage Summary**`,
      ``,
      `📊 Total Consumed: ${data.total_consumed_tokens?.toLocaleString() || 0} tokens`,
      ``,
      `**By Model:**`,
    ];

    if (data.by_model) {
      for (const [model, tokens] of Object.entries(data.by_model)) {
        lines.push(`  • ${model}: ${(tokens as number).toLocaleString()}`);
      }
    } else {
      lines.push(`  No usage data yet`);
    }

    vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  } catch (err: any) {
    vscode.window.showWarningMessage(
      `Could not fetch usage data: ${err?.message || err}\n\nMake sure gateway is running with admin API enabled.`
    );
  }
}
