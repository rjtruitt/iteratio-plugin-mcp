/**
 * MCPResourceCatalog - Resource statistics and catalog export
 *
 * Provides analytics and documentation export for MCP resources.
 */

import { Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';

/**
 * Cached resource with metadata
 */
export interface CachedResource {
  /**
   * Resource URI
   */
  uri: string;

  /**
   * Server providing this resource
   */
  serverName: string;

  /**
   * Resource metadata
   */
  resource: Resource;

  /**
   * Cached content
   */
  content?: any;

  /**
   * When this resource was cached
   */
  cachedAt: Date;

  /**
   * TTL for this cache entry (in ms)
   */
  ttl?: number;
}

/**
 * Resource template with metadata
 */
export interface CachedTemplate {
  /**
   * Template URI
   */
  uri: string;

  /**
   * Server providing this template
   */
  serverName: string;

  /**
   * Template metadata
   */
  template: ResourceTemplate;

  /**
   * When this template was cached
   */
  cachedAt: Date;
}

/**
 * Resource statistics shape
 */
export interface ResourceStatistics {
  totalResources: number;
  cachedResources: number;
  totalTemplates: number;
  resourcesByServer: Record<string, number>;
  templatesByServer: Record<string, number>;
}

/**
 * Compute resource statistics from cache maps
 */
export function computeResourceStatistics(
  resourceCache: Map<string, CachedResource>,
  templateCache: Map<string, CachedTemplate>
): ResourceStatistics {
  const resourcesByServer: Record<string, number> = {};
  const templatesByServer: Record<string, number> = {};

  let cachedCount = 0;
  for (const cached of resourceCache.values()) {
    if (cached.content) {
      cachedCount++;
    }
    resourcesByServer[cached.serverName] = (resourcesByServer[cached.serverName] || 0) + 1;
  }

  for (const cached of templateCache.values()) {
    templatesByServer[cached.serverName] = (templatesByServer[cached.serverName] || 0) + 1;
  }

  return {
    totalResources: resourceCache.size,
    cachedResources: cachedCount,
    totalTemplates: templateCache.size,
    resourcesByServer,
    templatesByServer,
  };
}

/**
 * Export resource catalog for documentation
 */
export function exportResourceCatalog(
  resourceCache: Map<string, CachedResource>,
  templateCache: Map<string, CachedTemplate>
): any {
  const resources = Array.from(resourceCache.values()).map(cached => ({
    uri: cached.uri,
    serverName: cached.serverName,
    name: cached.resource.name,
    description: cached.resource.description,
    mimeType: cached.resource.mimeType,
    cached: !!cached.content,
  }));

  const templates = Array.from(templateCache.values()).map(cached => ({
    uriTemplate: cached.uri,
    serverName: cached.serverName,
    name: cached.template.name,
    description: cached.template.description,
    mimeType: cached.template.mimeType,
  }));

  return {
    resources,
    templates,
    statistics: computeResourceStatistics(resourceCache, templateCache),
  };
}
