import { z } from 'zod';

const PathsSchema = z.object({
  claude_md: z.string().min(1, 'claude_md path cannot be empty'),
  kb: z.string().min(1, 'kb path cannot be empty'),
  skills: z.string().min(1, 'skills path cannot be empty'),
});

const PlatformDefaultsSchema = z.object({
  paths: PathsSchema,
});

const LayerSchema = z.object({
  description: z.string().optional(),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  mcp: z.array(z.string()).optional(),
  dotfiles: z.boolean().optional(),
  secrets: z.boolean().optional(),
});

const HostConfigSchema = z.object({
  hostname: z.string().min(1, 'hostname cannot be empty'),
  platform: z.enum(['darwin', 'linux'], { error: "platform must be 'darwin' or 'linux'" }),
  layers: z.array(z.string()).min(1, 'host must have at least one layer'),
  paths: PathsSchema.partial().optional(),
});

export const ConfigSchema = z
  .object({
    defaults: z.record(z.enum(['darwin', 'linux']), PlatformDefaultsSchema),
    layers: z.record(z.string(), LayerSchema).refine((layers) => Object.keys(layers).length > 0, {
      message: 'at least one layer must be defined',
    }),
    hosts: z.record(z.string(), HostConfigSchema),
  })
  .superRefine((config, ctx) => {
    // Validate that all host layers reference defined layers
    for (const [hostName, host] of Object.entries(config.hosts)) {
      for (const layerName of host.layers) {
        if (!(layerName in config.layers)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `host '${hostName}' references undefined layer '${layerName}'`,
            path: ['hosts', hostName, 'layers'],
          });
        }
      }
    }
  });

const McpServerSchema = z
  .object({
    transport: z.enum(['http', 'stdio'], { error: "transport must be 'http' or 'stdio'" }),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((server, ctx) => {
    if (server.transport === 'http' && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "http transport requires a 'url' field",
        path: ['url'],
      });
    }
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stdio transport requires a 'command' field",
        path: ['command'],
      });
    }
  });

export const McpConfigSchema = z.object({
  servers: z.record(z.string(), McpServerSchema),
});

export function formatValidationErrors(errors: z.ZodError): string {
  return errors.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `  at ${issue.path.join('.')}` : '';
      return `  - ${issue.message}${path}`;
    })
    .join('\n');
}
