/**
 * MCPToolDiscovery - Discovers and registers tools from MCP servers
 *
 * Queries MCP servers for available tools, parses their schemas,
 * and registers them with the iteratio framework.
 */

import { MCPServerManager } from './MCPServerManager';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  validateToolParameters,
  exportToolsAsOpenAPI,
  ValidationResult,
} from './MCPToolValidation';

/** Parameter definition for a discovered MCP tool. */
export interface IToolParameter {
  name: string;
  description: string;
  type: string;
  required: boolean;
  default?: any;
  enum?: any[];
  constraints?: {
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: string;
  };
}

/**
 * Discovered tool with metadata
 */
export interface DiscoveredTool {
  name: string;
  description: string;
  parameters: IToolParameter[];
  execute: (parameters: Record<string, any>, context: any) => Promise<any>;
  /**
   * Name of the server providing this tool
   */
  serverName: string;

  /**
   * Original tool name from the MCP server (before prefix)
   */
  originalName: string;

  /**
   * Raw schema from MCP server
   */
  rawSchema: Tool;

  /**
   * When this tool was discovered/updated
   */
  discoveredAt: Date;
}

/** Discovers available tools from connected MCP servers and maps them to iteratio tool format. */
export class MCPToolDiscovery {
  private serverManager: MCPServerManager;
  private config: any;
  private discoveredTools: Map<string, DiscoveredTool> = new Map();

  constructor(serverManager: MCPServerManager, config: any) {
    this.serverManager = serverManager;
    this.config = config;
  }

  /**
   * Discover tools from all running servers
   */
  async discoverAllTools(): Promise<void> {
    const runningServers = this.serverManager.getRunningServers();

    const discoveryPromises = runningServers.map(serverName =>
      this.discoverToolsFromServer(serverName).catch(error => {
        this.config.logger.error(`Failed to discover tools from ${serverName}:`, error);
        return [];
      })
    );

    await Promise.all(discoveryPromises);
  }

