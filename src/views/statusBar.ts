import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getGatewayStatus, isGatewayRunning } from '../gateway/manager';

let statusBarItem: vscode.StatusBarItem | undefined;
let updateInterval: NodeJS.Timeout | undefined;

export function createStatusBar(context: vscode.ExtensionContext): void {
  const cfg = getConfig();
  if (!cfg.showStatusBar) return;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'tokligence.showStatus';
  context.subscriptions.push(statusBarItem);

  updateStatusBar();

  // Update every 5 seconds
  updateInterval = setInterval(updateStatusBar, 5000);
}

export async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) return;

  const cfg = getConfig();
  if (!cfg.showStatusBar) {
    statusBarItem.hide();
    return;
  }

  try {
    const status = await getGatewayStatus();

    if (status.running) {
      statusBarItem.text = `$(shield) TGW`;
      statusBarItem.backgroundColor = undefined;

      const tooltipLines = [
        `Tokligence Gateway: Running`,
        `Port: ${status.port}`,
        `Mode: ${status.workMode}`,
        `PII Firewall: ${status.piiEnabled ? status.piiMode : 'disabled'}`,
      ];

      if (status.providers.length > 0) {
        tooltipLines.push(`Providers: ${status.providers.join(', ')}`);
      }

      statusBarItem.tooltip = tooltipLines.join('\n');
    } else {
      statusBarItem.text = `$(shield) TGW`;
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.tooltip = 'Tokligence Gateway: Not running\nClick to start';
    }

    statusBarItem.show();
  } catch {
    statusBarItem.text = `$(shield) TGW`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = 'Tokligence Gateway: Error';
    statusBarItem.show();
  }
}

export function disposeStatusBar(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
