import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolExecutor } from '../MCPToolExecutor';
import { MCPServerManager } from '../MCPServerManager';

describe('MCPToolExecutor', () => {
  let executor: MCPToolExecutor;
  let mockServerManager: any;
  let mockConfig: any;
  let mockContext: any;

  beforeEach(() => {
    mockServerManager = {
      getClient: vi.fn().mockReturnValue({
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'result data' }],
          isError: false,
        }),
      }),
      getRunningServers: vi.fn().mockReturnValue(['test-server']),
    };
    mockConfig = {
      executionTimeout: 5000,
      maxRetries: 3,
      toolNamePrefix: 'mcp_',
      includeServerNameInToolPrefix: true,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    mockContext = {
      agentId: 'agent-1',
      turnNumber: 1,
      traceId: 'trace-abc',
    };
    executor = new MCPToolExecutor(mockServerManager, mockConfig);
  });

  describe('execute tool', () => {
    it('should execute a tool on the remote server', async () => {
      const result = await executor.executeTool(
        'mcp_test-server_read_file',
        { path: '/tmp/test.txt' },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });

    it('should pass parameters to the tool correctly', async () => {
      await executor.executeTool(
        'mcp_test-server_write_file',
        { path: '/tmp/out.txt', content: 'hello' },
        mockContext
      );

      const client = mockServerManager.getClient('test-server');
      expect(client.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'write_file',
          arguments: { path: '/tmp/out.txt', content: 'hello' },
        })
      );
    });

    it('should include execution metadata in result', async () => {
      const result = await executor.executeTool(
        'mcp_test-server_read_file',
        { path: '/tmp/test.txt' },
        mockContext
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata.serverName).toBe('test-server');
      expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata.retryAttempts).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle tool execution errors', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'File not found' }],
          isError: true,
        }),
      });

      const result = await executor.executeTool(
        'mcp_test-server_read_file',
        { path: '/nonexistent' },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('File not found');
    });

    it('should handle server connection error during execution', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockRejectedValue(new Error('Connection refused')),
      });

      const result = await executor.executeTool(
        'mcp_test-server_read_file',
        { path: '/tmp/test.txt' },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain('Connection refused');
    });

    it('should return error when tool not found on server', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockRejectedValue(new Error('Tool not found: unknown_tool')),
      });

      const result = await executor.executeTool(
        'mcp_test-server_unknown_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain('not found');
    });

    it('should return error when server name cannot be resolved from tool name', async () => {
      await expect(
        executor.executeTool('invalid_tool_name', {}, mockContext)
      ).rejects.toThrow(/server|resolve|not found/i);
    });
  });

  describe('timeout enforcement', () => {
    it('should timeout if execution exceeds configured timeout', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockImplementation(() =>
          new Promise((resolve) => setTimeout(resolve, 10000))
        ),
      });

      const result = await executor.executeTool(
        'mcp_test-server_slow_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.error!.message).toMatch(/timeout/i);
    });

    it('should use custom timeout when provided in context', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockImplementation(() =>
          new Promise((resolve) => setTimeout(resolve, 3000))
        ),
      });

      const contextWithTimeout = { ...mockContext, timeout: 1000 };
      const result = await executor.executeTool(
        'mcp_test-server_slow_tool',
        {},
        contextWithTimeout
      );

      expect(result.success).toBe(false);
      expect(result.error!.message).toMatch(/timeout/i);
    });
  });

  describe('auth token forwarding', () => {
    it('should forward auth token to the server', async () => {
      const contextWithAuth = { ...mockContext, authToken: 'bearer-xyz' };
      await executor.executeTool(
        'mcp_test-server_read_file',
        { path: '/secure/file' },
        contextWithAuth
      );

      const client = mockServerManager.getClient('test-server');
      expect(client.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          _meta: expect.objectContaining({ authToken: 'bearer-xyz' }),
        })
      );
    });
  });

  describe('large response handling', () => {
    it('should handle large tool responses without truncation', async () => {
      const largeContent = 'x'.repeat(1_000_000);
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: largeContent }],
          isError: false,
        }),
      });

      const result = await executor.executeTool(
        'mcp_test-server_big_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1_000_000);
    });

    it('should handle binary content in responses', async () => {
      const binaryBlob = Buffer.from([0x00, 0x01, 0x02, 0xFF]).toString('base64');
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'resource', resource: { blob: binaryBlob, mimeType: 'application/octet-stream' } }],
          isError: false,
        }),
      });

      const result = await executor.executeTool(
        'mcp_test-server_binary_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });
  });

  describe('Untested Methods', () => {
    it('executeToolsInParallel(tools[]) should execute multiple tools in parallel', async () => {
      const tools = [
        { toolName: 'mcp_test-server_tool_a', parameters: {}, context: mockContext },
        { toolName: 'mcp_test-server_tool_b', parameters: {}, context: mockContext },
        { toolName: 'mcp_test-server_tool_c', parameters: {}, context: mockContext },
      ];
      const results = await executor.executeToolsInParallel(tools);
      // Should return results for all tools, executed concurrently
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result).toHaveProperty('success');
      }
    });

    it('executeToolsInSequence(tools[]) should execute tools sequentially', async () => {
      const tools = [
        { toolName: 'mcp_test-server_tool_a', parameters: {}, context: mockContext },
        { toolName: 'mcp_test-server_tool_b', parameters: {}, context: mockContext },
      ];
      const results = await executor.executeToolsInSequence(tools);
      // Should execute each tool only after the previous completes
      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result).toHaveProperty('success');
      }
    });

    it('executeToolWithProgress(tool, onProgress) should call progress callback', async () => {
      const onProgress = vi.fn();
      await executor.executeToolWithProgress(
        'mcp_test-server_read_file',
        { path: '/tmp/test.txt' },
        mockContext,
        onProgress
      ).catch(() => {}); // May fail if tool not found, but progress should still be called
      // onProgress should have been called at least once
      expect(onProgress).toHaveBeenCalled();
    });

    it('dryRunTool(tool) should validate without executing', async () => {
      const result = await executor.dryRunTool(
        'mcp_test-server_read_file',
        { path: '/tmp/test.txt' }
      );
      // Should validate the tool call is well-formed without actual execution
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      // callTool should NOT have been called (dry run only validates)
      const client = mockServerManager.getClient('test-server');
      expect(client.callTool).not.toHaveBeenCalled();
    });
  });

  describe('retry behavior', () => {
    it('should retry on transient failure', async () => {
      const callTool = vi.fn()
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });

      mockServerManager.getClient.mockReturnValue({ callTool });

      const result = await executor.executeTool(
        'mcp_test-server_flaky_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.metadata.retryAttempts).toBe(2);
    });

    it('should fail after maxRetries exhausted', async () => {
      mockServerManager.getClient.mockReturnValue({
        callTool: vi.fn().mockRejectedValue(new Error('Permanent failure')),
      });

      const result = await executor.executeTool(
        'mcp_test-server_bad_tool',
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.metadata.retryAttempts).toBe(3);
    });
  });
});
