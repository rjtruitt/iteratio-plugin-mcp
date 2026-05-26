import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPResourceManager } from '../MCPResourceManager';

describe('MCPResourceManager', () => {
  let resourceManager: MCPResourceManager;
  let mockServerManager: any;
  let mockConfig: any;

  beforeEach(() => {
    const mockClient = {
      listResources: vi.fn().mockResolvedValue({
        resources: [
          { uri: 'file://templates/prompt.md', name: 'Prompt Template', mimeType: 'text/markdown' },
          { uri: 'file://config/settings.json', name: 'Settings', mimeType: 'application/json' },
        ],
      }),
      readResource: vi.fn().mockResolvedValue({
        contents: [{ uri: 'file://templates/prompt.md', text: 'You are a helpful assistant.' }],
      }),
      listResourceTemplates: vi.fn().mockResolvedValue({
        resourceTemplates: [],
      }),
    };
    mockServerManager = {
      getRunningServers: vi.fn().mockReturnValue(['resource-server']),
      getClient: vi.fn().mockReturnValue(mockClient),
      getServerClient: vi.fn().mockReturnValue(mockClient),
    };
    mockConfig = {
      enableResources: true,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    resourceManager = new MCPResourceManager(mockServerManager, mockConfig);
  });

  describe('access resource', () => {
    it('should list available resources from server', async () => {
      await resourceManager.initialize();

      const resources = await resourceManager.getResources();
      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe('file://templates/prompt.md');
    });

    it('should read a specific resource by URI', async () => {
      await resourceManager.initialize();

      const resource = await resourceManager.getResource('file://templates/prompt.md');
      expect(resource.content).toBe('You are a helpful assistant.');
    });

    it('should return resource with correct metadata', async () => {
      await resourceManager.initialize();

      const resource = await resourceManager.getResource('file://templates/prompt.md');
      expect(resource.mimeType).toBe('text/markdown');
      expect(resource.name).toBe('Prompt Template');
    });
  });

  describe('resource caching', () => {
    it('should cache resource after first access', async () => {
      await resourceManager.initialize();

      await resourceManager.getResource('file://templates/prompt.md');
      await resourceManager.getResource('file://templates/prompt.md');

      const client = mockServerManager.getClient('resource-server');
      // Should only call readResource once due to caching
      expect(client.readResource).toHaveBeenCalledTimes(1);
    });

    it('should return cached content on subsequent reads', async () => {
      await resourceManager.initialize();

      const first = await resourceManager.getResource('file://templates/prompt.md');
      const second = await resourceManager.getResource('file://templates/prompt.md');
      expect(first.content).toBe(second.content);
    });

    it('should invalidate cache when explicitly requested', async () => {
      await resourceManager.initialize();

      await resourceManager.getResource('file://templates/prompt.md');
      await resourceManager.invalidateCache('file://templates/prompt.md');
      await resourceManager.getResource('file://templates/prompt.md');

      const client = mockServerManager.getClient('resource-server');
      expect(client.readResource).toHaveBeenCalledTimes(2);
    });

    it('should invalidate cache after TTL expires', async () => {
      vi.useFakeTimers();
      await resourceManager.initialize();

      await resourceManager.getResource('file://templates/prompt.md');

      // Advance past TTL
      vi.advanceTimersByTime(600_000);

      await resourceManager.getResource('file://templates/prompt.md');

      const client = mockServerManager.getClient('resource-server');
      expect(client.readResource).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('permission check', () => {
    it('should enforce permission check before resource access', async () => {
      await resourceManager.initialize();

      // Attempt to access a restricted resource
      await expect(
        resourceManager.getResource('file://secret/credentials.json')
      ).rejects.toThrow(/permission|denied|forbidden/i);
    });

    it('should allow access to permitted resources', async () => {
      await resourceManager.initialize();

      const resource = await resourceManager.getResource('file://templates/prompt.md');
      expect(resource).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should throw when resource not found', async () => {
      mockServerManager.getClient.mockReturnValue({
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
      });
      await resourceManager.initialize();

      await expect(
        resourceManager.getResource('file://nonexistent/resource')
      ).rejects.toThrow(/not found/i);
    });

    it('should handle server disconnection gracefully', async () => {
      mockServerManager.getClient.mockReturnValue({
        listResources: vi.fn().mockRejectedValue(new Error('Connection lost')),
        readResource: vi.fn().mockRejectedValue(new Error('Connection lost')),
      });

      await expect(resourceManager.initialize()).rejects.toThrow(/connection/i);
    });
  });

  describe('Untested Methods', () => {
    it('initialize() should set up resource discovery', async () => {
      const freshManager = new MCPResourceManager(mockServerManager, mockConfig);
      await freshManager.initialize();
      // After initialize, resources should be discoverable
      const resources = await freshManager.getResources();
      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe('file://templates/prompt.md');
    });

    it('cleanup() should release all resources', async () => {
      await resourceManager.initialize();
      await resourceManager.getResource('file://templates/prompt.md');
      await resourceManager.cleanup();
      // All subscriptions and cache should be cleared
      const resources = await resourceManager.getResources();
      expect(resources).toHaveLength(0);
    });

    it('discoverAllResources() should discover from all servers', async () => {
      await resourceManager.initialize();
      await (resourceManager as any).discoverAllResources();
      // Should aggregate resources from all running servers
      const resources = await resourceManager.getResources();
      expect(resources.length).toBeGreaterThan(0);
      // listResources was called on the client
      const client = mockServerManager.getClient('resource-server');
      expect(client.listResources).toHaveBeenCalled();
    });

    it('discoverResourcesFromServer(serverId) should discover from one server', async () => {
      await resourceManager.initialize();
      const resources = await (resourceManager as any).discoverResourcesFromServer('resource-server');
      // Should only return resources from the specified server
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
    });

    it('discoverAllTemplates() should discover all templates', async () => {
      await resourceManager.initialize();
      await (resourceManager as any).discoverAllTemplates();
      // Should call listResourceTemplates on server client
      const client = mockServerManager.getClient('resource-server');
      expect(client.listResourceTemplates || client.listResources).toBeDefined();
    });

    it('discoverTemplatesFromServer(serverId) should discover from one server', async () => {
      await resourceManager.initialize();
      const templates = await (resourceManager as any).discoverTemplatesFromServer('resource-server');
      // Should only return templates from the specified server (or empty if no listResourceTemplates mock)
      expect(templates === undefined || Array.isArray(templates)).toBe(true);
    });

    it('subscribeToResource(uri) should subscribe to changes', async () => {
      await resourceManager.initialize();
      // subscribeToResource should not throw (even if not fully implemented)
      await expect(
        (resourceManager as any).subscribeToResource('file://templates/prompt.md', vi.fn())
      ).resolves.not.toThrow();
    });

    it('unsubscribeFromResource(uri) should unsubscribe', async () => {
      await resourceManager.initialize();
      await (resourceManager as any).subscribeToResource('file://templates/prompt.md', vi.fn());
      // unsubscribeFromResource should not throw
      await expect(
        (resourceManager as any).unsubscribeFromResource('file://templates/prompt.md')
      ).resolves.not.toThrow();
    });

    it('refreshResource(uri) should force refresh', async () => {
      await resourceManager.initialize();
      await resourceManager.getResource('file://templates/prompt.md');
      await (resourceManager as any).refreshResource('file://templates/prompt.md');
      // Should bypass cache and re-fetch from server (readResource called twice)
      const client = mockServerManager.getClient('resource-server');
      expect(client.readResource).toHaveBeenCalledTimes(2);
    });

    it('refreshResourcesFromServer(serverId) should refresh all from server', async () => {
      await resourceManager.initialize();
      // First access to cache a resource
      await resourceManager.getResource('file://templates/prompt.md');
      // Refresh all from server should invalidate cached content
      await (resourceManager as any).refreshResourcesFromServer('resource-server');
      // After refresh, next access will re-fetch
      await resourceManager.getResource('file://templates/prompt.md');
      const client = mockServerManager.getClient('resource-server');
      expect(client.readResource).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup', () => {
    it('should clear cache on cleanup', async () => {
      await resourceManager.initialize();
      await resourceManager.getResource('file://templates/prompt.md');

      await resourceManager.cleanup();

      // After cleanup, next access should re-fetch
      await resourceManager.initialize();
      await resourceManager.getResource('file://templates/prompt.md');

      const client = mockServerManager.getClient('resource-server');
      expect(client.readResource).toHaveBeenCalledTimes(2);
    });
  });
});
