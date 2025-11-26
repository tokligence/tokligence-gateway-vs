# Tokligence Gateway - VS Code Extension

**LLM Gateway for Developers** with PII/API key detection, multi-provider translation, and automatic coding agent configuration.

## Features

### 🛡️ PII & API Key Protection
- **Real-time detection** of sensitive data in LLM requests
- **30+ API key patterns** (OpenAI, AWS, GitHub, Stripe, etc.)
- **Multiple modes**: Monitor, Redact, or Block
- **100+ language support** for PII detection

### 🔄 Multi-Provider Translation
- **Seamless API translation** between OpenAI ↔ Anthropic ↔ Gemini
- **Use any model** with your preferred API format
- **9.6x faster** than LiteLLM

### 🔧 Auto-Configure Coding Agents
Automatically configure popular coding assistants to use the gateway:
- **Continue** - Auto-configures `~/.continue/config.json`
- **Claude Code** - Auto-configures `~/.claude/settings.json`
- **Cursor** - Provides setup instructions
- **Codeium** - Enterprise endpoint support

### 📊 Usage Tracking
- Token usage by model
- Request logging
- Cost estimation

## Quick Start

1. **Install** the extension from VS Code Marketplace
2. **Configure API Keys**: `Cmd/Ctrl+Shift+P` → "Tokligence: Configure API Providers"
3. **Start Gateway**: The gateway starts automatically on VS Code launch

## Commands

| Command | Description |
|---------|-------------|
| `Tokligence: Start Gateway` | Start the local gateway |
| `Tokligence: Stop Gateway` | Stop the gateway |
| `Tokligence: Configure API Providers` | Set up OpenAI/Anthropic/Gemini API keys |
| `Tokligence: Configure Coding Agents` | Auto-configure Continue, Claude Code, etc. |
| `Tokligence: Set Work Mode` | Choose Auto/Passthrough/Translation mode |
| `Tokligence: Toggle PII Firewall` | Enable/disable PII detection |
| `Tokligence: Open Chat` | Open the built-in chat interface |
| `Tokligence: Show Status` | View gateway status and configuration |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tokligence-gateway.url` | `http://localhost:8081` | Gateway URL |
| `tokligence-gateway.startOnActivation` | `true` | Auto-start gateway |
| `tokligence-gateway.workMode` | `auto` | Routing mode (auto/passthrough/translation) |
| `tokligence-gateway.piiFirewallEnabled` | `true` | Enable PII protection |
| `tokligence-gateway.piiFirewallMode` | `redact` | PII mode (monitor/redact/enforce) |
| `tokligence-gateway.modelRoutes` | `claude*=>anthropic,...` | Model routing rules |

## Work Modes

- **Auto**: Smart routing - automatically chooses passthrough or translation
- **Passthrough**: Direct proxy to upstream providers only
- **Translation**: Protocol translation only (OpenAI↔Anthropic↔Gemini)

## PII Firewall Modes

- **Monitor**: Log detected PII but allow requests through
- **Redact**: Automatically mask sensitive data before sending to LLM
- **Enforce**: Block requests containing PII

## Supported Providers

| Provider | Models | API Key Pattern |
|----------|--------|-----------------|
| OpenAI | GPT-4, GPT-4o, o1 | `sk-...` |
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus | `sk-ant-...` |
| Google Gemini | Gemini 2.0 Flash, Gemini Pro | `AIza...` |

## API Endpoints

When the gateway is running, you can use these endpoints:

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/v1/chat/completions` | OpenAI | Chat API |
| `/v1/responses` | OpenAI | Responses API (Codex) |
| `/anthropic/v1/messages` | Anthropic | Native Anthropic API |
| `/v1beta/models/{model}:generateContent` | Gemini | Native Gemini API |
| `/v1/models` | OpenAI | List available models |
| `/health` | - | Health check |

## Example: Using with Continue

After installing the extension:

1. Run `Tokligence: Detect Coding Agents`
2. Select "Continue" and choose "Configure"
3. Continue will automatically use the gateway for all LLM requests

Your requests now have PII protection!

## Example: API Translation

Use Claude with OpenAI-compatible tools:

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

The gateway automatically translates to Anthropic's API format.

## Links

- [GitHub Repository](https://github.com/tokligence/tokligence-gateway-vs)
- [Main Gateway Project](https://github.com/tokligence/tokligence-gateway)
- [Documentation](https://github.com/tokligence/tokligence-gateway/wiki)
- [Report Issues](https://github.com/tokligence/tokligence-gateway-vs/issues)

## License

Apache-2.0
