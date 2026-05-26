/**
 * Example of using the custom Math MCP Server
 *
 * This demonstrates how to integrate and use a custom MCP server
 * with the iteratio-plugin-mcp plugin.
 */

import { MCPPlugin, MCPServerType } from '../src/index';
import * as path from 'path';

async function main() {
  console.log('=== Custom Math MCP Server Example ===\n');

  // Create the MCP plugin with our custom math server
  const mcpPlugin = new MCPPlugin({
    servers: [
      {
        name: 'math',
        type: MCPServerType.STDIO,
        stdio: {
          command: 'tsx', // or 'ts-node' or 'node' if compiled
          args: [path.join(__dirname, 'custom-server.ts')],
        },
        healthCheckInterval: 30000,
        autoRestart: true,
        maxRestartAttempts: 3,
      },
    ],
    autoDiscoverTools: true,
    toolRefreshInterval: 0, // Disable auto-refresh for this example
    maxRetries: 2,
    executionTimeout: 10000,
  });

  try {
    // Initialize the plugin
    console.log('Initializing MCP plugin with custom math server...');
    await mcpPlugin.initialize();
    console.log('✓ Plugin initialized\n');

    // Get available tools
    const tools = await mcpPlugin.getTools();
    console.log(`Found ${tools.length} tools from math server:`);
    tools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log('');

    // Execute various math operations
    console.log('=== Math Operations ===\n');

    // Addition
    console.log('1. Addition: 42 + 58');
    const addResult = await mcpPlugin.executeTool(
      'mcp_math_add',
      { a: 42, b: 58 },
      {} as any
    );
    console.log('Result:', JSON.parse(addResult[0].text));
    console.log('');

    // Multiplication
    console.log('2. Multiplication: 12 × 8');
    const multiplyResult = await mcpPlugin.executeTool(
      'mcp_math_multiply',
      { a: 12, b: 8 },
      {} as any
    );
    console.log('Result:', JSON.parse(multiplyResult[0].text));
    console.log('');

    // Factorial
    console.log('3. Factorial: 5!');
    const factorialResult = await mcpPlugin.executeTool(
      'mcp_math_factorial',
      { n: 5 },
      {} as any
    );
    console.log('Result:', JSON.parse(factorialResult[0].text));
    console.log('');

    // Fibonacci
    console.log('4. Fibonacci: F(10)');
    const fibResult = await mcpPlugin.executeTool(
      'mcp_math_fibonacci',
      { n: 10 },
      {} as any
    );
    console.log('Result:', JSON.parse(fibResult[0].text));
    console.log('');

    // Prime check - prime number
    console.log('5. Prime Check: Is 17 prime?');
    const primeResult1 = await mcpPlugin.executeTool(
      'mcp_math_prime_check',
      { n: 17 },
      {} as any
    );
    console.log('Result:', JSON.parse(primeResult1[0].text));
    console.log('');

    // Prime check - composite number
    console.log('6. Prime Check: Is 24 prime?');
    const primeResult2 = await mcpPlugin.executeTool(
      'mcp_math_prime_check',
      { n: 24 },
      {} as any
    );
    console.log('Result:', JSON.parse(primeResult2[0].text));
    console.log('');

    // Enable resources and demonstrate resource access
    console.log('=== Resources ===\n');

    // Get available resources
    const resources = await mcpPlugin.getResources();
    console.log('Available resources:');
    resources.forEach(resource => {
      console.log(`  - ${resource.uri}: ${resource.resource.name}`);
    });
    console.log('');

    // Read a resource
    console.log('Reading resource: math://formulas/quadratic');
    const formulaResource = await mcpPlugin.getResource('math://formulas/quadratic');
    console.log('Formula:', formulaResource[0].text);
    console.log('');

    console.log('Reading resource: math://constants/pi');
    const piResource = await mcpPlugin.getResource('math://constants/pi');
    console.log('Pi:', JSON.parse(piResource[0].text));
    console.log('');

    console.log('Reading resource: math://constants/e');
    const eResource = await mcpPlugin.getResource('math://constants/e');
    console.log('Euler\'s number:', JSON.parse(eResource[0].text));
    console.log('');

    // Error handling example
    console.log('=== Error Handling ===\n');

    try {
      console.log('Attempting invalid operation: factorial of -5');
      await mcpPlugin.executeTool(
        'mcp_math_factorial',
        { n: -5 },
        {} as any
      );
    } catch (error: any) {
      console.log('✓ Error caught:', error.message);
    }
    console.log('');

    // Parameter validation example
    console.log('=== Parameter Validation ===\n');

    const toolDiscovery = (mcpPlugin as any).toolDiscovery;

    console.log('Validating correct parameters for add:');
    const validationCorrect = toolDiscovery.validateToolParameters(
      'mcp_math_add',
      { a: 10, b: 20 }
    );
    console.log('Valid:', validationCorrect.valid);
    console.log('');

    console.log('Validating incorrect parameters for add (missing b):');
    const validationIncorrect = toolDiscovery.validateToolParameters(
      'mcp_math_add',
      { a: 10 }
    );
    console.log('Valid:', validationIncorrect.valid);
    console.log('Errors:', validationIncorrect.errors);
    console.log('');

    // Statistics
    console.log('=== Execution Statistics ===\n');

    const executor = (mcpPlugin as any).toolExecutor;
    const stats = executor.getStatistics();
    console.log(`Total executions: ${stats.totalExecutions}`);
    console.log(`Successful: ${stats.successfulExecutions}`);
    console.log(`Failed: ${stats.failedExecutions}`);
    console.log(`Success rate: ${((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(2)}%`);
    console.log(`Average execution time: ${stats.averageExecutionTime.toFixed(2)}ms`);
    console.log('');

    // Tool-specific statistics
    console.log('Tool-specific statistics:');
    const toolStats = executor.getToolStatistics('mcp_math_add');
    if (toolStats) {
      console.log('  add:');
      console.log(`    Executions: ${toolStats.executions}`);
      console.log(`    Success rate: ${(toolStats.successRate * 100).toFixed(2)}%`);
      console.log(`    Avg time: ${toolStats.averageExecutionTime.toFixed(2)}ms`);
    }
    console.log('');

    // Complex calculation example
    console.log('=== Complex Calculation ===\n');
    console.log('Calculate: (5! × 8) + F(10)');

    const fact5 = await mcpPlugin.executeTool('mcp_math_factorial', { n: 5 }, {} as any);
    const fact5Result = JSON.parse(fact5[0].text).result;
    console.log('  5! =', fact5Result);

    const mult = await mcpPlugin.executeTool('mcp_math_multiply', { a: fact5Result, b: 8 }, {} as any);
    const multResult = JSON.parse(mult[0].text).result;
    console.log('  5! × 8 =', multResult);

    const fib10 = await mcpPlugin.executeTool('mcp_math_fibonacci', { n: 10 }, {} as any);
    const fib10Result = JSON.parse(fib10[0].text).result;
    console.log('  F(10) =', fib10Result);

    const finalResult = await mcpPlugin.executeTool('mcp_math_add', { a: multResult, b: fib10Result }, {} as any);
    const final = JSON.parse(finalResult[0].text).result;
    console.log('  Final result =', final);
    console.log('');

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    console.log('=== Cleanup ===');
    console.log('Shutting down MCP plugin...');
    await mcpPlugin.cleanup();
    console.log('✓ Plugin shut down\n');
  }
}

// Run the example
main().catch(console.error);

// TODO: Add example for parallel execution of multiple math operations
// TODO: Add example for chaining math operations
// TODO: Add example for benchmarking different operations
// TODO: Add example for creating a math expression parser using the tools
// TODO: Add example for integrating with a UI/visualization library
