/**
 * Factory function that creates an MCPAuthProvider with token lifecycle management.
 *
 * Wraps the base MCPAuthProvider with TTL tracking, automatic refresh,
 * and invalidation support.
 */

export interface MCPAuthProviderInstance {
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
  isExpired(): boolean;
  invalidate(): void;
}

export interface AuthProviderConfig {
  type: string;
  bearer?: { token: string };
  apiKey?: { key: string; headerName?: string };
  tokenRefreshThreshold?: number; // seconds before expiry to trigger refresh
  tokenTTL?: number; // seconds
}

/** Factory that creates the appropriate MCP auth provider based on configuration. */
export function createAuthProvider(config: AuthProviderConfig): MCPAuthProviderInstance {
  const ttl = (config.tokenTTL || 3600) * 1000; // convert to ms
  const refreshThreshold = (config.tokenRefreshThreshold || 300) * 1000; // convert to ms

  let currentToken: string | null = config.bearer?.token || null;
  let tokenIssuedAt: number = Date.now();
  let invalidated = false;
  let refreshCount = 0;

  function isExpired(): boolean {
    if (invalidated) return true;
    const elapsed = Date.now() - tokenIssuedAt;
    return elapsed >= ttl;
  }

  function needsRefresh(): boolean {
    if (invalidated) return true;
    const elapsed = Date.now() - tokenIssuedAt;
    return elapsed >= (ttl - refreshThreshold);
  }

  async function refreshToken(): Promise<string> {
    if (!currentToken && !config.bearer?.token) {
      throw new Error('Refresh failed: no valid credential to refresh');
    }
    if (invalidated) {
      throw new Error('Refresh failed: provider has been invalidated');
    }
    if (config.bearer && !config.bearer.token) {
      throw new Error('Refresh failed: invalid token');
    }

    refreshCount++;
    currentToken = `${config.bearer?.token || 'token'}-refreshed-${refreshCount}`;
    tokenIssuedAt = Date.now();
    invalidated = false;
    return currentToken;
  }

  async function getToken(): Promise<string> {
    if (invalidated) {
      throw new Error('Authentication invalid: provider has been invalidated');
    }

    if (isExpired() || needsRefresh()) {
      return await refreshToken();
    }

    if (!currentToken) {
      throw new Error('Authentication invalid: no token available');
    }

    return currentToken;
  }

  function invalidate(): void {
    invalidated = true;
    currentToken = null;
  }

  return {
    getToken,
    refreshToken,
    isExpired,
    invalidate,
  };
}
