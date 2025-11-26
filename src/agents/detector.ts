import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from '../utils/config';

export interface CodingAgent {
  name: string;
  id: string;
  installed: boolean;
  configured: boolean;
  configPath: string;
  currentBaseUrl?: string;
}

// Agent configuration file locations
const AGENT_CONFIGS: Record<string, {
  name: string;
  configPaths: string[];
  getBaseUrl: (config: any) => string | undefined;
  setBaseUrl: (config: any, url: string) => any;
}> = {
  continue: {
    name: 'Continue',
    configPaths: [
      path.join(os.homedir(), '.continue', 'config.json'),
      path.join(os.homedir(), '.continue', 'config.yaml'),
    ],
    getBaseUrl: (config) => {
      if (config?.models?.[0]?.apiBase) return config.models[0].apiBase;
      return undefined;
    },
    setBaseUrl: (config, url) => {
      if (!config.models) config.models = [];
      if (config.models.length === 0) {
        config.models.push({
          title: 'Tokligence Gateway',
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiBase: url,
          apiKey: 'tokligence',
        });
      } else {
        config.models[0].apiBase = url;
      }
      return config;
    },
  },
  claudeCode: {
    name: 'Claude Code',
    configPaths: [
      path.join(os.homedir(), '.claude', 'settings.json'),
    ],
    getBaseUrl: (config) => {
      return config?.env?.ANTHROPIC_BASE_URL;
    },
    setBaseUrl: (config, url) => {
      if (!config.env) config.env = {};
      config.env.ANTHROPIC_BASE_URL = url;
      return config;
    },
  },
};

