import { loadPermissions, savePermissions } from './config.js';
import { success, error } from './log.js';

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
