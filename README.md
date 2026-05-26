# iteratio-plugin-mcp

MCP (Model Context Protocol) integration plugin for iteratio.

## Install

```
npm install iteratio-plugin-mcp @modelcontextprotocol/sdk
```

## What It Does

Connects iteratio agents to MCP servers so they can use external tools. Supports stdio, SSE, and WebSocket transports. Automatically discovers tools from connected servers, validates parameters, retries on failure, and tracks execution statistics.

## Usage

```typescript
import { Iteratio } from 'iteratio';
import { MCPPlugin, MCPServerType } from 'iteratio-plugin-mcp';

const mcpPlugin = new MCPPlugin({
  servers: [
    {
      name: 'github',
      type: MCPServerType.STDIO,
      stdio: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
      }
    }
  ],
  autoDiscoverTools: true
});

const iteratio = new Iteratio({ plugins: [mcpPlugin] });

const result = await iteratio.executeTool('mcp_github_create_issue', {
  owner: 'myorg', repo: 'myrepo', title: 'Bug report'
});
```

## License

MIT
