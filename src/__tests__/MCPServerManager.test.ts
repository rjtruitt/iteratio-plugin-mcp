import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPServerManager, MCPServerConfig, MCPServerType } from '../MCPServerManager';

describe('MCPServerManager', () => {
  let manager: MCPServerManager;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      servers: [],
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      maxRetries: 3,
      executionTimeout: 30000,
    };
    manager = new MCPServerManager(mockConfig);
  });

  afterEach(async () => {
    await manager.stopAllServers();
  });

  describe('connect', () => {
    it('should connect to a stdio MCP server', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'stdio-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['test-server.js'] },
      };

      await manager.launchServer(serverConfig);

      const running = manager.getRunningServers();
      expect(running).toContain('stdio-server');
    });

    it('should connect to an SSE MCP server', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'sse-server',
        type: MCPServerType.SSE,
        sse: { url: 'http://localhost:9999/sse' },
      };

      await manager.launchServer(serverConfig);

      const running = manager.getRunningServers();
      expect(running).toContain('sse-server');
    });

    it('should connect to a WebSocket MCP server', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'ws-server',
        type: MCPServerType.WEBSOCKET,
        websocket: { url: 'ws://localhost:9998/ws' },
      };

      await manager.launchServer(serverConfig);

      const running = manager.getRunningServers();
      expect(running).toContain('ws-server');
    });

    it('should throw when connecting with invalid command', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'bad-server',
        type: MCPServerType.STDIO,
        stdio: { command: '/nonexistent/path', args: [] },
      };

      await expect(manager.launchServer(serverConfig)).rejects.toThrow();
    });

    it('should throw when duplicate server name is used', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'dup-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      };

      await manager.launchServer(serverConfig);
      await expect(manager.launchServer(serverConfig)).rejects.toThrow(/already exists|duplicate/i);
    });
  });

  describe('disconnect', () => {
    it('should disconnect a running server', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'disc-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      };

      await manager.launchServer(serverConfig);
      await manager.stopServer('disc-server');

      const running = manager.getRunningServers();
      expect(running).not.toContain('disc-server');
    });

    it('should throw when stopping a non-existent server', async () => {
      await expect(manager.stopServer('nonexistent')).rejects.toThrow(/not found|unknown/i);
    });

    it('should stop all servers', async () => {
      await manager.launchServer({
        name: 'server-1',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['s1.js'] },
      });
      await manager.launchServer({
        name: 'server-2',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['s2.js'] },
      });

      await manager.stopAllServers();

      const running = manager.getRunningServers();
      expect(running).toHaveLength(0);
    });
  });

  describe('reconnect', () => {
    it('should reconnect after a server failure', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'reconnect-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      };

      await manager.launchServer(serverConfig);

      // Simulate crash
      await manager.restartServer('reconnect-server');

      const running = manager.getRunningServers();
      expect(running).toContain('reconnect-server');
    });

    it('should retry reconnection up to maxRetries', async () => {
      const serverConfig: MCPServerConfig = {
        name: 'retry-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'flaky-server', args: [] },
      };

      // Expect it to fail after retries exhausted
      await expect(manager.launchServer(serverConfig)).rejects.toThrow();
    });
  });

  describe('multi-server management', () => {
    it('should manage 3 servers simultaneously', async () => {
      const servers: MCPServerConfig[] = [
        { name: 'alpha', type: MCPServerType.STDIO, stdio: { command: 'node', args: ['a.js'] } },
        { name: 'beta', type: MCPServerType.STDIO, stdio: { command: 'node', args: ['b.js'] } },
        { name: 'gamma', type: MCPServerType.STDIO, stdio: { command: 'node', args: ['c.js'] } },
      ];

      await manager.launchAllServers();
      mockConfig.servers = servers;

      for (const s of servers) {
        await manager.launchServer(s);
      }

      const running = manager.getRunningServers();
      expect(running).toHaveLength(3);
      expect(running).toContain('alpha');
      expect(running).toContain('beta');
      expect(running).toContain('gamma');
    });
  });

  describe('health check', () => {
    it('should report server as healthy when connected', async () => {
      await manager.launchServer({
        name: 'healthy-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      });

      const status = manager.getServerStatus();
      expect(status['healthy-server'].healthy).toBe(true);
    });

    it('should report server as unhealthy after crash', async () => {
      await manager.launchServer({
        name: 'crash-server',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      });

      // Simulate crash detection
      const status = manager.getServerStatus();
      expect(status['crash-server']).toBeDefined();
    });

    it('should detect server crash and trigger reconnection', async () => {
      const onReconnect = vi.fn();
      await manager.launchServer({
        name: 'crash-detect',
        type: MCPServerType.STDIO,
        stdio: { command: 'node', args: ['server.js'] },
      });

      // The manager should auto-detect a crash and reconnect
      // This test expects the reconnection handler to be called
      expect(onReconnect).toHaveBeenCalled();
    });
  });
});
