/**
 * MCPToolExecutorBatch - Batch/parallel execution and statistics
 *
 * Provides batch tool execution, progress tracking, dry-run, and stats export.
 */

import { ToolContext } from 'iteratio';

/**
 * Execution statistics
 */
export interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  toolStats: Map<string, {
    executions: number;
    successes: number;
    failures: number;
    totalTime: number;
  }>;
}

/**
 * Create a fresh ExecutionStats instance
 */
export function createExecutionStats(): ExecutionStats {
  return {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalExecutionTime: 0,
    averageExecutionTime: 0,
    toolStats: new Map(),
  };
}

/**
 * Update execution statistics after a tool run
 */
export function updateExecutionStats(
  stats: ExecutionStats,
  toolName: string,
  success: boolean,
  executionTime: number
): void {
  stats.totalExecutions++;
  if (success) {
    stats.successfulExecutions++;
  } else {
    stats.failedExecutions++;
  }
  stats.totalExecutionTime += executionTime;
  stats.averageExecutionTime = stats.totalExecutionTime / stats.totalExecutions;

  let toolStats = stats.toolStats.get(toolName);
  if (!toolStats) {
    toolStats = {
      executions: 0,
      successes: 0,
      failures: 0,
      totalTime: 0,
    };
    stats.toolStats.set(toolName, toolStats);
  }

  toolStats.executions++;
  if (success) {
    toolStats.successes++;
  } else {
    toolStats.failures++;
  }
  toolStats.totalTime += executionTime;
}

/**
 * Get statistics for a specific tool
 */
export function getToolStatistics(
  stats: ExecutionStats,
  toolName: string
): { executions: number; successRate: number; averageExecutionTime: number } | null {
  const toolStats = stats.toolStats.get(toolName);
  if (!toolStats) {
    return null;
  }

  return {
    executions: toolStats.executions,
    successRate: toolStats.successes / toolStats.executions,
    averageExecutionTime: toolStats.totalTime / toolStats.executions,
  };
}

/**
 * Export execution history for analysis
 */
export function exportExecutionHistory(stats: ExecutionStats): any {
  const toolStatsArray = Array.from(stats.toolStats.entries()).map(([name, s]) => ({
    toolName: name,
    ...s,
    successRate: s.successes / s.executions,
    averageExecutionTime: s.totalTime / s.executions,
  }));

  return {
    summary: {
      totalExecutions: stats.totalExecutions,
      successfulExecutions: stats.successfulExecutions,
      failedExecutions: stats.failedExecutions,
      successRate: stats.totalExecutions > 0
        ? stats.successfulExecutions / stats.totalExecutions
        : 0,
      averageExecutionTime: stats.averageExecutionTime,
    },
    toolStats: toolStatsArray,
  };
}

/**
 * Batch execution entry
 */
export interface BatchExecution {
  toolName: string;
  parameters: Record<string, any>;
  context: ToolContext;
}

/**
 * Batch execution result
 */
export interface BatchResult {
  success: boolean;
  result?: any;
  error?: Error;
}

/**
 * Execute multiple tools in parallel using a provided executor function
 */
export async function executeToolsInParallel(
  executions: BatchExecution[],
  executeFn: (toolName: string, parameters: Record<string, any>, context: ToolContext) => Promise<any>
): Promise<BatchResult[]> {
  const promises = executions.map(async ({ toolName, parameters, context }) => {
    try {
      const result = await executeFn(toolName, parameters, context);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  });

  return Promise.all(promises);
}

/**
 * Execute multiple tools in sequence using a provided executor function
 */
export async function executeToolsInSequence(
  executions: BatchExecution[],
  executeFn: (toolName: string, parameters: Record<string, any>, context: ToolContext) => Promise<any>
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const { toolName, parameters, context } of executions) {
    try {
      const result = await executeFn(toolName, parameters, context);
      results.push({ success: true, result });
    } catch (error) {
      results.push({ success: false, error: error as Error });
    }
  }

  return results;
}
