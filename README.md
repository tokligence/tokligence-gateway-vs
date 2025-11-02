# Tokligence Gateway VS Code Extension

This repository contains a VS Code extension that integrates with the Tokligence Gateway (a Go-based LLM gateway). It provides a simple chat panel, connection testing, and optional management of a local gateway binary.

Getting started
- Ensure Node.js 18+ and npm are installed.
- Run `npm install`.
- Build with `npm run compile`.
- Press F5 in VS Code to launch an Extension Development Host and try the commands:
  - `Tokligence: Open Chat`
  - `Tokligence: Select Model`
  - `Tokligence: Test Connection`
  - `Tokligence: Set API Key`
  - `Tokligence: Start Local Gateway` / `Tokligence: Stop Local Gateway`
  - `Tokligence: Download/Update Local Gateway`

Configuration
- `tokligence-gateway.url` — Base URL of the gateway (default: `http://localhost:8080`).
- `tokligence-gateway.apiPath` — Chat API path (default: `/v1/chat/completions`).
- `tokligence-gateway.model` — Default model name for chat requests.
- `tokligence-gateway.startLocalBinary` — Whether to start a bundled/installed local binary.
- `tokligence-gateway.binaryPath` — Custom path to the local gateway binary.
- `tokligence-gateway.healthPath` — Health check path (default: `/healthz`).
- `tokligence-gateway.systemPrompt` — System message for each chat (default provided).
- `tokligence-gateway.version` — Release tag to download (default: `v0.2.0`).
- `tokligence-gateway.autoDownloadBinary` — Auto-download the binary if missing (default: `true`).
- `tokligence-gateway.useStreaming` — Use OpenAI-style SSE streaming in chat (default: `true`).
- `tokligence-gateway.requestTimeoutMs` — HTTP timeout in ms (default: `60000`).

Publishing
1. Install the VS Code publisher tool: `npm i -g @vscode/vsce`.
2. Create a Marketplace publisher (once): `vsce create-publisher <publisher-name>`.
3. Login: `vsce login <publisher-name>` and provide your Azure DevOps PAT.
4. Bump the version in `package.json`.
5. Package locally: `npm run package` (uses bundling and `--no-git`, produces a `.vsix`).
6. Publish: `npm run publish`.

Notes
- If you plan to ship a local gateway binary, keep the `.vsix` small. Prefer downloading the correct binary on first run or require users to install the binary separately.
- The chat API is assumed OpenAI-compatible by default. Adjust `apiPath`/headers if your gateway differs.
- The `Tokligence: Download/Update Local Gateway` command fetches assets from the GitHub release specified by `tokligence-gateway.version` and selects the appropriate OS/arch build.
- First time downloading or starting a local binary, the extension asks for your consent (Allow once / Always allow) to meet marketplace expectations.
- You can cancel a streaming response via the `Stop` button, and clear the conversation via `Clear`.
