/**
 * Custom MCP Server Example
 *
 * This example shows how to create a custom MCP server that provides
 * domain-specific tools for your application.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Custom MCP Server that provides mathematical operations
 */
class MathMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'math-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: {
                type: 'number',
                description: 'First number',
              },
              b: {
                type: 'number',
                description: 'Second number',
              },
            },
            required: ['a', 'b'],
          },
        },
        {
          name: 'multiply',
          description: 'Multiply two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: {
                type: 'number',
                description: 'First number',
              },
              b: {
                type: 'number',
                description: 'Second number',
              },
            },
            required: ['a', 'b'],
          },
        },
        {
          name: 'factorial',
          description: 'Calculate factorial of a number',
          inputSchema: {
            type: 'object',
            properties: {
              n: {
                type: 'number',
                description: 'Number to calculate factorial for',
              },
            },
            required: ['n'],
          },
        },
        {
          name: 'fibonacci',
          description: 'Calculate Fibonacci number at position n',
          inputSchema: {
            type: 'object',
            properties: {
              n: {
                type: 'number',
                description: 'Position in Fibonacci sequence',
              },
            },
            required: ['n'],
          },
        },
        {
          name: 'prime_check',
          description: 'Check if a number is prime',
          inputSchema: {
            type: 'object',
            properties: {
              n: {
                type: 'number',
                description: 'Number to check',
              },
            },
            required: ['n'],
          },
        },
      ],
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'add':
          return this.handleAdd(args);
        case 'multiply':
          return this.handleMultiply(args);
        case 'factorial':
          return this.handleFactorial(args);
        case 'fibonacci':
          return this.handleFibonacci(args);
        case 'prime_check':
          return this.handlePrimeCheck(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // List available resources (e.g., math formulas)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'math://formulas/quadratic',
          name: 'Quadratic Formula',
          description: 'The quadratic formula for solving ax² + bx + c = 0',
          mimeType: 'text/plain',
        },
        {
          uri: 'math://constants/pi',
          name: 'Pi',
          description: 'The mathematical constant π',
          mimeType: 'application/json',
        },
        {
          uri: 'math://constants/e',
          name: 'Euler\'s Number',
          description: 'The mathematical constant e',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read a resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'math://formulas/quadratic':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: 'x = (-b ± √(b² - 4ac)) / 2a',
              },
            ],
          };
        case 'math://constants/pi':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ value: Math.PI, symbol: 'π' }),
              },
            ],
          };
        case 'math://constants/e':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ value: Math.E, symbol: 'e' }),
              },
            ],
          };
        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  private handleAdd(args: any) {
    const { a, b } = args;
    const result = a + b;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result, operation: 'addition', operands: [a, b] }),
        },
      ],
    };
  }

  private handleMultiply(args: any) {
    const { a, b } = args;
    const result = a * b;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result, operation: 'multiplication', operands: [a, b] }),
        },
      ],
    };
  }

  private handleFactorial(args: any) {
    const { n } = args;

    if (n < 0) {
      throw new Error('Factorial is not defined for negative numbers');
    }

    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result, operation: 'factorial', input: n }),
        },
      ],
    };
  }

  private handleFibonacci(args: any) {
    const { n } = args;

    if (n < 0) {
      throw new Error('Fibonacci is not defined for negative numbers');
    }

    let a = 0, b = 1;
    for (let i = 0; i < n; i++) {
      [a, b] = [b, a + b];
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result: a, operation: 'fibonacci', position: n }),
        },
      ],
    };
  }

  private handlePrimeCheck(args: any) {
    const { n } = args;

    if (n < 2) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ isPrime: false, number: n, reason: 'Number must be >= 2' }),
          },
        ],
      };
    }

    for (let i = 2; i <= Math.sqrt(n); i++) {
      if (n % i === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ isPrime: false, number: n, divisor: i }),
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ isPrime: true, number: n }),
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Math MCP Server started');
  }
}

// Start the server
const server = new MathMCPServer();
server.start().catch(console.error);

// TODO: Add more mathematical operations (power, root, logarithm, etc.)
// TODO: Add matrix operations
// TODO: Add statistical functions (mean, median, standard deviation)
// TODO: Add geometry functions (area, volume, etc.)
// TODO: Add graphing capabilities
// TODO: Add equation solver
// TODO: Add support for complex numbers
// TODO: Add calculus operations (derivatives, integrals)
