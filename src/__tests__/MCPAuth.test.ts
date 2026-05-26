import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthProvider, MCPAuthProviderInstance } from '../auth/createAuthProvider';

// MCPAuthProvider is the auth provider for MCP server connections
// It handles token generation, refresh, and expiry management
type MCPAuthProvider = MCPAuthProviderInstance;

describe('MCPAuthProvider', () => {
  let authProvider: MCPAuthProvider;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      type: 'bearer',
      bearer: { token: 'initial-token' },
      tokenRefreshThreshold: 300, // seconds before expiry to trigger refresh
      tokenTTL: 3600, // 1 hour
    };
    // This will fail in red phase since the implementation doesn't exist yet
    authProvider = createAuthProvider(mockConfig);
  });

  describe('token generation', () => {
    it('should generate a valid auth token', async () => {
      const token = await authProvider.getToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should return consistent token on repeated calls within TTL', async () => {
      const token1 = await authProvider.getToken();
      const token2 = await authProvider.getToken();

      expect(token1).toBe(token2);
    });
  });

  describe('token refresh', () => {
    it('should refresh token before expiry', async () => {
      vi.useFakeTimers();

      const initialToken = await authProvider.getToken();

      // Advance time close to expiry (within threshold)
      vi.advanceTimersByTime((3600 - 200) * 1000);

      const refreshedToken = await authProvider.getToken();
      expect(refreshedToken).not.toBe(initialToken);

      vi.useRealTimers();
    });

    it('should call refreshToken to obtain new token', async () => {
      const newToken = await authProvider.refreshToken();

      expect(newToken).toBeDefined();
      expect(typeof newToken).toBe('string');
    });
  });

  describe('token expiry', () => {
    it('should report token as expired after TTL', () => {
      vi.useFakeTimers();

      // Initially not expired
      expect(authProvider.isExpired()).toBe(false);

      // Advance past TTL
      vi.advanceTimersByTime(3601 * 1000);

      expect(authProvider.isExpired()).toBe(true);

      vi.useRealTimers();
    });

    it('should trigger re-auth when token is expired', async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(3601 * 1000);

      // Should auto re-auth and return a fresh token
      const token = await authProvider.getToken();
      expect(token).toBeDefined();
      expect(authProvider.isExpired()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('auth failure', () => {
    it('should throw clear error on authentication failure', async () => {
      authProvider.invalidate();

      // With an invalidated provider, getToken should fail clearly
      await expect(authProvider.getToken()).rejects.toThrow(/auth|credential|invalid/i);
    });

    it('should throw clear error when refresh fails', async () => {
      // Simulate refresh failure scenario
      mockConfig.bearer.token = '';
      authProvider = createAuthProvider(mockConfig);

      await expect(authProvider.refreshToken()).rejects.toThrow(/refresh|failed|invalid/i);
    });
  });
});
