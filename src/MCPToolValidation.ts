/**
 * MCPToolValidation - Validates tool parameters and exports schemas
 *
 * Provides parameter validation against JSON Schema and OpenAPI export.
 */

import { IToolParameter, DiscoveredTool } from './MCPToolDiscovery';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate tool parameters against their schema definition
 */
export function validateToolParameters(
  tool: DiscoveredTool,
  parameters: Record<string, any>
): ValidationResult {
  const errors: string[] = [];

  // Check required parameters
  for (const param of tool.parameters) {
    if (param.required && !(param.name in parameters)) {
      errors.push(`Missing required parameter: ${param.name}`);
    }
  }

  // Check parameter types and constraints
  for (const [paramName, paramValue] of Object.entries(parameters)) {
    const paramDef = tool.parameters.find(p => p.name === paramName);
    if (!paramDef) {
      errors.push(`Unknown parameter: ${paramName}`);
      continue;
    }

    // Type validation
    const actualType = typeof paramValue;
    if (paramDef.type === 'array' && !Array.isArray(paramValue)) {
      errors.push(`Parameter ${paramName} should be an array`);
    } else if (paramDef.type !== 'any' && paramDef.type !== actualType && paramDef.type !== 'array') {
      errors.push(`Parameter ${paramName} should be of type ${paramDef.type}, got ${actualType}`);
    }

    // Enum validation
    if (paramDef.enum && !paramDef.enum.includes(paramValue)) {
      errors.push(`Parameter ${paramName} must be one of: ${paramDef.enum.join(', ')}`);
    }

    // String constraints
    if (actualType === 'string') {
      if (paramDef.constraints?.minLength && paramValue.length < paramDef.constraints.minLength) {
        errors.push(`Parameter ${paramName} must be at least ${paramDef.constraints.minLength} characters`);
      }
      if (paramDef.constraints?.maxLength && paramValue.length > paramDef.constraints.maxLength) {
        errors.push(`Parameter ${paramName} must be at most ${paramDef.constraints.maxLength} characters`);
      }
      if (paramDef.constraints?.pattern) {
        const regex = new RegExp(paramDef.constraints.pattern);
        if (!regex.test(paramValue)) {
          errors.push(`Parameter ${paramName} does not match pattern ${paramDef.constraints.pattern}`);
        }
      }
    }

    // Number constraints
    if (actualType === 'number') {
      if (paramDef.constraints?.minimum !== undefined && paramValue < paramDef.constraints.minimum) {
        errors.push(`Parameter ${paramName} must be at least ${paramDef.constraints.minimum}`);
      }
      if (paramDef.constraints?.maximum !== undefined && paramValue > paramDef.constraints.maximum) {
        errors.push(`Parameter ${paramName} must be at most ${paramDef.constraints.maximum}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export tool schemas in OpenAPI format (for documentation)
 */
export function exportToolsAsOpenAPI(tools: DiscoveredTool[]): any {
  const paths: Record<string, any> = {};

  for (const tool of tools) {
    paths[`/tools/${tool.name}`] = {
      post: {
        summary: tool.description,
        operationId: tool.name,
        tags: [tool.serverName],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.rawSchema.inputSchema,
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool execution result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'MCP Tools API',
      version: '1.0.0',
      description: 'Tools available from MCP servers',
    },
    paths,
  };
}