  /**
   * Discover tools from a specific server
   */
  async discoverToolsFromServer(serverName: string): Promise<DiscoveredTool[]> {
    this.config.logger.info(`Discovering tools from server: ${serverName}`);

    try {
      const client = this.serverManager.getServerClient(serverName);

      const response = await client.listTools();

      const tools = response.tools || [];
      this.config.logger.debug(`Server ${serverName} reported ${tools.length} tools`);

      const discoveredTools: DiscoveredTool[] = [];

      for (const mcpTool of tools) {
        try {
          const tool = this.parseToolSchema(serverName, mcpTool);
          discoveredTools.push(tool);

          this.discoveredTools.set(tool.name, tool);
        } catch (error) {
          this.config.logger.error(`Failed to parse tool ${mcpTool.name} from ${serverName}:`, error);
        }
      }

      this.config.logger.info(`Discovered ${discoveredTools.length} tools from ${serverName}`);
      return discoveredTools;
    } catch (error) {
      this.config.logger.error(`Failed to discover tools from ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Parse MCP tool schema into iteratio ITool format
   */
  private parseToolSchema(serverName: string, mcpTool: Tool): DiscoveredTool {
    const originalName = mcpTool.name;
    const toolName = this.buildToolName(serverName, originalName);

    const tool: DiscoveredTool = {
      name: toolName,
      serverName,
      originalName,
      description: mcpTool.description || `Tool from ${serverName}`,
      rawSchema: mcpTool,
      discoveredAt: new Date(),
      parameters: this.parseInputSchema(mcpTool.inputSchema),
      execute: async (_parameters: Record<string, any>, _context: any) => {
        throw new Error('Tool execution should be handled by MCPToolExecutor');
      },
    };

    return tool;
  }

  /**
   * Parse JSON Schema input schema into iteratio parameter format
   */
  private parseInputSchema(inputSchema: any): IToolParameter[] {
    if (!inputSchema || typeof inputSchema !== 'object') {
      return [];
    }

    const parameters: IToolParameter[] = [];
    const properties = inputSchema.properties || {};
    const required = inputSchema.required || [];

    for (const [name, schema] of Object.entries(properties)) {
      const paramSchema = schema as any;

      parameters.push({
        name,
        description: paramSchema.description || '',
        type: this.mapJsonSchemaType(paramSchema.type),
        required: required.includes(name),
        default: paramSchema.default,
        enum: paramSchema.enum,
        constraints: {
          minLength: paramSchema.minLength,
          maxLength: paramSchema.maxLength,
          minimum: paramSchema.minimum,
          maximum: paramSchema.maximum,
          pattern: paramSchema.pattern,
          format: paramSchema.format,
        },
      });
    }

    return parameters;
  }

  /**
   * Map JSON Schema types to iteratio types
   */
  private mapJsonSchemaType(jsonType: string | string[]): string {
    if (Array.isArray(jsonType)) {
      const nonNullType = jsonType.find(t => t !== 'null');
      return this.mapJsonSchemaType(nonNullType || 'string');
    }

    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      integer: 'number',
      boolean: 'boolean',
      object: 'object',
      array: 'array',
      null: 'null',
    };

    return typeMap[jsonType] || 'any';
  }

  /**
   * Build the full tool name with prefix and server name
   */
  private buildToolName(serverName: string, originalName: string): string {
    const prefix = this.config.toolNamePrefix || 'mcp_';

    if (this.config.includeServerNameInToolPrefix) {
      return `${prefix}${serverName}_${originalName}`;
    } else {
      return `${prefix}${originalName}`;
    }
  }

  /**
   * Get all discovered tools
   */
  getDiscoveredTools(): DiscoveredTool[] {
    return Array.from(this.discoveredTools.values());
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): DiscoveredTool | undefined {
    return this.discoveredTools.get(name);
  }

  /**
   * Get tools from a specific server
   */
  getToolsFromServer(serverName: string): DiscoveredTool[] {
    return Array.from(this.discoveredTools.values()).filter(
      tool => tool.serverName === serverName
    );
  }

  /**
   * Remove all tools from a specific server
   */
  removeToolsFromServer(serverName: string): void {
    const toolsToRemove = Array.from(this.discoveredTools.entries())
      .filter(([_, tool]) => tool.serverName === serverName)
      .map(([name, _]) => name);

    for (const toolName of toolsToRemove) {
      this.discoveredTools.delete(toolName);
    }

    this.config.logger.info(`Removed ${toolsToRemove.length} tools from server ${serverName}`);
  }

  /**
   * Search for tools by name pattern
   */
  searchTools(pattern: string | RegExp): DiscoveredTool[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return Array.from(this.discoveredTools.values()).filter(tool =>
      regex.test(tool.name) || regex.test(tool.description) || regex.test(tool.originalName)
    );
  }

  /**
   * Get tool statistics
   */
  getStatistics(): {
    totalTools: number;
    toolsByServer: Record<string, number>;
    oldestDiscovery: Date | null;
    newestDiscovery: Date | null;
  } {
    const tools = Array.from(this.discoveredTools.values());

    const toolsByServer: Record<string, number> = {};
    for (const tool of tools) {
      toolsByServer[tool.serverName] = (toolsByServer[tool.serverName] || 0) + 1;
    }

    const timestamps = tools.map(t => t.discoveredAt.getTime());
    const oldestDiscovery = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
    const newestDiscovery = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

    return {
      totalTools: tools.length,
      toolsByServer,
      oldestDiscovery,
      newestDiscovery,
    };
  }

  /**
   * Validate tool parameters against schema
   */
  validateToolParameters(toolName: string, parameters: Record<string, any>): ValidationResult {
    const tool = this.discoveredTools.get(toolName);
    if (!tool) {
      return {
        valid: false,
        errors: [`Tool ${toolName} not found`],
      };
    }

    return validateToolParameters(tool, parameters);
  }

  /**
   * Export tool schemas in OpenAPI format (for documentation)
   */
  exportAsOpenAPI(): any {
    return exportToolsAsOpenAPI(Array.from(this.discoveredTools.values()));
  }
}
