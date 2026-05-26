import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPHTTPTransport } from '../MCPHTTPTransport';
import http from 'node:http';

describe('MCPHTTPTransport', () => {
  let transport: MCPHTTPTransport;
  let mockServer: http.Server;
  let serverPort: number;

  beforeEach(async () => {
    // Start a local mock server for HTTP transport tests
    mockServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/tools' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ tools: [{ name: 'test_tool', description: 'A test tool' }] }));
      } else if (req.url === '/tools/read_file' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ tool: { name: 'read_file', inputSchema: {} } }));
      } else if (req.url === '/tools/read_file/execute' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200);
          res.end(JSON.stringify({ result: `Read ${parsed.arguments.path}` }));
        });
      } else if (req.url === '/resources' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ resources: [{ uri: 'file://test.md', name: 'test' }] }));
      } else if (req.url?.startsWith('/resources/') && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ content: '# Test Resource' }));
      } else if (req.url === '/error-500') {
        res.writeHead(500);
        res.end('Internal Server Error');
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        serverPort = (mockServer.address() as any).port;
        resolve();
      });
    });

    transport = new MCPHTTPTransport({
      baseUrl: `http://localhost:${serverPort}`,
      timeout: 5000,
      retries: 0,
    });
  });

  afterEach(async () => {
    await transport.close();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  describe('initialize()', () => {
    it('should set initialized flag', async () => {
      expect(transport.initialized).toBe(false);
      await transport.initialize();
      expect(transport.initialized).toBe(true);
    });

    it('should resolve without error when no auth configured', async () => {
      await expect(transport.initialize()).resolves.not.toThrow();
    });
  });

  describe('listTools()', () => {
    it('should GET tools list from server', async () => {
      const tools = await transport.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test_tool');
    });
  });

  describe('getTool(name)', () => {
    it('should GET a specific tool by name', async () => {
      const tool = await transport.getTool('read_file');
      expect(tool.name).toBe('read_file');
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe('executeTool(name, args)', () => {
    it('should POST tool execution request', async () => {
      const result = await transport.executeTool('read_file', { path: '/tmp/test.txt' });
      expect(result.result).toBe('Read /tmp/test.txt');
    });
  });

  describe('listResources()', () => {
    it('should GET resources list from server', async () => {
      const resources = await transport.listResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('file://test.md');
    });
  });

  describe('getResource(uri)', () => {
    it('should GET a specific resource by URI', async () => {
      const content = await transport.getResource('file://test.md');
      expect(content).toBe('# Test Resource');
    });
  });

  describe('close()', () => {
    it('should reset initialized flag', async () => {
      await transport.initialize();
      expect(transport.initialized).toBe(true);
      await transport.close();
      expect(transport.initialized).toBe(false);
    });
  });

  describe('authentication', () => {
    it('should add API key header to requests', async () => {
      let receivedHeaders: any = {};
      const authServer = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: [] }));
      });

      const authPort = await new Promise<number>((resolve) => {
        authServer.listen(0, () => resolve((authServer.address() as any).port));
      });

      const authTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${authPort}`,
        auth: { type: 'apikey', apiKey: { key: 'test-key-123', headerName: 'X-API-Key' } },
        retries: 0,
      });

      await authTransport.listTools();
      expect(receivedHeaders['x-api-key']).toBe('test-key-123');

      await authTransport.close();
      await new Promise<void>(resolve => authServer.close(() => resolve()));
    });

    it('should add Bearer token header to requests', async () => {
      let receivedHeaders: any = {};
      const authServer = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: [] }));
      });

      const authPort = await new Promise<number>((resolve) => {
        authServer.listen(0, () => resolve((authServer.address() as any).port));
      });

      const authTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${authPort}`,
        auth: { type: 'bearer', bearer: { token: 'my-jwt-token' } },
        retries: 0,
      });

      await authTransport.listTools();
      expect(receivedHeaders['authorization']).toBe('Bearer my-jwt-token');

      await authTransport.close();
      await new Promise<void>(resolve => authServer.close(() => resolve()));
    });

    it('should add Basic auth header to requests', async () => {
      let receivedHeaders: any = {};
      const authServer = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: [] }));
      });

      const authPort = await new Promise<number>((resolve) => {
        authServer.listen(0, () => resolve((authServer.address() as any).port));
      });

      const expected = Buffer.from('user:pass').toString('base64');
      const authTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${authPort}`,
        auth: { type: 'basic', basic: { username: 'user', password: 'pass' } },
        retries: 0,
      });

      await authTransport.listTools();
      expect(receivedHeaders['authorization']).toBe(`Basic ${expected}`);

      await authTransport.close();
      await new Promise<void>(resolve => authServer.close(() => resolve()));
    });
  });

  describe('error handling', () => {
    it('should throw on non-2xx responses', async () => {
      const badTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${serverPort}/error-500`,
        retries: 0,
      });
      // /error-500/tools → 404 (path mismatch)
      await expect(badTransport.listTools()).rejects.toThrow(/HTTP 404/);
    });

    it('should throw on connection refused', async () => {
      const deadTransport = new MCPHTTPTransport({
        baseUrl: 'http://localhost:1',
        timeout: 1000,
        retries: 0,
      });
      await expect(deadTransport.listTools()).rejects.toThrow();
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx errors', async () => {
      let attempts = 0;
      const retryServer = http.createServer((req, res) => {
        attempts++;
        if (attempts < 3) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'temporary' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tools: [{ name: 'recovered' }] }));
        }
      });

      const retryPort = await new Promise<number>((resolve) => {
        retryServer.listen(0, () => resolve((retryServer.address() as any).port));
      });

      const retryTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${retryPort}`,
        retries: 3,
        retryDelay: 10,
      });

      const tools = await retryTransport.listTools();
      expect(tools[0].name).toBe('recovered');
      expect(attempts).toBe(3);

      await retryTransport.close();
      await new Promise<void>(resolve => retryServer.close(() => resolve()));
    });

    it('should not retry on 4xx errors', async () => {
      let attempts = 0;
      const noRetryServer = http.createServer((req, res) => {
        attempts++;
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      });

      const noRetryPort = await new Promise<number>((resolve) => {
        noRetryServer.listen(0, () => resolve((noRetryServer.address() as any).port));
      });

      const noRetryTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${noRetryPort}`,
        retries: 3,
        retryDelay: 10,
      });

      await expect(noRetryTransport.listTools()).rejects.toThrow(/HTTP 400/);
      expect(attempts).toBe(1);

      await noRetryTransport.close();
      await new Promise<void>(resolve => noRetryServer.close(() => resolve()));
    });
  });

  describe('events', () => {
    it('should call onRequest and onResponse callbacks', async () => {
      const requests: string[] = [];
      const responses: number[] = [];

      const evTransport = new MCPHTTPTransport(
        { baseUrl: `http://localhost:${serverPort}`, retries: 0 },
        {
          onRequest: (method, path) => { requests.push(`${method} ${path}`); },
          onResponse: (_method, _path, status) => { responses.push(status); },
        }
      );

      await evTransport.listTools();
      expect(requests).toContain('GET /tools');
      expect(responses).toContain(200);

      await evTransport.close();
    });

    it('should call onError callback on failure', async () => {
      const errors: Error[] = [];
      const errTransport = new MCPHTTPTransport(
        { baseUrl: 'http://localhost:1', timeout: 500, retries: 0 },
        { onError: (_m, _p, err) => { errors.push(err); } }
      );

      await expect(errTransport.listTools()).rejects.toThrow();
      expect(errors.length).toBeGreaterThan(0);

      await errTransport.close();
    });
  });

  describe('custom headers', () => {
    it('should include extra headers in requests', async () => {
      let receivedHeaders: any = {};
      const headerServer = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: [] }));
      });

      const headerPort = await new Promise<number>((resolve) => {
        headerServer.listen(0, () => resolve((headerServer.address() as any).port));
      });

      const headerTransport = new MCPHTTPTransport({
        baseUrl: `http://localhost:${headerPort}`,
        headers: { 'X-Custom': 'my-value', 'X-Trace-Id': 'abc-123' },
        retries: 0,
      });

      await headerTransport.listTools();
      expect(receivedHeaders['x-custom']).toBe('my-value');
      expect(receivedHeaders['x-trace-id']).toBe('abc-123');

      await headerTransport.close();
      await new Promise<void>(resolve => headerServer.close(() => resolve()));
    });
  });
});
