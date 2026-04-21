/**
 * HashiCorp Vault — TypeScript surface.
 *
 * The canonical type definitions live in `./vault.ts` (historical
 * filename). This module re-exports them under the project's
 * `hashicorpVault` convention so import sites can consistently
 * reference the crate name (`sorng-hashicorp-vault`).
 *
 * Prefer `from '../types/hashicorpVault'` in new code.
 */

export * from './vault';
