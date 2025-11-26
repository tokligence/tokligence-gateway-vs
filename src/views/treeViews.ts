import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getGatewayStatus } from '../gateway/manager';
import { detectInstalledAgents, CodingAgent } from '../agents/detector';

// Status Tree View
export class StatusTreeProvider implements vscode.TreeDataProvider<StatusItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StatusItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StatusItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<StatusItem[]> {
    const status = await getGatewayStatus();
    const cfg = getConfig();
    const items: StatusItem[] = [];

    // Gateway status
    items.push(new StatusItem(
      'Gateway',
      status.running ? 'Running' : 'Stopped',
      status.running ? 'debug-start' : 'debug-stop',
      status.running ? 'tokligence.stopLocalGateway' : 'tokligence.startLocalGateway'
    ));

    // Port
    items.push(new StatusItem('Port', String(status.port), 'server-environment'));

    // Work Mode
    items.push(new StatusItem(
      'Work Mode',
      status.workMode,
      'symbol-enum',
      'tokligence.setWorkMode'
    ));

    // PII Firewall
    items.push(new StatusItem(
      'PII Firewall',
      status.piiEnabled ? status.piiMode : 'Disabled',
      status.piiEnabled ? 'shield' : 'shield-x',
      'tokligence.togglePiiFirewall'
    ));

    // Providers
    if (status.providers.length > 0) {
      items.push(new StatusItem(
        'Providers',
        status.providers.join(', '),
        'key'
      ));
    } else {
      items.push(new StatusItem(
        'Providers',
        'None configured',
        'warning',
        'tokligence.configureProviders'
      ));
    }

    return items;
  }
}

class StatusItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly value: string,
    public readonly iconId: string,
    public readonly commandId?: string
  ) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.description = value;
    this.tooltip = `${label}: ${value}`;
    if (commandId) {
      this.command = { command: commandId, title: label };
    }
  }
}

// Providers Tree View
export class ProvidersTreeProvider implements vscode.TreeDataProvider<ProviderItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProviderItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProviderItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ProviderItem[]> {
    const cfg = getConfig();
    return [
      new ProviderItem('OpenAI', !!cfg.openaiApiKey, 'gpt-4, gpt-4o, o1'),
      new ProviderItem('Anthropic', !!cfg.anthropicApiKey, 'claude-3.5-sonnet, claude-3-opus'),
      new ProviderItem('Gemini', !!cfg.geminiApiKey, 'gemini-2.0-flash, gemini-pro'),
    ];
  }
}

class ProviderItem extends vscode.TreeItem {
  constructor(
    public readonly provider: string,
    public readonly configured: boolean,
    public readonly models: string
  ) {
    super(provider, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(configured ? 'check' : 'circle-outline');
    this.description = configured ? 'Configured' : 'Not configured';
    this.tooltip = `${provider}\nModels: ${models}\nStatus: ${configured ? 'API key set' : 'No API key'}`;
    this.command = {
      command: 'tokligence.configureProviders',
      title: 'Configure',
      arguments: [provider]
    };
  }
}

// Agents Tree View
export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AgentItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AgentItem[]> {
    const agents = await detectInstalledAgents();
    return agents.map(agent => new AgentItem(agent));
  }
}

class AgentItem extends vscode.TreeItem {
  constructor(public readonly agent: CodingAgent) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(
      agent.configured ? 'check' : agent.installed ? 'circle-outline' : 'warning'
    );
    this.description = agent.configured ? 'Using Gateway' : 'Not configured';
    this.tooltip = [
      agent.name,
      `Status: ${agent.configured ? 'Configured' : 'Not configured'}`,
      `Config: ${agent.configPath}`,
      agent.currentBaseUrl ? `Current URL: ${agent.currentBaseUrl}` : ''
    ].filter(Boolean).join('\n');
    this.command = {
      command: 'tokligence.configureAgents',
      title: 'Configure',
      arguments: [agent]
    };
  }
}

// Register all tree views
export function registerTreeViews(context: vscode.ExtensionContext): {
  statusProvider: StatusTreeProvider;
  providersProvider: ProvidersTreeProvider;
  agentsProvider: AgentsTreeProvider;
} {
  const statusProvider = new StatusTreeProvider();
  const providersProvider = new ProvidersTreeProvider();
  const agentsProvider = new AgentsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('tokligence.status', statusProvider),
    vscode.window.registerTreeDataProvider('tokligence.providers', providersProvider),
    vscode.window.registerTreeDataProvider('tokligence.agents', agentsProvider)
  );

  return { statusProvider, providersProvider, agentsProvider };
}
