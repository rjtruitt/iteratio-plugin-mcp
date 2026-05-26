/**
 * MCPResourceManager - Manages MCP resources (prompts, templates, etc.)
 *
 * MCP servers can provide resources like:
 * - Prompt templates
 * - Code snippets
 * - Configuration files
 * - Documentation
 * - Any URI-addressable content
 */

import { MCPServerManager } from './MCPServerManager';
import { Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import {
  CachedResource,
  CachedTemplate,
  ResourceStatistics,
  computeResourceStatistics,
  exportResourceCatalog,
} from './MCPResourceCatalog';

/** Manages MCP resources including listing, reading, and subscribing to resource updates. */
export class MCPResourceManager {
  private serverManager: MCPServerManager;
  private config: any;
  private resourceCache: Map<string, CachedResource> = new Map();
  private templateCache: Map<string, CachedTemplate> = new Map();
  private cacheCleanupInterval?: NodeJS.Timeout;

  constructor(serverManager: MCPServerManager, config: any) {
    this.serverManager = serverManager;
    this.config = config;
  }

  /**
   * Initialize the resource manager
   */
  async initialize(): Promise<void> {
    this.config.logger.info('Initializing MCP resource manager...');

    try {
      await this.discoverAllResources();
      await this.discoverAllTemplates();
      this.setupCacheCleanup();
      this.config.logger.info('MCP resource manager initialized');
    } catch (error) {
      this.config.logger.error('Failed to initialize resource manager:', error);
      throw error;
    }
  }

  /**
   * Cleanup the resource manager
   */
  async cleanup(): Promise<void> {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }

    this.resourceCache.clear();
    this.templateCache.clear();
  }

  /**
   * Discover resources from all running servers
   */
  async discoverAllResources(): Promise<void> {
    const runningServers = this.serverManager.getRunningServers();

    const discoveryPromises = runningServers.map(serverName =>
      this.discoverResourcesFromServer(serverName).catch(error => {
        this.config.logger.error(`Failed to discover resources from ${serverName}:`, error);
        return [];
      })
    );

    await Promise.all(discoveryPromises);
  }

  /**
   * Discover resources from a specific server
   */
  async discoverResourcesFromServer(serverName: string): Promise<Resource[]> {
    this.config.logger.debug(`Discovering resources from server: ${serverName}`);

    try {
      const client = this.serverManager.getServerClient(serverName);
      const response = await client.listResources();

      const resources = response.resources || [];
      this.config.logger.debug(`Server ${serverName} reported ${resources.length} resources`);

      for (const resource of resources) {
        this.cacheResourceMetadata(serverName, resource);
      }

      return resources;
    } catch (error) {
      this.config.logger.error(`Failed to discover resources from ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Discover templates from all running servers
   */
  async discoverAllTemplates(): Promise<void> {
    const runningServers = this.serverManager.getRunningServers();

    const discoveryPromises = runningServers.map(serverName =>
      this.discoverTemplatesFromServer(serverName).catch(error => {
        this.config.logger.error(`Failed to discover templates from ${serverName}:`, error);
        return [];
      })
    );

    await Promise.all(discoveryPromises);
  }

  /**
   * Discover templates from a specific server
   */
  async discoverTemplatesFromServer(serverName: string): Promise<ResourceTemplate[]> {
    this.config.logger.debug(`Discovering templates from server: ${serverName}`);

    try {
      const client = this.serverManager.getServerClient(serverName);
      const response = await client.listResourceTemplates();

      const templates = response.resourceTemplates || [];
      this.config.logger.debug(`Server ${serverName} reported ${templates.length} templates`);

      for (const template of templates) {
        this.cacheTemplateMetadata(serverName, template);
      }

      return templates;
    } catch (error) {
      this.config.logger.error(`Failed to discover templates from ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Get a resource by URI
   */
  async getResource(uri: string): Promise<any> {
    const cached = this.resourceCache.get(uri);
    if (cached && this.isCacheValid(cached)) {
      this.config.logger.debug(`Resource ${uri} found in cache`);
      return cached.content;
    }

    if (!cached) {
      throw new Error(`Resource ${uri} not found`);
    }

    this.config.logger.debug(`Fetching resource ${uri} from server ${cached.serverName}`);

    try {
      const client = this.serverManager.getServerClient(cached.serverName);
      const response = await client.readResource({ uri });

      const content = response.contents;
      cached.content = content;
      cached.cachedAt = new Date();

      return content;
    } catch (error) {
      this.config.logger.error(`Failed to fetch resource ${uri}:`, error);
      throw error;
    }
  }

  /**
   * Get all available resources
   */
  getResources(): CachedResource[] {
    return Array.from(this.resourceCache.values());
  }

  /**
   * Get resources from a specific server
   */
  getResourcesFromServer(serverName: string): CachedResource[] {
    return Array.from(this.resourceCache.values()).filter(
      resource => resource.serverName === serverName
    );
  }

  /**
   * Search resources by pattern
   */
  searchResources(pattern: string | RegExp): CachedResource[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return Array.from(this.resourceCache.values()).filter(cached =>
      regex.test(cached.uri) ||
      regex.test(cached.resource.name || '') ||
      regex.test(cached.resource.description || '')
    );
  }

  /**
   * Get all available templates
   */
  getTemplates(): CachedTemplate[] {
    return Array.from(this.templateCache.values());
  }

  /**
   * Get templates from a specific server
   */
  getTemplatesFromServer(serverName: string): CachedTemplate[] {
    return Array.from(this.templateCache.values()).filter(
      template => template.serverName === serverName
    );
  }

  /**
   * Search templates by pattern
   */
  searchTemplates(pattern: string | RegExp): CachedTemplate[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return Array.from(this.templateCache.values()).filter(cached =>
      regex.test(cached.uri) ||
      regex.test(cached.template.name || '') ||
      regex.test(cached.template.description || '')
    );
  }

  /**
   * Subscribe to resource updates (if server supports it)
   */
  async subscribeToResource(uri: string, _callback: (content: any) => void): Promise<void> {
    const cached = this.resourceCache.get(uri);
    if (!cached) {
      throw new Error(`Resource ${uri} not found`);
    }

    this.config.logger.warn('Resource subscriptions not yet implemented in MCP');
  }

  /**
   * Unsubscribe from resource updates
   */
  async unsubscribeFromResource(_uri: string): Promise<void> {
    this.config.logger.warn('Resource subscriptions not yet implemented in MCP');
  }

  /**
   * Clear all cached content (keep metadata)
   */
  clearCache(): void {
    for (const cached of this.resourceCache.values()) {
      cached.content = undefined;
    }
    this.config.logger.info('Resource cache cleared');
  }

  /**
   * Refresh a specific resource
   */
  async refreshResource(uri: string): Promise<void> {
    const cached = this.resourceCache.get(uri);
    if (!cached) {
      throw new Error(`Resource ${uri} not found`);
    }

    cached.content = undefined;
    await this.getResource(uri);
  }

  /**
   * Refresh all resources from a specific server
   */
  async refreshResourcesFromServer(serverName: string): Promise<void> {
    const resources = this.getResourcesFromServer(serverName);

    for (const resource of resources) {
      resource.content = undefined;
    }

    this.config.logger.info(`Invalidated ${resources.length} resources from ${serverName}`);
  }

  /**
   * Get resource statistics
   */
  getStatistics(): ResourceStatistics {
    return computeResourceStatistics(this.resourceCache, this.templateCache);
  }

  /**
   * Export resource catalog for documentation
   */
  exportResourceCatalog(): any {
    return exportResourceCatalog(this.resourceCache, this.templateCache);
  }

  /**
   * Cache resource metadata
   */
  private cacheResourceMetadata(serverName: string, resource: Resource): void {
    const cached: CachedResource = {
      uri: resource.uri,
      serverName,
      resource,
      cachedAt: new Date(),
      ttl: 5 * 60 * 1000,
    };

    this.resourceCache.set(resource.uri, cached);
  }

  /**
   * Cache template metadata
   */
  private cacheTemplateMetadata(serverName: string, template: ResourceTemplate): void {
    const cached: CachedTemplate = {
      uri: template.uriTemplate,
      serverName,
      template,
      cachedAt: new Date(),
    };

    this.templateCache.set(template.uriTemplate, cached);
  }

  /**
   * Check if cached resource is still valid
   */
  private isCacheValid(cached: CachedResource): boolean {
    if (!cached.content || !cached.ttl) {
      return false;
    }

    const age = Date.now() - cached.cachedAt.getTime();
    return age < cached.ttl;
  }

  /**
   * Set up periodic cache cleanup
   */
  private setupCacheCleanup(): void {
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, 60 * 1000);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    let removedCount = 0;

    for (const [_uri, cached] of this.resourceCache.entries()) {
      if (!this.isCacheValid(cached)) {
        cached.content = undefined;
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.config.logger.debug(`Cleaned up ${removedCount} expired cache entries`);
    }
  }
}
