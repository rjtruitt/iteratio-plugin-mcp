import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MCPAuthProvider } from '../auth/MCPAuthProvider';
import type { MCPAuthConfig, OAuth2Result, OAuthFlowEvent } from '../auth/MCPAuthProvider';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('MCPAuthProvider', () => {
  describe('API Key Authentication', () => {
    let auth: MCPAuthProvider;

    beforeEach(() => {
      auth = new MCPAuthProvider({
        type: 'apikey',
        apiKey: { key: 'mcp-server-api-key-123', headerName: 'X-API-Key' },
      });
    });

    it('should return API key in configured header', async () => {
      const headers = await auth.getHeaders();
      expect(headers['X-API-Key']).toBe('mcp-server-api-key-123');
    });

    it('should default to X-API-Key header name', async () => {
      const auth2 = new MCPAuthProvider({ type: 'apikey', apiKey: { key: 'test-key' } });
      const headers = await auth2.getHeaders();
      expect(headers['X-API-Key']).toBe('test-key');
    });

    it('should support custom header name', async () => {
      const auth2 = new MCPAuthProvider({
        type: 'apikey',
        apiKey: { key: 'my-key', headerName: 'X-Custom-Auth' },
      });
      const headers = await auth2.getHeaders();
      expect(headers['X-Custom-Auth']).toBe('my-key');
    });

    it('should throw if apiKey config is missing', async () => {
      const badAuth = new MCPAuthProvider({ type: 'apikey' } as MCPAuthConfig);
      await expect(badAuth.getHeaders()).rejects.toThrow('API key config not provided');
    });
  });

  describe('Bearer Token Authentication', () => {
    it('should return Bearer token in Authorization header', async () => {
      const auth = new MCPAuthProvider({ type: 'bearer', bearer: { token: 'jwt-token-here' } });
      const headers = await auth.getHeaders();
      expect(headers['Authorization']).toBe('Bearer jwt-token-here');
    });

    it('should throw if bearer config is missing', async () => {
      const badAuth = new MCPAuthProvider({ type: 'bearer' } as MCPAuthConfig);
      await expect(badAuth.getHeaders()).rejects.toThrow('Bearer token config not provided');
    });

    it('should handle JWT tokens with dots', async () => {
      const auth = new MCPAuthProvider({
        type: 'bearer',
        bearer: { token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature' },
      });
      const headers = await auth.getHeaders();
      expect(headers['Authorization']).toContain('eyJhbGciOiJSUzI1NiJ9');
    });
  });

  describe('Basic Authentication', () => {
    it('should return Base64-encoded credentials', async () => {
      const auth = new MCPAuthProvider({
        type: 'basic',
        basic: { username: 'mcp-user', password: 'mcp-pass' },
      });
      const headers = await auth.getHeaders();
      const expected = Buffer.from('mcp-user:mcp-pass').toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${expected}`);
    });

    it('should handle special characters in password', async () => {
      const auth = new MCPAuthProvider({
        type: 'basic',
        basic: { username: 'user', password: 'p@ss:w0rd!' },
      });
      const headers = await auth.getHeaders();
      const expected = Buffer.from('user:p@ss:w0rd!').toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${expected}`);
    });

    it('should throw if basic config is missing', async () => {
      const badAuth = new MCPAuthProvider({ type: 'basic' } as MCPAuthConfig);
      await expect(badAuth.getHeaders()).rejects.toThrow('Basic auth config not provided');
    });
  });

  describe('Custom Headers Authentication', () => {
    it('should return all custom headers', async () => {
      const auth = new MCPAuthProvider({
        type: 'custom',
        custom: { headers: { 'X-Custom-Token': 'val', 'X-Tenant-ID': 'tenant-123' } },
      });
      const headers = await auth.getHeaders();
      expect(headers['X-Custom-Token']).toBe('val');
      expect(headers['X-Tenant-ID']).toBe('tenant-123');
    });

    it('should return empty object if custom.headers is empty', async () => {
      const auth = new MCPAuthProvider({ type: 'custom', custom: { headers: {} } });
      const headers = await auth.getHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('should return empty object if custom config is undefined', async () => {
      const auth = new MCPAuthProvider({ type: 'custom' } as MCPAuthConfig);
      const headers = await auth.getHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  describe('No Authentication', () => {
    it('should return empty headers for type=none', async () => {
      const auth = new MCPAuthProvider({ type: 'none' });
      const headers = await auth.getHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  describe('OAuth 2.0 - Error cases', () => {
    it('should throw if oauth2 config is missing', async () => {
      const auth = new MCPAuthProvider({ type: 'oauth2' } as MCPAuthConfig);
      await expect(auth.getHeaders()).rejects.toThrow('OAuth2 config not provided');
    });
  });

  describe('OAuth 2.0 - Full flow with mock token server', () => {
    let tokenServer: http.Server;
    let tokenPort: number;
    let callbackPort: number;

    beforeEach(async () => {
      // Mock token endpoint
      tokenServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const grantType = params.get('grant_type');

          if (grantType === 'authorization_code') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'test-access-token',
              refresh_token: 'test-refresh-token',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'repo read:org',
            }));
          } else if (grantType === 'refresh_token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'refreshed-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'repo read:org',
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
          }
        });
      });

      tokenPort = await new Promise<number>((resolve) => {
        tokenServer.listen(0, () => resolve((tokenServer.address() as any).port));
      });

      // Find a free port for the callback
      const tmpServer = http.createServer();
      callbackPort = await new Promise<number>((resolve) => {
        tmpServer.listen(0, () => {
          const port = (tmpServer.address() as any).port;
          tmpServer.close(() => resolve(port));
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>(resolve => tokenServer.close(() => resolve()));
    });

    it('should complete the full OAuth flow and return Bearer header', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          clientSecret: 'test-secret',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          scopes: ['repo'],
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));

      // Simulate: after getHeaders() opens callback server, send the auth code
      const headersPromise = auth.getHeaders();

      // Give the callback server time to start
      await new Promise(r => setTimeout(r, 100));

      // Simulate the OAuth redirect by hitting the callback
      const callbackResponse = await fetch(
        `http://localhost:${callbackPort}/callback?code=test-auth-code&state=` +
        // We need to extract the state from the auth_url event
        encodeURIComponent(extractState(events))
      );
      expect(callbackResponse.status).toBe(200);

      const headers = await headersPromise;
      expect(headers['Authorization']).toBe('Bearer test-access-token');

      // Verify events emitted
      expect(events.some(e => e.type === 'auth_url')).toBe(true);
      expect(events.some(e => e.type === 'waiting_for_callback')).toBe(true);
      expect(events.some(e => e.type === 'token_received')).toBe(true);
    });

    it('should use cached token for subsequent calls', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));

      // First call — triggers full flow
      const p = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));
      await fetch(`http://localhost:${callbackPort}/callback?code=c&state=${encodeURIComponent(extractState(events))}`);
      await p;

      // Second call — should use cached token, no new events
      const eventCountBefore = events.length;
      const headers2 = await auth.getHeaders();
      expect(headers2['Authorization']).toBe('Bearer test-access-token');
      expect(events.length).toBe(eventCountBefore);
    });

    it('should emit auth_url event with full URL including params', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'my-app',
          authUrl: 'https://provider.example.com/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          scopes: ['read', 'write'],
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));

      const p = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));

      const authUrlEvent = events.find(e => e.type === 'auth_url') as any;
      expect(authUrlEvent).toBeDefined();
      expect(authUrlEvent.url).toContain('client_id=my-app');
      expect(authUrlEvent.url).toContain('response_type=code');
      expect(authUrlEvent.url).toContain('code_challenge_method=S256');
      expect(authUrlEvent.url).toContain('scope=read+write');

      // Cleanup: send callback to unblock the flow
      await fetch(`http://localhost:${callbackPort}/callback?code=x&state=${encodeURIComponent(extractState(events))}`);
      await p;
    });

    it('should reject on state mismatch (CSRF protection)', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));

      const headersPromise = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));

      // Send wrong state
      await fetch(`http://localhost:${callbackPort}/callback?code=x&state=wrong-state`);

      await expect(headersPromise).rejects.toThrow('OAuth state mismatch');
    });

    it('should reject on error in callback', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      auth.onFlowEvent(() => {});
      const headersPromise = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));

      await fetch(`http://localhost:${callbackPort}/callback?error=access_denied`);
      await expect(headersPromise).rejects.toThrow('OAuth error: access_denied');
    });

    it('should reject when no code received', async () => {
      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));
      const headersPromise = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));

      // Correct state but no code param
      const state = extractState(events);
      await fetch(`http://localhost:${callbackPort}/callback?state=${encodeURIComponent(state)}`);
      await expect(headersPromise).rejects.toThrow('No authorization code');
    });

    it('should throw on token exchange failure', async () => {
      // Use a token server that returns 400
      const badTokenServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
        });
      });
      const badTokenPort = await new Promise<number>(resolve => {
        badTokenServer.listen(0, () => resolve((badTokenServer.address() as any).port));
      });

      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/authorize',
          tokenUrl: `http://localhost:${badTokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent((ev) => events.push(ev));
      const p = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));
      await fetch(`http://localhost:${callbackPort}/callback?code=x&state=${encodeURIComponent(extractState(events))}`);
      await expect(p).rejects.toThrow(/Token exchange failed/);

      await new Promise<void>(resolve => badTokenServer.close(() => resolve()));
    });
  });

  describe('OAuth 2.0 - Token storage (file)', () => {
    const tokenDir = join('/tmp', 'mcp-test-tokens-' + process.pid);
    const tokenPath = join(tokenDir, 'test-client.json');

    afterEach(async () => {
      try { await fs.rm(tokenDir, { recursive: true }); } catch {}
    });

    it('should store and reload token from file', async () => {
      let tokenPort: number;
      let callbackPort: number;

      const tokenServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'file-stored-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }));
        });
      });
      tokenPort = await new Promise<number>(resolve => {
        tokenServer.listen(0, () => resolve((tokenServer.address() as any).port));
      });

      const tmpServer = http.createServer();
      callbackPort = await new Promise<number>(resolve => {
        tmpServer.listen(0, () => {
          const p = (tmpServer.address() as any).port;
          tmpServer.close(() => resolve(p));
        });
      });

      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/auth',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'file',
          tokenPath,
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent(ev => events.push(ev));

      const p = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));
      await fetch(`http://localhost:${callbackPort}/callback?code=x&state=${encodeURIComponent(extractState(events))}`);
      await p;

      // Verify token was written to file
      const stored = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
      expect(stored.accessToken).toBe('file-stored-token');

      // New instance should load from file (no OAuth flow needed)
      const auth2 = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/auth',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'file',
          tokenPath,
        },
      });

      const headers2 = await auth2.getHeaders();
      expect(headers2['Authorization']).toBe('Bearer file-stored-token');

      await new Promise<void>(resolve => tokenServer.close(() => resolve()));
    });
  });

  describe('OAuth 2.0 - Token expiry and refresh', () => {
    it('should refresh expired token', async () => {
      let tokenPort: number;
      let callbackPort: number;
      let requestCount = 0;

      const tokenServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          requestCount++;
          const params = new URLSearchParams(body);
          if (params.get('grant_type') === 'refresh_token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'refreshed-token',
              refresh_token: 'new-refresh',
              expires_in: 3600,
              token_type: 'Bearer',
            }));
          } else {
            // Initial token with very short expiry (already expired)
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'initial-token',
              refresh_token: 'initial-refresh',
              expires_in: -1, // already expired
              token_type: 'Bearer',
            }));
          }
        });
      });
      tokenPort = await new Promise<number>(resolve => {
        tokenServer.listen(0, () => resolve((tokenServer.address() as any).port));
      });

      const tmpServer = http.createServer();
      callbackPort = await new Promise<number>(resolve => {
        tmpServer.listen(0, () => {
          const p = (tmpServer.address() as any).port;
          tmpServer.close(() => resolve(p));
        });
      });

      const auth = new MCPAuthProvider({
        type: 'oauth2',
        oauth2: {
          clientId: 'test-client',
          authUrl: 'http://localhost:9999/auth',
          tokenUrl: `http://localhost:${tokenPort}/token`,
          redirectUri: `http://localhost:${callbackPort}/callback`,
          tokenStore: 'memory',
        },
      });

      const events: OAuthFlowEvent[] = [];
      auth.onFlowEvent(ev => events.push(ev));

      // Initial flow
      const p = auth.getHeaders();
      await new Promise(r => setTimeout(r, 100));
      await fetch(`http://localhost:${callbackPort}/callback?code=x&state=${encodeURIComponent(extractState(events))}`);
      await p;

      // Token is already "expired" (expiresIn=-1 → expiresAt in the past)
      // Next call should trigger refresh
      const headers2 = await auth.getHeaders();
      expect(headers2['Authorization']).toBe('Bearer refreshed-token');
      expect(requestCount).toBe(2); // initial + refresh

      await new Promise<void>(resolve => tokenServer.close(() => resolve()));
    });
  });

  describe('MCP-Specific Auth Scenarios', () => {
    it('should handle Slack MCP server auth (bearer)', async () => {
      const auth = new MCPAuthProvider({
        type: 'bearer',
        bearer: { token: 'xoxb-slack-bot-token' },
      });
      const headers = await auth.getHeaders();
      expect(headers['Authorization']).toBe('Bearer xoxb-slack-bot-token');
    });

    it('should handle Glean MCP server auth (API key)', async () => {
      const auth = new MCPAuthProvider({
        type: 'apikey',
        apiKey: { key: 'glean-api-key-123', headerName: 'Authorization' },
      });
      const headers = await auth.getHeaders();
      expect(headers['Authorization']).toBe('glean-api-key-123');
    });

    it('should handle custom MCP server with mTLS-style headers', async () => {
      const auth = new MCPAuthProvider({
        type: 'custom',
        custom: {
          headers: {
            'X-Client-Cert-Fingerprint': 'sha256:abc123...',
            'X-Client-DN': 'CN=mcp-client,O=MyOrg',
          },
        },
      });
      const headers = await auth.getHeaders();
      expect(headers['X-Client-Cert-Fingerprint']).toBe('sha256:abc123...');
    });
  });

  describe('onFlowEvent', () => {
    it('should register and emit flow events', async () => {
      const events: OAuthFlowEvent[] = [];
      const auth = new MCPAuthProvider({ type: 'none' });
      auth.onFlowEvent(ev => events.push(ev));
      // No events for 'none' type
      await auth.getHeaders();
      expect(events).toHaveLength(0);
    });
  });
});

function extractState(events: OAuthFlowEvent[]): string {
  const authUrlEvent = events.find(e => e.type === 'auth_url') as any;
  if (!authUrlEvent) throw new Error('No auth_url event found');
  const url = new URL(authUrlEvent.url);
  return url.searchParams.get('state') || '';
}
