# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-XX

### Added
- Initial release of iteratio-plugin-mcp
- MCPServerManager for server lifecycle management
  - Support for stdio, SSE, and WebSocket transports
  - Automatic health monitoring and restart
  - Multi-server support
- MCPToolDiscovery for automatic tool discovery
  - Dynamic tool schema parsing
  - JSON Schema to iteratio parameter conversion
  - Tool search and filtering capabilities
  - Parameter validation
- MCPToolExecutor for tool execution
  - Retry logic with exponential backoff
  - Execution timeout handling
  - Statistics tracking (success rate, execution time)
  - Parallel and sequential execution support
- MCPResourceManager for resource management
  - Resource caching with TTL
  - Template support
  - Resource discovery and search
- Comprehensive documentation and examples
  - Basic usage examples
  - Custom MCP server creation guide
  - GitHub, filesystem, and database integration examples
- Full TypeScript support with type definitions

### Security
- No known security issues

## [Unreleased]

### Planned Features
- Authentication support (API keys, OAuth)
- Server capability negotiation
- Streaming tool responses
- Metrics collection and monitoring dashboard
- Tool caching for idempotent operations
- Server discovery mechanism
- Version compatibility checking
- Distributed tool execution
- Cost tracking and quotas
- Rate limiting
- Tool execution sandboxing
