/**
 * MCPServerManager - Manages lifecycle of MCP server processes
 *
 * Handles launching, stopping, restarting, and health monitoring of MCP servers.
 * Supports multiple transport types: stdio, SSE (Server-Sent Events), and WebSocket.
 */

import { ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import WebSocket from 'ws';
import {
  createStdioTransport,
  createSSETransport,
  createWebSocketTransport,
} from './MCPTransportFactory';
import { MCPServerConfig, MCPServerType, ServerStatus } from './MCPServerTypes';

// Re-export types for consumers
export { MCPServerConfig, MCPServerType, ServerStatus } from './MCPServerTypes';

/**
 * Server instance tracking
 */
interface ServerInstance {
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | WebSocket;
  process?: ChildProcess;
  status: ServerStatus;
  lastHealthCheck?: Date;
  restartAttempts: number;
  healthCheckInterval?: NodeJS.Timeout;
}

/** Manages lifecycle of MCP server connections including start, stop, and health checks. */
export class MCPServerManager {
  private servers: Map<string, ServerInstance> = new Map();
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  /**
   * Launch all configured servers
   */
  async launchAllServers(): Promise<void> {
    const launchPromises = this.config.servers.map((serverConfig: MCPServerConfig) =>
      this.launchServer(serverConfig)
    );

    await Promise.allSettled(launchPromises);
  }

  /**
   * Launch a single MCP server
   */
  async launchServer(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      throw new Error(`Server ${config.name} already exists`);
    }

    this.config.logger.info(`Launching MCP server: ${config.name} (${config.type})`);

    try {
      const instance = await this.createServerInstance(config);
      this.servers.set(config.name, instance);

      if (config.healthCheckInterval && config.healthCheckInterval > 0) {
        this.startHealthCheck(config.name);
      }

      this.config.logger.info(`Server ${config.name} launched successfully`);
    } catch (error) {
      this.config.logger.error(`Failed to launch server ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * Stop a specific server
   */
  async stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) {
      throw new Error(`Server ${name} not found`);
    }

    this.config.logger.info(`Stopping server: ${name}`);

    try {
      if (instance.healthCheckInterval) {
        clearInterval(instance.healthCheckInterval);
      }

      await instance.client.close();

      if (instance.process) {
        instance.process.kill();
      }

      instance.status = ServerStatus.STOPPED;
      this.servers.delete(name);

      this.config.logger.info(`Server ${name} stopped`);
    } catch (error) {
      this.config.logger.error(`Failed to stop server ${name}:`, error);
      throw error;
    }
  }

  /**
   * Stop all servers
   */
  async stopAllServers(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map(name => this.stopServer(name));
    await Promise.allSettled(stopPromises);
  }

  /**
   * Restart a specific server
   */
  async restartServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) {
      throw new Error(`Server ${name} not found`);
    }

    this.config.logger.info(`Restarting server: ${name}`);
    instance.status = ServerStatus.RESTARTING;

    const config = instance.config;

    try {
      await this.stopServer(name);

      if (config.restartDelay && config.restartDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, config.restartDelay));
      }

      await this.launchServer(config);
    } catch (error) {
      this.config.logger.error(`Failed to restart server ${name}:`, error);
      throw error;
    }
  }

  /**
   * Get a server's client for tool execution
   */
  getServerClient(name: string): Client {
    const instance = this.servers.get(name);
    if (!instance) {
      throw new Error(`Server ${name} not found`);
    }

    if (instance.status !== ServerStatus.RUNNING) {
      throw new Error(`Server ${name} is not running (status: ${instance.status})`);
    }

    return instance.client;
  }

  /**
   * Get status of all servers
   */
  getServerStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [name, instance] of this.servers.entries()) {
      status[name] = {
        status: instance.status,
        type: instance.config.type,
        lastHealthCheck: instance.lastHealthCheck,
        restartAttempts: instance.restartAttempts,
      };
    }

    return status;
  }

  /**
   * Check if a server is running
   */
  isServerRunning(name: string): boolean {
    const instance = this.servers.get(name);
    return instance?.status === ServerStatus.RUNNING;
  }

  /**
   * Get all running server names
   */
  getRunningServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, instance]) => instance.status === ServerStatus.RUNNING)
      .map(([name, _]) => name);
  }

  /**
   * Create a server instance based on configuration
   */
  private async createServerInstance(config: MCPServerConfig): Promise<ServerInstance> {
    const instance: ServerInstance = {
      config,
      client: new Client(
        { name: `iteratio-mcp-client-${config.name}`, version: '1.0.0' },
        { capabilities: {} }
      ),
      transport: null as any,
      status: ServerStatus.STARTING,
      restartAttempts: 0,
    };

    try {
      switch (config.type) {
        case MCPServerType.STDIO:
          instance.transport = await createStdioTransport(config, instance, this.config.logger);
          instance.process?.removeAllListeners('error');
          instance.process?.removeAllListeners('exit');
          instance.process?.on('error', () => this.handleServerFailure(config.name));
          instance.process?.on('exit', () => this.handleServerFailure(config.name));
          break;
        case MCPServerType.SSE:
          instance.transport = await createSSETransport(config, this.config.logger);
          break;
        case MCPServerType.WEBSOCKET:
          instance.transport = await createWebSocketTransport(
            config, this.config.logger, () => this.handleServerFailure(config.name)
          );
          break;
        default:
          throw new Error(`Unsupported server type: ${config.type}`);
      }

      await instance.client.connect(instance.transport as any);
      instance.status = ServerStatus.RUNNING;

      return instance;
    } catch (error) {
      instance.status = ServerStatus.FAILED;
      throw error;
    }
  }

  /**
   * Start health check for a server
   */
  private startHealthCheck(name: string): void {
    const instance = this.servers.get(name);
    if (!instance) return;

    const interval = instance.config.healthCheckInterval || 30000;

    instance.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck(name);
      } catch (error) {
        this.config.logger.error(`Health check failed for ${name}:`, error);
        this.handleServerFailure(name);
      }
    }, interval);
  }

  /**
   * Perform a health check on a server
   */
  private async performHealthCheck(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) return;

    try {
      await instance.client.listTools();
      instance.lastHealthCheck = new Date();
      this.config.logger.debug(`Health check passed for ${name}`);
    } catch (error) {
      throw new Error(`Health check failed: ${error}`);
    }
  }

  /**
   * Handle server failure (crash, disconnect, etc.)
   */
  private async handleServerFailure(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance) return;

    instance.status = ServerStatus.FAILED;
    this.config.logger.error(`Server ${name} failed`);

    if (
      instance.config.autoRestart !== false &&
      instance.restartAttempts < (instance.config.maxRestartAttempts || 3)
    ) {
      instance.restartAttempts++;
      this.config.logger.info(
        `Attempting to restart ${name} (attempt ${instance.restartAttempts}/${instance.config.maxRestartAttempts || 3})`
      );

      try {
        await this.restartServer(name);
        instance.restartAttempts = 0;
      } catch (error) {
        this.config.logger.error(`Failed to auto-restart ${name}:`, error);
      }
    } else {
      this.config.logger.error(`Server ${name} exceeded max restart attempts or auto-restart is disabled`);
    }
  }
}
