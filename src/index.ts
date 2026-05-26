/**
 * MCPPlugin - Main plugin class for MCP (Model Context Protocol) integration
 *
 * This plugin enables iteratio to connect to MCP servers and use their tools.
 * MCP servers can provide various capabilities like:
 * - GitHub integration (create issues, PRs, etc.)
 * - Filesystem operations (read, write files)
 * - Database queries (SQL, NoSQL)
 * - Web operations (fetch, search)
 * - Custom domain-specific tools
 *
 * @module iteratio-plugin-mcp
 */

import { IPlugin, ToolContext } from 'iteratio';
import { DiscoveredTool } from './MCPToolDiscovery';
import { MCPServerManager, MCPServerConfig } from './MCPServerManager';
import { MCPToolDiscovery } from './MCPToolDiscovery';
import { MCPToolExecutor } from './MCPToolExecutor';
import { MCPResourceManager } from './MCPResourceManager';

/**
 * Configuration for the MCP plugin
 */
export interface MCPPluginConfig {
  /**
   * List of MCP servers to connect to
   */
  servers: MCPServerConfig[];

  /**
   * Whether to automatically discover tools on plugin initialization
   * @default true
   */
  autoDiscoverTools?: boolean;

  /**
   * Interval (in ms) to refresh tool list from servers
   * Set to 0 to disable automatic refresh
   * @default 300000 (5 minutes)
   */
  toolRefreshInterval?: number;

  /**
   * Whether to enable resource management (prompts, templates)
   * @default false
   */
  enableResources?: boolean;

  /**
   * Maximum number of retries for failed tool executions
   * @default 3
   */
  maxRetries?: number;

  /**
   * Timeout (in ms) for tool execution
   * @default 30000 (30 seconds)
   */
  executionTimeout?: number;

  /**
   * Prefix to add to tool names from MCP servers
   * Helps avoid name collisions with other plugins
   * @default "mcp_"
   */
  toolNamePrefix?: string;

  /**
   * Whether to include server name in tool prefix
   * e.g., "mcp_github_create_issue" vs "mcp_create_issue"
   * @default true
   */
  includeServerNameInToolPrefix?: boolean;

  /**
   * Callback for logging and debugging
   */
  logger?: {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
  };
}

/**
 * MCPPlugin - Main plugin class
 *
 * Manages the lifecycle of MCP servers, tool discovery, and execution.
 */
export class MCPPlugin implements IPlugin {
  public readonly name = 'mcp';
  public readonly version = '1.0.0';

  private config: Required<MCPPluginConfig>;
  private serverManager: MCPServerManager;
  private toolDiscovery: MCPToolDiscovery;
  private toolExecutor: MCPToolExecutor;
  private resourceManager?: MCPResourceManager;
  private refreshInterval?: NodeJS.Timeout;
  private initialized = false;

  constructor(config: MCPPluginConfig) {
    // Apply defaults
    this.config = {
      ...config,
      autoDiscoverTools: config.autoDiscoverTools ?? true,
      toolRefreshInterval: config.toolRefreshInterval ?? 300000,
      enableResources: config.enableResources ?? false,
      maxRetries: config.maxRetries ?? 3,
      executionTimeout: config.executionTimeout ?? 30000,
      toolNamePrefix: config.toolNamePrefix ?? 'mcp_',
      includeServerNameInToolPrefix: config.includeServerNameInToolPrefix ?? true,
      logger: config.logger ?? this.createDefaultLogger(),
    };

    this.serverManager = new MCPServerManager(this.config);
    this.toolDiscovery = new MCPToolDiscovery(this.serverManager, this.config);
    this.toolExecutor = new MCPToolExecutor(this.serverManager, this.config);

    if (this.config.enableResources) {
      this.resourceManager = new MCPResourceManager(this.serverManager, this.config);
    }
  }

  /**
   * Initialize the plugin
   * - Launch all configured MCP servers
   * - Discover available tools
   * - Set up automatic refresh if configured
   */
  async initialize(_container?: import("inversify").Container): Promise<void> {
    if (this.initialized) {
      this.config.logger.warn('MCPPlugin already initialized');
      return;
    }

    this.config.logger.info('Initializing MCP plugin...');

    try {
      // Launch all configured servers
      await this.serverManager.launchAllServers();

      // Discover tools from all servers
      if (this.config.autoDiscoverTools) {
        await this.discoverTools();
      }

      // Initialize resource manager if enabled
      if (this.resourceManager) {
        await this.resourceManager.initialize();
      }

      // Set up automatic tool refresh
      if (this.config.toolRefreshInterval > 0) {
        this.setupAutoRefresh();
      }

      this.initialized = true;
      this.config.logger.info('MCP plugin initialized successfully');
    } catch (error) {
      this.config.logger.error('Failed to initialize MCP plugin:', error);
      throw error;
    }
  }

