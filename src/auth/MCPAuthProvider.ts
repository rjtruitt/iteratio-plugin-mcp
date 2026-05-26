import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface MCPAuthConfig {
  type: 'oauth2' | 'apikey' | 'bearer' | 'basic' | 'custom' | 'none';

  oauth2?: {
    clientId: string;
    clientSecret?: string;
    authUrl: string;
    tokenUrl: string;
    scopes?: string[];
    resource?: string;
    tokenStore?: 'memory' | 'file' | 'keychain';
    tokenPath?: string;
  };

  apiKey?: {
    key: string;
    headerName?: string;
  };

  bearer?: {
    token: string;
  };

  basic?: {
    username: string;
    password: string;
  };

  custom?: {
    headers: Record<string, string>;
  };
}

export interface OAuth2Result {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

export type OAuthFlowEvent =
  | { type: 'auth_url'; url: string }
  | { type: 'waiting_for_callback' }
  | { type: 'token_received' }
  | { type: 'error'; message: string };

export type OAuthFlowListener = (event: OAuthFlowEvent) => void;

/** Authentication provider for MCP server connections with credential management. */
export class MCPAuthProvider {
  private config: MCPAuthConfig;
  private cachedToken?: OAuth2Result;
  private _flowListener?: OAuthFlowListener;

  constructor(config: MCPAuthConfig) {
    this.config = config;
  }

  onFlowEvent(listener: OAuthFlowListener): void {
    this._flowListener = listener;
  }

  private emitFlowEvent(event: OAuthFlowEvent): void {
    this._flowListener?.(event);
  }

  async getHeaders(): Promise<Record<string, string>> {
    switch (this.config.type) {
      case 'oauth2':
        return await this.getOAuth2Headers();
      case 'apikey':
        return this.getAPIKeyHeaders();
      case 'bearer':
        return this.getBearerHeaders();
      case 'basic':
        return this.getBasicHeaders();
      case 'custom':
        return this.config.custom?.headers || {};
      case 'none':
      default:
        return {};
    }
  }

  private async getOAuth2Headers(): Promise<Record<string, string>> {
    if (!this.config.oauth2) {
      throw new Error('OAuth2 config not provided');
    }

    if (!this.cachedToken) {
      this.cachedToken = await this.loadToken() ?? undefined;
    }

    if (this.cachedToken) {
      if (this.isTokenExpired(this.cachedToken)) {
        if (this.cachedToken.refreshToken) {
          this.cachedToken = await this.refreshOAuthToken();
          await this.storeToken(this.cachedToken);
        } else {
          this.cachedToken = undefined;
        }
      }

      if (this.cachedToken) {
        return { 'Authorization': `Bearer ${this.cachedToken.accessToken}` };
      }
    }

    const token = await this.performOAuth2Flow();
    this.cachedToken = token;
    await this.storeToken(token);
    return { 'Authorization': `Bearer ${token.accessToken}` };
  }

  private isTokenExpired(token: OAuth2Result): boolean {
    if (!token.expiresAt) return false;
    // Refresh 60s before actual expiry
    return Date.now() >= (token.expiresAt - 60_000);
  }

  private async performOAuth2Flow(): Promise<OAuth2Result> {
    if (!this.config.oauth2) {
      throw new Error('OAuth2 config not provided');
    }

    const { clientId, clientSecret, authUrl, tokenUrl, scopes, resource } = this.config.oauth2;

    const state = this.generateRandomString(32);
    const codeVerifier = this.generateRandomString(64);
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Start callback server first to get the assigned port
    const callbackPromise = this.waitForCallback(state);
    // Give the server a tick to bind
    await new Promise(r => setTimeout(r, 50));

    const redirectUri = `http://localhost:${this._callbackPort}/callback`;

    const authParams = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent',
    });
    if (scopes?.length) authParams.set('scope', scopes.join(' '));
    if (resource) authParams.set('resource', resource);

    const fullAuthUrl = `${authUrl}?${authParams.toString()}`;

    this.emitFlowEvent({ type: 'auth_url', url: fullAuthUrl });
    this.emitFlowEvent({ type: 'waiting_for_callback' });

