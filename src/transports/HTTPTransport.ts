import { MCPAuthProvider, MCPAuthConfig, OAuthFlowListener } from '../auth/MCPAuthProvider';

export interface HTTPTransportConfig {
  baseUrl: string;
  auth?: MCPAuthConfig;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  keepAlive?: boolean;
  rejectUnauthorized?: boolean;
}

export interface HTTPTransportEvents {
  onAuthFlow?: OAuthFlowListener;
  onRequest?: (method: string, path: string) => void;
  onResponse?: (method: string, path: string, status: number) => void;
  onError?: (method: string, path: string, error: Error) => void;
}

/** Low-level HTTP transport layer for MCP server communication. */
export class HTTPTransport {
  private config: HTTPTransportConfig;
  private authProvider?: MCPAuthProvider;
  private events?: HTTPTransportEvents;
  private _initialized = false;

  constructor(config: HTTPTransportConfig, events?: HTTPTransportEvents) {
    this.config = config;
    this.events = events;

    if (config.auth) {
      this.authProvider = new MCPAuthProvider(config.auth);
      if (events?.onAuthFlow) {
        this.authProvider.onFlowEvent(events.onAuthFlow);
      }
    }
  }

  get initialized(): boolean { return this._initialized; }

  async initialize(): Promise<void> {
    if (this.authProvider) {
      await this.authProvider.getHeaders();
    }
    this._initialized = true;
  }

  async listTools(): Promise<any[]> {
    const response = await this.request('GET', '/tools');
    return response.tools || [];
  }

  async getTool(toolName: string): Promise<any> {
    const response = await this.request('GET', `/tools/${toolName}`);
    return response.tool;
  }

  async executeTool(toolName: string, args: any): Promise<any> {
    return this.request('POST', `/tools/${toolName}/execute`, { arguments: args });
  }

  async listResources(): Promise<any[]> {
    const response = await this.request('GET', '/resources');
    return response.resources || [];
  }

  async getResource(uri: string): Promise<any> {
    const response = await this.request('GET', `/resources/${encodeURIComponent(uri)}`);
    return response.content;
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
    retryCount = 0
  ): Promise<any> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.config.headers
    };

    if (this.authProvider) {
      const authHeaders = await this.authProvider.getHeaders();
      Object.assign(headers, authHeaders);
    }

    this.events?.onRequest?.(method, path);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout || 30_000)
      });

      this.events?.onResponse?.(method, path, response.status);

      if (!response.ok) {
        const err: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
        err.statusCode = response.status;
        throw err;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return { text: await response.text() };
    } catch (error: any) {
      this.events?.onError?.(method, path, error);

      const maxRetries = this.config.retries ?? 3;
      if (retryCount < maxRetries && this.isRetryable(error)) {
        const delay = this.config.retryDelay || 1000;
        await this.sleep(delay * Math.pow(2, retryCount));
        return this.request(method, path, body, retryCount + 1);
      }

      throw error;
    }
  }

  private isRetryable(error: any): boolean {
    const retryableCodes = [408, 429, 500, 502, 503, 504];
    return (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.name === 'TimeoutError' ||
      retryableCodes.includes(error.statusCode)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    this._initialized = false;
  }
}
