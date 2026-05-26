/**
 * MCPServerTypes - Type definitions for MCP server management
 */

/**
 * Type of MCP server transport
 */
export enum MCPServerType {
  /** Standard input/output (subprocess) */
  STDIO = 'stdio',
  /** Server-Sent Events (HTTP) */
  SSE = 'sse',
  /** WebSocket */
  WEBSOCKET = 'websocket',
}

/**
 * Configuration for an MCP server
 */
export interface MCPServerConfig {
  /**
   * Unique name for this server
   */
  name: string;

  /**
   * Type of server transport
   */
  type: MCPServerType;

  /**
   * Configuration specific to stdio servers
   */
  stdio?: {
    /**
     * Command to launch the server (e.g., 'node', 'python')
     */
    command: string;

    /**
     * Arguments to pass to the command
     */
    args: string[];

    /**
     * Environment variables for the process
     */
    env?: Record<string, string>;

    /**
     * Working directory for the process
     */
    cwd?: string;
  };

  /**
   * Configuration specific to SSE servers
   */
  sse?: {
    /**
     * URL of the SSE endpoint
     */
    url: string;

    /**
     * HTTP headers to send
     */
    headers?: Record<string, string>;
  };

  /**
   * Configuration specific to WebSocket servers
   */
  websocket?: {
    /**
     * WebSocket URL
     */
    url: string;

    /**
     * WebSocket protocols
     */
    protocols?: string[];

    /**
     * Additional headers
     */
    headers?: Record<string, string>;
  };

  /**
   * Health check interval in ms (0 to disable)
   * @default 30000 (30 seconds)
   */
  healthCheckInterval?: number;

  /**
   * Auto-restart on failure
   * @default true
   */
  autoRestart?: boolean;

  /**
   * Maximum restart attempts
   * @default 3
   */
  maxRestartAttempts?: number;

  /**
   * Delay (in ms) between restart attempts
   * @default 5000
   */
  restartDelay?: number;
}

/**
 * Status of an MCP server
 */
export enum ServerStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPED = 'stopped',
  FAILED = 'failed',
  RESTARTING = 'restarting',
}