export async function detectInstalledAgents(): Promise<CodingAgent[]> {
  const agents: CodingAgent[] = [];
  const cfg = getConfig();
  const gatewayUrl = cfg.url;

  // Check Continue
  const continueConfig = AGENT_CONFIGS.continue;
  for (const configPath of continueConfig.configPaths) {
    try {
      await fs.promises.access(configPath);
      let config: any = {};
      const content = await fs.promises.readFile(configPath, 'utf-8');
      if (configPath.endsWith('.json')) {
        config = JSON.parse(content);
      } else {
        // Basic YAML parsing for apiBase
        const match = content.match(/apiBase:\s*["']?([^"'\n]+)/);
        if (match) config = { models: [{ apiBase: match[1] }] };
      }

      const currentBaseUrl = continueConfig.getBaseUrl(config);
      agents.push({
        name: 'Continue',
        id: 'continue',
        installed: true,
        configured: currentBaseUrl?.includes('localhost:8081') || currentBaseUrl === gatewayUrl,
        configPath,
        currentBaseUrl,
      });
      break;
    } catch {
      // Config not found
    }
  }

  // Check if Continue extension is installed (even without config)
  const continueExt = vscode.extensions.getExtension('continue.continue');
  if (continueExt && !agents.find(a => a.id === 'continue')) {
    agents.push({
      name: 'Continue',
      id: 'continue',
      installed: true,
      configured: false,
      configPath: continueConfig.configPaths[0],
    });
  }

  // Check Claude Code
  const claudeConfig = AGENT_CONFIGS.claudeCode;
  for (const configPath of claudeConfig.configPaths) {
    try {
      await fs.promises.access(configPath);
      const content = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      const currentBaseUrl = claudeConfig.getBaseUrl(config);

      agents.push({
        name: 'Claude Code',
        id: 'claudeCode',
        installed: true,
        configured: currentBaseUrl?.includes('localhost:8081') || currentBaseUrl === gatewayUrl,
        configPath,
        currentBaseUrl,
      });
      break;
    } catch {
      // Config not found
    }
  }

  // Check Cursor (VS Code based - check if running in Cursor)
  if (vscode.env.appName.toLowerCase().includes('cursor')) {
    agents.push({
      name: 'Cursor',
      id: 'cursor',
      installed: true,
      configured: false, // Cursor uses GUI settings
      configPath: 'Settings > Models > Override OpenAI Base URL',
    });
  }

  // Check Codeium
  const codeiumExt = vscode.extensions.getExtension('codeium.codeium');
  if (codeiumExt) {
    agents.push({
      name: 'Codeium',
      id: 'codeium',
      installed: true,
      configured: false, // Enterprise only
      configPath: 'Enterprise portal (custom endpoint requires Enterprise)',
    });
  }

  // Check GitHub Copilot
  const copilotExt = vscode.extensions.getExtension('github.copilot');
  if (copilotExt) {
    agents.push({
      name: 'GitHub Copilot',
      id: 'copilot',
      installed: true,
      configured: false, // Cannot be proxied without enterprise
      configPath: 'Not configurable (uses GitHub servers)',
    });
  }

  return agents;
}

export async function configureAgent(agent: CodingAgent): Promise<boolean> {
  const cfg = getConfig();
  const gatewayUrl = cfg.url;
  const agentConfig = AGENT_CONFIGS[agent.id];

  if (!agentConfig) {
    // Special handling for agents that can't be auto-configured
    if (agent.id === 'cursor') {
      const action = await vscode.window.showInformationMessage(
        `To configure Cursor:\n1. Open Cursor Settings\n2. Go to Models\n3. Enable "Override OpenAI Base URL"\n4. Enter: ${gatewayUrl}/v1`,
        'Copy URL', 'Open Guide'
      );
      if (action === 'Copy URL') {
        await vscode.env.clipboard.writeText(`${gatewayUrl}/v1`);
        vscode.window.showInformationMessage('URL copied to clipboard!');
      } else if (action === 'Open Guide') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/tokligence/tokligence-gateway/wiki/Cursor-Setup'));
      }
      return false;
    }

    vscode.window.showWarningMessage(`${agent.name} cannot be auto-configured. Manual setup required.`);
    return false;
  }

  try {
    // Read existing config or create new
    let config: any = {};
    const configPath = agent.configPath || agentConfig.configPaths[0];

    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // Create directory if needed
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    }

    // Update config with gateway URL
    const apiUrl = agent.id === 'claudeCode'
      ? gatewayUrl // Anthropic endpoint
      : `${gatewayUrl}/v1`; // OpenAI-compatible endpoint

    config = agentConfig.setBaseUrl(config, apiUrl);

    // Write config
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));

    vscode.window.showInformationMessage(`${agent.name} configured to use Tokligence Gateway!`);
    return true;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to configure ${agent.name}: ${err?.message || err}`);
    return false;
  }
}

export async function showDetectedAgents(): Promise<void> {
  const agents = await detectInstalledAgents();

  if (agents.length === 0) {
    vscode.window.showInformationMessage(
      'No coding agents detected. Install Continue, Claude Code, or Cursor to get started.'
    );
    return;
  }

  const items = agents.map(agent => ({
    label: `${agent.configured ? '$(check)' : '$(circle-outline)'} ${agent.name}`,
    description: agent.configured ? 'Using Gateway' : 'Not configured',
    detail: agent.configPath,
    agent,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an agent to configure',
    title: 'Detected Coding Agents',
  });

  if (selected) {
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(gear) Configure', description: 'Set up to use Tokligence Gateway' },
        { label: '$(link-external) Open Config', description: 'Open configuration file' },
      ],
      { placeHolder: `What would you like to do with ${selected.agent.name}?` }
    );

    if (action?.label.includes('Configure')) {
      await configureAgent(selected.agent);
    } else if (action?.label.includes('Open Config')) {
      if (selected.agent.configPath.includes('Settings')) {
        vscode.window.showInformationMessage(selected.agent.configPath);
      } else {
        try {
          const doc = await vscode.workspace.openTextDocument(selected.agent.configPath);
          await vscode.window.showTextDocument(doc);
        } catch {
          vscode.window.showWarningMessage(`Config file not found: ${selected.agent.configPath}`);
        }
      }
    }
  }
}

export async function autoConfigureAllAgents(): Promise<void> {
  const agents = await detectInstalledAgents();
  const unconfigured = agents.filter(a => !a.configured && AGENT_CONFIGS[a.id]);

  if (unconfigured.length === 0) {
    vscode.window.showInformationMessage('All configurable agents are already set up!');
    return;
  }

  const result = await vscode.window.showInformationMessage(
    `Found ${unconfigured.length} agent(s) to configure: ${unconfigured.map(a => a.name).join(', ')}`,
    'Configure All', 'Cancel'
  );

  if (result === 'Configure All') {
    let success = 0;
    for (const agent of unconfigured) {
      if (await configureAgent(agent)) {
        success++;
      }
    }
    vscode.window.showInformationMessage(`Configured ${success}/${unconfigured.length} agents.`);
  }
}
