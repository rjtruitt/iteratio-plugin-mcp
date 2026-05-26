/**
 * Basic usage example for iteratio-plugin-mcp
 *
 * This example demonstrates how to:
 * 1. Set up the MCP plugin with multiple servers
 * 2. Initialize and discover tools
 * 3. Execute tools from different MCP servers
 * 4. Handle errors and monitor statistics
 */

import { MCPPlugin, MCPServerType } from '../src/index';

async function main() {
  console.log('=== MCP Plugin Basic Usage Example ===\n');

  // Create the MCP plugin with multiple server configurations
  const mcpPlugin = new MCPPlugin({
    servers: [
      // GitHub server for repository operations
      {
        name: 'github',
        type: MCPServerType.STDIO,
        stdio: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
          },
        },
        healthCheckInterval: 30000,
        autoRestart: true,
      },
      // Filesystem server for file operations
      {
        name: 'filesystem',
        type: MCPServerType.STDIO,
        stdio: {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            process.cwd(), // Allow access to current directory
          ],
        },
        healthCheckInterval: 30000,
        autoRestart: true,
      },
    ],
    autoDiscoverTools: true,
    toolRefreshInterval: 300000, // 5 minutes
    maxRetries: 3,
    executionTimeout: 30000,
    toolNamePrefix: 'mcp_',
    includeServerNameInToolPrefix: true,
  });

  try {
    // Initialize the plugin (launches servers and discovers tools)
    console.log('Initializing MCP plugin...');
    await mcpPlugin.initialize();
    console.log('✓ Plugin initialized\n');

    // Get server status
    console.log('Server Status:');
    const status = mcpPlugin.getServerStatus();
    console.log(JSON.stringify(status, null, 2));
    console.log('');

    // Get all available tools
    console.log('Discovering tools...');
    const tools = await mcpPlugin.getTools();
    console.log(`✓ Found ${tools.length} tools\n`);

    // List some tools
    console.log('Available tools (first 10):');
    tools.slice(0, 10).forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log('');

    // Example 1: Filesystem operations (if filesystem server is configured)
    const filesystemTools = tools.filter(t => t.name.includes('filesystem'));
    if (filesystemTools.length > 0) {
      console.log('=== Filesystem Example ===');

      try {
        // List directory
        console.log('Listing current directory...');
        const files = await mcpPlugin.executeTool(
          'mcp_filesystem_list_directory',
          { path: process.cwd() },
          {} as any
        );
        console.log('✓ Directory listing successful');
        console.log(`Found ${files?.length || 0} items\n`);

        // Write a test file
        console.log('Writing test file...');
        await mcpPlugin.executeTool(
          'mcp_filesystem_write_file',
          {
            path: `${process.cwd()}/mcp-test-${Date.now()}.txt`,
            content: 'Hello from MCP plugin!',
          },
          {} as any
        );
        console.log('✓ File written successfully\n');
      } catch (error: any) {
        console.error('✗ Filesystem operation failed:', error.message);
      }
    }

    // Example 2: GitHub operations (if GitHub token is configured)
    const githubTools = tools.filter(t => t.name.includes('github'));
    if (githubTools.length > 0 && process.env.GITHUB_TOKEN) {
      console.log('=== GitHub Example ===');

      try {
        // Search for repositories
        console.log('Searching for MCP repositories...');
        const repos = await mcpPlugin.executeTool(
          'mcp_github_search_repositories',
          {
            query: 'model-context-protocol',
            per_page: 5,
          },
          {} as any
        );
        console.log('✓ Repository search successful');
        console.log(`Found repositories\n`);
      } catch (error: any) {
        console.error('✗ GitHub operation failed:', error.message);
      }
    }

    // Get execution statistics
    console.log('=== Execution Statistics ===');
    const executor = (mcpPlugin as any).toolExecutor;
    const stats = executor.getStatistics();
    console.log(`Total executions: ${stats.totalExecutions}`);
    console.log(`Successful: ${stats.successfulExecutions}`);
    console.log(`Failed: ${stats.failedExecutions}`);
    if (stats.totalExecutions > 0) {
      console.log(`Success rate: ${((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(2)}%`);
      console.log(`Average execution time: ${stats.averageExecutionTime.toFixed(2)}ms`);
    }
    console.log('');

    // Example 3: Dynamic server management
    console.log('=== Dynamic Server Management ===');

    // Add a new server at runtime
    console.log('Adding a new temporary server...');
    await mcpPlugin.addServer({
      name: 'temp-fs',
      type: MCPServerType.STDIO,
      stdio: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    });
    console.log('✓ Server added\n');

    // Check status again
    const updatedStatus = mcpPlugin.getServerStatus();
    console.log('Updated server status:');
    console.log(JSON.stringify(updatedStatus, null, 2));
    console.log('');

    // Remove the temporary server
    console.log('Removing temporary server...');
    await mcpPlugin.removeServer('temp-fs');
    console.log('✓ Server removed\n');

    // Example 4: Tool validation (dry run)
    console.log('=== Tool Validation ===');
    const toolDiscovery = (mcpPlugin as any).toolDiscovery;

    // Valid parameters
    const validParams = toolDiscovery.validateToolParameters(
      'mcp_filesystem_read_file',
      { path: '/some/path.txt' }
    );
    console.log('Valid parameters test:', validParams.valid ? '✓' : '✗');

    // Invalid parameters (missing required field)
    const invalidParams = toolDiscovery.validateToolParameters(
      'mcp_filesystem_read_file',
      {}
    );
    console.log('Invalid parameters test:', !invalidParams.valid ? '✓' : '✗');
    if (!invalidParams.valid) {
      console.log('Validation errors:', invalidParams.errors);
    }
    console.log('');

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    console.log('=== Cleanup ===');
    console.log('Shutting down MCP plugin...');
    await mcpPlugin.cleanup();
    console.log('✓ Plugin shut down\n');
  }
}

// Run the example
main().catch(console.error);

// TODO: Add example for resource management (when enabled)
// TODO: Add example for parallel tool execution
// TODO: Add example for tool execution with progress updates
// TODO: Add example for custom MCP server integration
// TODO: Add example for error handling strategies
// TODO: Add example for tool execution with retries
// TODO: Add example for WebSocket and SSE transports
