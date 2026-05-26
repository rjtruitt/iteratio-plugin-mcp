/**
 * MCPToolExecutor - Executes tools via MCP protocol
 *
 * Handles tool execution, including parameter validation, retries,
 * timeout management, and result processing.
 */

import { ToolContext } from 'iteratio';
import { MCPServerManager } from './MCPServerManager';
import { MCPToolDiscovery } from './MCPToolDiscovery';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ExecutionStats,
  BatchExecution,
  BatchResult,
  createExecutionStats,
  updateExecutionStats,
  getToolStatistics,
  exportExecutionHistory,
  executeToolsInParallel,
  executeToolsInSequence,
} from './MCPToolExecutorBatch';

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  /**
   * Whether the execution was successful
   */
  success: boolean;

  /**
   * Result data from the tool
   */
  result?: any;

  /**
   * Error information if execution failed
   */
  error?: {
    message: string;
    code?: string;
    details?: any;
  };

  /**
   * Execution metadata
   */
  metadata: {
    /**
     * Server that executed the tool
     */
    serverName: string;

    /**
     * Original tool name (without prefix)
     */
    originalToolName: string;

    /**
     * Execution time in milliseconds
     */
    executionTime: number;

    /**
     * Number of retry attempts
     */
    retryAttempts: number;

    /**
     * Timestamp of execution
     */
    timestamp: Date;
  };
}

/** Executes tool calls on connected MCP servers with parameter validation and error handling. */
export class MCPToolExecutor {
  private serverManager: MCPServerManager;
  private config: any;
  private toolDiscovery?: MCPToolDiscovery;
  private stats: ExecutionStats = createExecutionStats();

  constructor(serverManager: MCPServerManager, config: any) {
    this.serverManager = serverManager;
    this.config = config;
  }

  /**
   * Set the tool discovery instance (for validation)
   */
  setToolDiscovery(toolDiscovery: MCPToolDiscovery): void {
    this.toolDiscovery = toolDiscovery;
  }

  /**
   * Execute a tool from an MCP server
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, any>,
    context: ToolContext
  ): Promise<any> {
    const startTime = Date.now();

    try {
      const tool = this.toolDiscovery?.getTool(toolName);
      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }

      // Validate parameters if tool discovery is available
      if (this.toolDiscovery) {
        const validation = this.toolDiscovery.validateToolParameters(toolName, parameters);
        if (!validation.valid) {
          throw new Error(`Parameter validation failed:\n${validation.errors.join('\n')}`);
        }
      }

      // Execute with retries
      const result = await this.executeWithRetry(
        tool.serverName,
        tool.originalName,
        parameters,
        context
      );

      const executionTime = Date.now() - startTime;
      updateExecutionStats(this.stats, toolName, true, executionTime);

      this.config.logger.debug(`Tool ${toolName} executed successfully in ${executionTime}ms`);

      return result.content;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      updateExecutionStats(this.stats, toolName, false, executionTime);

      this.config.logger.error(`Tool ${toolName} execution failed:`, error);
      throw error;
    }
  }

  /**
   * Execute tool with retry logic
   */
  private async executeWithRetry(
    serverName: string,
    originalToolName: string,
    parameters: Record<string, any>,
    context: ToolContext
  ): Promise<CallToolResult> {
    const maxRetries = this.config.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.config.logger.info(`Retry attempt ${attempt}/${maxRetries} for tool ${originalToolName}`);
          await this.delay(Math.pow(2, attempt) * 1000);
        }

        const result = await this.executeToolOnce(
          serverName,
          originalToolName,
          parameters,
          context
        );

        return result;
      } catch (error: any) {
        lastError = error;

        // Don't retry on parameter validation errors
        if (error.message?.includes('Parameter validation failed')) {
          throw error;
        }

        // Don't retry on tool not found errors
        if (error.message?.includes('not found')) {
          throw error;
        }

        this.config.logger.warn(`Tool execution attempt ${attempt + 1} failed:`, error.message);
      }
    }

    throw lastError || new Error('Tool execution failed after retries');
  }

  /**
   * Execute tool once with timeout
   */
  private async executeToolOnce(
    serverName: string,
    originalToolName: string,
    parameters: Record<string, any>,
    _context: ToolContext
  ): Promise<CallToolResult> {
    const timeout = this.config.executionTimeout || 30000;

    const client = this.serverManager.getServerClient(serverName);

    const executionPromise = client.callTool({
      name: originalToolName,
      arguments: parameters,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);
    });

    const result = await Promise.race([executionPromise, timeoutPromise]) as CallToolResult;

    if (result.isError) {
      throw new Error(`Tool execution error: ${JSON.stringify(result.content)}`);
    }

    return result;
  }

  /**
   * Get execution statistics
   */
  getStatistics(): ExecutionStats {
    return { ...this.stats };
  }

  /**
   * Get statistics for a specific tool
   */
  getToolStatistics(toolName: string) {
    return getToolStatistics(this.stats, toolName);
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.stats = createExecutionStats();
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeToolsInParallel(executions: BatchExecution[]): Promise<BatchResult[]> {
    return executeToolsInParallel(
      executions,
      (toolName, parameters, context) => this.executeTool(toolName, parameters, context)
    );
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeToolsInSequence(executions: BatchExecution[]): Promise<BatchResult[]> {
    return executeToolsInSequence(
      executions,
      (toolName, parameters, context) => this.executeTool(toolName, parameters, context)
    );
  }

  /**
   * Execute tool with progress updates (for long-running operations)
   */
  async executeToolWithProgress(
    toolName: string,
    parameters: Record<string, any>,
    context: ToolContext,
    onProgress?: (progress: number, message?: string) => void
  ): Promise<any> {
    if (onProgress) {
      onProgress(0, 'Starting tool execution...');
    }

    try {
      if (onProgress) {
        onProgress(50, 'Executing tool...');
      }

      const result = await this.executeTool(toolName, parameters, context);

      if (onProgress) {
        onProgress(100, 'Tool execution completed');
      }

      return result;
    } catch (error) {
      if (onProgress) {
        onProgress(-1, `Tool execution failed: ${error}`);
      }
      throw error;
    }
  }

  /**
   * Dry-run tool execution (validate without executing)
   */
  async dryRunTool(
    toolName: string,
    parameters: Record<string, any>
  ): Promise<{
    valid: boolean;
    errors: string[];
    estimatedCost?: number;
  }> {
    const tool = this.toolDiscovery?.getTool(toolName);
    if (!tool) {
      return {
        valid: false,
        errors: [`Tool ${toolName} not found`],
      };
    }

    const validation = this.toolDiscovery!.validateToolParameters(toolName, parameters);

    return {
      valid: validation.valid,
      errors: validation.errors,
    };
  }

  /**
   * Export execution history for analysis
   */
  exportExecutionHistory(): any {
    return exportExecutionHistory(this.stats);
  }

  /**
   * Helper function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
