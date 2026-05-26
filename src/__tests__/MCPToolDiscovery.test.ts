import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolDiscovery } from '../MCPToolDiscovery';
import { MCPServerManager } from '../MCPServerManager';

describe('MCPToolDiscovery', () => {
  let discovery: MCPToolDiscovery;
  let mockServerManager: any;
  let mockConfig: any;

  beforeEach(() => {
    mockServerManager = {
      getRunningServers: vi.fn().mockReturnValue(['server-a']),
      getClient: vi.fn().mockReturnValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
            { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
          ],
        }),
      }),
    };
    mockConfig = {
      toolNamePrefix: 'mcp_',
      includeServerNameInToolPrefix: true,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    discovery = new MCPToolDiscovery(mockServerManager, mockConfig);
  });

  describe('discover tools from connected server', () => {
    it('should discover tools from a single connected server', async () => {
      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      expect(tools.length).toBe(2);
    });

    it('should prefix tool names with server name', async () => {
      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      expect(tools[0].name).toBe('mcp_server-a_read_file');
      expect(tools[1].name).toBe('mcp_server-a_write_file');
    });

    it('should include tool descriptions', async () => {
      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      expect(tools[0].description).toBe('Read a file');
    });

    it('should include input schema as parameters', async () => {
      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      expect(tools[0].parameters).toBeDefined();
      expect(tools[0].parameters).toHaveProperty('path');
    });
  });

  describe('refresh tool list', () => {
    it('should update tools when server tools change', async () => {
      await discovery.discoverAllTools();
      expect(discovery.getDiscoveredTools()).toHaveLength(2);

      // Server now has a new tool
      mockServerManager.getClient.mockReturnValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
            { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
            { name: 'delete_file', description: 'Delete a file', inputSchema: { type: 'object' } },
          ],
        }),
      });

      await discovery.discoverAllTools();
      expect(discovery.getDiscoveredTools()).toHaveLength(3);
    });

    it('should remove tools that no longer exist on server', async () => {
      await discovery.discoverAllTools();
      expect(discovery.getDiscoveredTools()).toHaveLength(2);

      // Server now has fewer tools
      mockServerManager.getClient.mockReturnValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
          ],
        }),
      });

      await discovery.discoverAllTools();
      expect(discovery.getDiscoveredTools()).toHaveLength(1);
    });
  });

  describe('multiple servers', () => {
    it('should merge tool lists from multiple servers', async () => {
      mockServerManager.getRunningServers.mockReturnValue(['server-a', 'server-b']);
      mockServerManager.getClient.mockImplementation((name: string) => ({
        listTools: vi.fn().mockResolvedValue({
          tools: name === 'server-a'
            ? [{ name: 'tool_a', description: 'A tool', inputSchema: { type: 'object' } }]
            : [{ name: 'tool_b', description: 'B tool', inputSchema: { type: 'object' } }],
        }),
      }));

      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('mcp_server-a_tool_a');
      expect(tools.map(t => t.name)).toContain('mcp_server-b_tool_b');
    });

    it('should handle tool name conflicts between servers by prefixing with server name', async () => {
      mockServerManager.getRunningServers.mockReturnValue(['server-a', 'server-b']);
      mockServerManager.getClient.mockImplementation(() => ({
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'shared_tool', description: 'Shared', inputSchema: { type: 'object' } }],
        }),
      }));

      await discovery.discoverAllTools();

      const tools = discovery.getDiscoveredTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('mcp_server-a_shared_tool');
      expect(names).toContain('mcp_server-b_shared_tool');
      // No collision — both are present with different prefixes
      expect(tools).toHaveLength(2);
    });
  });

  describe('removeToolsFromServer', () => {
    it('should remove all tools associated with a server', async () => {
      mockServerManager.getRunningServers.mockReturnValue(['server-a', 'server-b']);
      mockServerManager.getClient.mockImplementation((name: string) => ({
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: `tool_${name}`, description: `Tool from ${name}`, inputSchema: { type: 'object' } }],
        }),
      }));

      await discovery.discoverAllTools();
      expect(discovery.getDiscoveredTools()).toHaveLength(2);

      discovery.removeToolsFromServer('server-a');
      expect(discovery.getDiscoveredTools()).toHaveLength(1);
      expect(discovery.getDiscoveredTools()[0].name).toContain('server-b');
    });
  });

  describe('error handling', () => {
    it('should gracefully handle server that fails to list tools', async () => {
      mockServerManager.getRunningServers.mockReturnValue(['good-server', 'bad-server']);
      mockServerManager.getClient.mockImplementation((name: string) => ({
        listTools: name === 'bad-server'
          ? vi.fn().mockRejectedValue(new Error('Connection lost'))
          : vi.fn().mockResolvedValue({ tools: [{ name: 'tool', description: '', inputSchema: { type: 'object' } }] }),
      }));

      await discovery.discoverAllTools();

      // Should still have tools from the good server
      const tools = discovery.getDiscoveredTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });
});
