/**
 * MCPTransportFactory - Creates MCP transport instances
 *
 * Factory methods for stdio, SSE, and WebSocket transports.
 */

import { spawn, ChildProcess } from 'child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import WebSocket from 'ws';
import { MCPServerConfig, MCPServerType } from './MCPServerTypes';

/**
 * Server instance tracking (transport-related subset)
 */
export interface TransportInstance {
  process?: ChildProcess;
}

/**
 * Logger interface expected by factory methods
 */
export interface TransportLogger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

/**
 * Create stdio transport (subprocess)
 */
export async function createStdioTransport(
  config: MCPServerConfig,
  instance: TransportInstance,
  logger: TransportLogger
): Promise<StdioClientTransport> {
  if (!config.stdio) {
    throw new Error('stdio configuration is required for stdio server type');
  }

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)
    ),
    ...config.stdio.env,
  };

  const childProcess = spawn(config.stdio.command, config.stdio.args, {
    env,
    cwd: config.stdio.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  instance.process = childProcess;

  // Handle process events
  childProcess.on('error', (error) => {
    logger.error(`Server ${config.name} process error:`, error);
  });

  childProcess.on('exit', (code, signal) => {
    logger.warn(`Server ${config.name} process exited (code: ${code}, signal: ${signal})`);
  });

  // Log stderr for debugging
  childProcess.stderr?.on('data', (data) => {
    logger.debug(`Server ${config.name} stderr:`, data.toString());
  });

  const transport = new StdioClientTransport({
    command: config.stdio.command,
    args: config.stdio.args,
    env,
    cwd: config.stdio.cwd,
  });

  return transport;
}

/**
 * Create SSE transport
 */
export async function createSSETransport(
  config: MCPServerConfig,
  logger: TransportLogger
): Promise<SSEClientTransport> {
  if (!config.sse) {
    throw new Error('sse configuration is required for sse server type');
  }

  const transport = new SSEClientTransport(
    new URL(config.sse.url),
    config.sse.headers
  );

  return transport;
}

/**
 * Create WebSocket transport
 */
export async function createWebSocketTransport(
  config: MCPServerConfig,
  logger: TransportLogger,
  onFailure: () => void
): Promise<WebSocket> {
  if (!config.websocket) {
    throw new Error('websocket configuration is required for websocket server type');
  }

  const ws = new WebSocket(
    config.websocket.url,
    config.websocket.protocols,
    {
      headers: config.websocket.headers,
    }
  );

  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      logger.debug(`WebSocket connection opened: ${config.name}`);
      resolve(ws);
    });

    ws.on('error', (error: Error) => {
      logger.error(`WebSocket error for ${config.name}:`, error);
      reject(error);
    });

    ws.on('close', () => {
      logger.warn(`WebSocket connection closed: ${config.name}`);
      onFailure();
    });
  });
}