    const authCode = await callbackPromise;

    const tokenResponse = await this.exchangeCodeForToken(
      authCode, codeVerifier, clientId, clientSecret, tokenUrl, redirectUri
    );

    this.emitFlowEvent({ type: 'token_received' });
    return tokenResponse;
  }

  private _callbackPort = 0;

  get callbackPort(): number { return this._callbackPort; }

  private async waitForCallback(expectedState: string): Promise<string> {
    const http = await import('node:http');
    const pathname = '/callback';

    return new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (!req.url?.startsWith(pathname)) {
          res.writeHead(404);
          res.end();
          return;
        }

        const callbackUrl = new URL(req.url, `http://localhost:${this._callbackPort}`);
        const code = callbackUrl.searchParams.get('code');
        const state = callbackUrl.searchParams.get('state');
        const error = callbackUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authorization failed: ${error}</h1><p>You can close this window.</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>State mismatch — possible CSRF attack</h1><p>You can close this window.</p>');
          server.close();
          reject(new Error('OAuth state mismatch'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>No authorization code received</h1><p>You can close this window.</p>');
          server.close();
          reject(new Error('No authorization code'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>');
        server.close();
        resolve(code);
      });

      // Listen on port 0 to get a random available port
      server.listen(0, () => {
        const addr = server.address();
        this._callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      });

      setTimeout(() => {
        server.close();
        reject(new Error('OAuth flow timed out (5 minutes)'));
      }, 300_000);
    });
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    clientId: string,
    clientSecret: string | undefined,
    tokenUrl: string,
    redirectUri: string | undefined
  ): Promise<OAuth2Result> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri || 'http://localhost:3000/callback'
    });

    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope
    };
  }

  private async refreshOAuthToken(): Promise<OAuth2Result> {
    if (!this.config.oauth2) {
      throw new Error('OAuth2 config not provided');
    }
    if (!this.cachedToken?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const { clientId, clientSecret, tokenUrl } = this.config.oauth2;

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.cachedToken.refreshToken,
      client_id: clientId,
    });

    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.cachedToken.refreshToken,
      expiresIn: data.expires_in,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope
    };
  }

  private async storeToken(token: OAuth2Result): Promise<void> {
    const store = this.config.oauth2?.tokenStore || 'memory';

    switch (store) {
      case 'file': {
        const tokenPath = this.resolveTokenPath();
        await fs.mkdir(dirname(tokenPath), { recursive: true });
        await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
        break;
      }
      case 'keychain':
        // keytar integration deferred — falls back to file
        break;
      case 'memory':
      default:
        break;
    }
  }

  private async loadToken(): Promise<OAuth2Result | null> {
    const store = this.config.oauth2?.tokenStore || 'memory';

    if (store === 'file') {
      const tokenPath = this.resolveTokenPath();
      try {
        const data = await fs.readFile(tokenPath, 'utf-8');
        return JSON.parse(data) as OAuth2Result;
      } catch {
        return null;
      }
    }

    return null;
  }

  private resolveTokenPath(): string {
    if (this.config.oauth2?.tokenPath) {
      const p = this.config.oauth2.tokenPath;
      return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
    }
    const clientId = this.config.oauth2?.clientId || 'default';
    return join(homedir(), '.mcp', 'tokens', `${clientId}.json`);
  }

  private getAPIKeyHeaders(): Record<string, string> {
    if (!this.config.apiKey) {
      throw new Error('API key config not provided');
    }
    const headerName = this.config.apiKey.headerName || 'X-API-Key';
    return { [headerName]: this.config.apiKey.key };
  }

  private getBearerHeaders(): Record<string, string> {
    if (!this.config.bearer) {
      throw new Error('Bearer token config not provided');
    }
    return { 'Authorization': `Bearer ${this.config.bearer.token}` };
  }

  private getBasicHeaders(): Record<string, string> {
    if (!this.config.basic) {
      throw new Error('Basic auth config not provided');
    }
    const { username, password } = this.config.basic;
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return { 'Authorization': `Basic ${encoded}` };
  }

  private generateRandomString(length: number): string {
    return randomBytes(length).toString('base64url').slice(0, length);
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }
}