  /**
   * Cleanup and shutdown the plugin
   */
  async cleanup(): Promise<void> {
    this.config.logger.info('Cleaning up MCP plugin...');

    // Stop auto-refresh
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    // Cleanup resource manager
    if (this.resourceManager) {
      await this.resourceManager.cleanup();
    }

    // Stop all servers
    await this.serverManager.stopAllServers();

    this.initialized = false;
    this.config.logger.info('MCP plugin cleaned up');
  }

  /**
   * Get all available tools from MCP servers
   */
  async getTools(): Promise<DiscoveredTool[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.toolDiscovery.getDiscoveredTools();
  }

  /**
   * Execute a tool from an MCP server
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, any>,
    context: ToolContext
  ): Promise<any> {
    if (!this.initialized) {
      throw new Error('MCPPlugin not initialized. Call initialize() first.');
    }

    return this.toolExecutor.executeTool(toolName, parameters, context);
  }

  /**
   * Discover or refresh tools from all MCP servers
   */
  async discoverTools(): Promise<void> {
    this.config.logger.info('Discovering tools from MCP servers...');
    await this.toolDiscovery.discoverAllTools();
    this.config.logger.info(`Discovered ${this.toolDiscovery.getDiscoveredTools().length} tools`);
  }

  /**
   * Add a new MCP server at runtime
   */
  async addServer(serverConfig: MCPServerConfig): Promise<void> {
    this.config.logger.info(`Adding new server: ${serverConfig.name}`);

    this.config.servers.push(serverConfig);
    await this.serverManager.launchServer(serverConfig);

    // Discover tools from the new server
    if (this.config.autoDiscoverTools) {
      await this.toolDiscovery.discoverToolsFromServer(serverConfig.name);
    }
  }

  /**
   * Remove an MCP server at runtime
   */
  async removeServer(serverName: string): Promise<void> {
    this.config.logger.info(`Removing server: ${serverName}`);

    await this.serverManager.stopServer(serverName);

    // Remove from config
    this.config.servers = this.config.servers.filter(s => s.name !== serverName);

    // Remove tools from this server
    this.toolDiscovery.removeToolsFromServer(serverName);
  }

  /**
   * Restart a specific MCP server
   */
  async restartServer(serverName: string): Promise<void> {
    this.config.logger.info(`Restarting server: ${serverName}`);

    await this.serverManager.restartServer(serverName);

    // Rediscover tools after restart
    if (this.config.autoDiscoverTools) {
      await this.toolDiscovery.discoverToolsFromServer(serverName);
    }
  }

  /**
   * Get status of all MCP servers
   */
  getServerStatus(): Record<string, any> {
    return this.serverManager.getServerStatus();
  }

  /**
   * Get available resources (prompts, templates) if resource management is enabled
   */
  async getResources(): Promise<any[]> {
    if (!this.resourceManager) {
      throw new Error('Resource management is not enabled. Set enableResources: true in config.');
    }

    return this.resourceManager.getResources();
  }

  /**
   * Get a specific resource by URI
   */
  async getResource(uri: string): Promise<any> {
    if (!this.resourceManager) {
      throw new Error('Resource management is not enabled. Set enableResources: true in config.');
    }

    return this.resourceManager.getResource(uri);
  }

  /**
   * Set up automatic tool refresh
   */
  private setupAutoRefresh(): void {
    this.refreshInterval = setInterval(async () => {
      try {
        this.config.logger.debug('Auto-refreshing tools...');
        await this.discoverTools();
      } catch (error) {
        this.config.logger.error('Failed to auto-refresh tools:', error);
      }
    }, this.config.toolRefreshInterval);
  }

  /**
   * Create a default console logger
   */
  private createDefaultLogger() {
    return {
      debug: (message: string, ...args: any[]) => console.debug(`[MCP] ${message}`, ...args),
      info: (message: string, ...args: any[]) => console.info(`[MCP] ${message}`, ...args),
      warn: (message: string, ...args: any[]) => console.warn(`[MCP] ${message}`, ...args),
      error: (message: string, ...args: any[]) => console.error(`[MCP] ${message}`, ...args),
    };
  }
}

// Export all types and classes
export { MCPServerConfig, MCPServerType } from './MCPServerManager';
export { MCPToolDiscovery } from './MCPToolDiscovery';
export { MCPToolExecutor } from './MCPToolExecutor';
export { MCPResourceManager } from './MCPResourceManager';
export { MCPAuthProvider, type MCPAuthConfig, type OAuth2Result, type OAuthFlowEvent, type OAuthFlowListener } from './auth/MCPAuthProvider';
export { discoverOAuthMetadata } from './auth/discovery';
export { createAuthProvider, type MCPAuthProviderInstance } from './auth/createAuthProvider';

// TODO: Add support for MCP server authentication (API keys, OAuth)
// TODO: Add support for MCP server capabilities negotiation
// TODO: Add support for streaming tool responses
// TODO: Add metrics collection (tool usage, execution time, error rates)
// TODO: Add tool caching for faster repeated executions
// TODO: Add support for MCP server discovery (auto-find servers on network)
// TODO: Add support for MCP server versioning and compatibility checks
// TODO: Add support for tool parameter validation before execution
// TODO: Add support for tool execution history and replay
// TODO: Add support for parallel tool execution from same server
