import { z } from 'zod';

const PathsSchema = z.object({
  user_claude_md: z.string().min(1, 'user_claude_md path cannot be empty'),
  claude_local_md: z.string().min(1, 'claude_local_md path cannot be empty'),
  kb: z.string().min(1, 'kb path cannot be empty'),
  skills: z.string().min(1, 'skills path cannot be empty'),
});

const PlatformDefaultsSchema = z.object({
  paths: PathsSchema,
});

const LayerSchema = z.object({
  description: z.string().optional(),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  agents: z.union([z.literal('all'), z.array(z.string())]).optional(),
  mcp: z.union([z.literal('all'), z.array(z.string())]).optional(),
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
    auto_push: z.enum(['ask', 'always', 'never']).optional(),
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

const HttpMcpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1, 'http server requires a url'),
  headers: z.record(z.string(), z.string()).optional(),
});

const SseMcpServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().min(1, 'sse server requires a url'),
  headers: z.record(z.string(), z.string()).optional(),
});

const StdioMcpServerSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1, 'stdio server requires a command'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const McpServerSchema = z.discriminatedUnion('type', [
  HttpMcpServerSchema,
  SseMcpServerSchema,
  StdioMcpServerSchema,
]);

export const McpServersSchema = z.record(z.string(), McpServerSchema);

export function formatValidationErrors(errors: z.ZodError): string {
  return errors.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `  at ${issue.path.join('.')}` : '';
      return `  - ${issue.message}${path}`;
    })
    .join('\n');
}
