import { MCPAuthConfig } from './MCPAuthProvider';

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
}

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

/**
 * Discover OAuth metadata for an MCP server by:
 * 1. Making a request to the server and checking for 401 + WWW-Authenticate header
 * 2. Fetching protected resource metadata from .well-known
 * 3. Fetching auth server metadata from .well-known
 */
export async function discoverOAuthMetadata(
  serverUrl: string,
  clientName = 'armament'
): Promise<MCPAuthConfig['oauth2'] | null> {
  const baseUrl = new URL(serverUrl);
  const origin = baseUrl.origin;

  // Step 1: Try to fetch protected resource metadata
  let prm: ProtectedResourceMetadata | null = null;
  try {
    const prmUrl = `${origin}/.well-known/oauth-protected-resource`;
    const resp = await fetch(prmUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      prm = await resp.json() as ProtectedResourceMetadata;
    }
  } catch {}

  // Step 2: If no PRM, try hitting the MCP endpoint to get WWW-Authenticate
  if (!prm) {
    try {
      const resp = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 'discovery' }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 401) {
        const wwwAuth = resp.headers.get('www-authenticate') || '';
        const metaMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
        if (metaMatch) {
          const metaResp = await fetch(metaMatch[1], { signal: AbortSignal.timeout(5000) });
          if (metaResp.ok) {
            prm = await metaResp.json() as ProtectedResourceMetadata;
          }
        }
      }
    } catch {}
  }

  if (!prm || !prm.authorization_servers?.length) {
    // Fallback: try common OAuth endpoint pattern
    const fallbackAuthServer = `${origin}`;
    try {
      const oidcResp = await fetch(`${fallbackAuthServer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(5000),
      });
      if (oidcResp.ok) {
        const oidc = await oidcResp.json() as AuthServerMetadata;
        return {
          clientId: `${clientName}_${baseUrl.hostname.split('.')[0]}`,
          authUrl: oidc.authorization_endpoint,
          tokenUrl: oidc.token_endpoint,
          scopes: prm?.scopes_supported,
          resource: serverUrl,
          tokenStore: 'file',
        };
      }
    } catch {}
    return null;
  }

  // Step 3: Fetch auth server metadata
  const authServerBase = prm.authorization_servers[0];
  let asm: AuthServerMetadata | null = null;

  for (const wellKnown of [
    `${authServerBase}/.well-known/openid-configuration`,
    `${authServerBase}/.well-known/oauth-authorization-server`,
  ]) {
    try {
      const resp = await fetch(wellKnown, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        asm = await resp.json() as AuthServerMetadata;
        break;
      }
    } catch {}
  }

  if (!asm) return null;

  // Step 4: Try dynamic client registration if available
  let clientId = `${clientName}_${baseUrl.hostname.split('.')[0]}`;
  if (asm.registration_endpoint) {
    try {
      const regResp = await fetch(asm.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          redirect_uris: ['http://localhost/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (regResp.ok) {
        const reg = await regResp.json() as any;
        clientId = reg.client_id;
      }
    } catch {}
  }

  return {
    clientId,
    authUrl: asm.authorization_endpoint,
    tokenUrl: asm.token_endpoint,
    scopes: prm.scopes_supported || asm.scopes_supported,
    resource: prm.resource || serverUrl,
    tokenStore: 'file',
  };
}
