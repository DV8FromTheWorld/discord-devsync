import { loadPermissions, savePermissions, type ResolvedHost } from './config.js';
import { success, error } from './log.js';
import { reconcilePermissions } from './env/permissions.js';
import { checkConnection } from './ssh.js';
import { type HostResult, runParallel } from './sync/parallel.js';

export function permissionsList(): void {
  const permissions = loadPermissions();

  if (permissions.length === 0) {
    console.log("No permissions configured. Run 'devsync permissions add' or 'devsync import'.");
    return;
  }

  console.log(`Permissions (${permissions.length}):\n`);
  for (const rule of permissions) {
    console.log(`  ${rule}`);
  }
}

export function permissionsAdd(rule: string): void {
  const permissions = loadPermissions();

  if (permissions.includes(rule)) {
    console.log(`Permission '${rule}' already exists.`);
    return;
  }

  permissions.push(rule);
  savePermissions(permissions);
  success(`Added permission '${rule}'`);
}

export function permissionsRemove(rule: string): void {
  const permissions = loadPermissions();
  const idx = permissions.indexOf(rule);

  if (idx === -1) {
    error(`Permission '${rule}' not found.`);
    if (permissions.length > 0) {
      console.log('Current permissions:');
      for (const p of permissions) {
        console.log(`  ${p}`);
      }
    }
    return;
  }

  permissions.splice(idx, 1);
  savePermissions(permissions);
  success(`Removed permission '${rule}'. Run 'devsync sync push' to propagate.`);
}

export async function permissionsPush(hosts: ResolvedHost[]): Promise<void> {
  async function pushPermissionsToHost(host: ResolvedHost): Promise<HostResult> {
    const result: HostResult = { host: host.name, succeeded: [], errors: [], unreachable: false };

    if (!host.isLocal) {
      const reachable = await checkConnection(host);
      if (!reachable) {
        result.unreachable = true;
        result.errors.push('host unreachable');
        return result;
      }
    }

    try {
      const didPush = await reconcilePermissions(host);
      if (didPush) result.succeeded.push('settings');
      else result.succeeded.push('settings (no changes)');
    } catch {
      result.errors.push('settings failed');
    }

    return result;
  }

  await runParallel('\nPermissions push', hosts, pushPermissionsToHost);
}
