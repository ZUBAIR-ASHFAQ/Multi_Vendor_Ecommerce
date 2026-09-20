import type { ActorType, PermissionCode } from "../security/security.contract.js";

/**
 * Server-derived request identity and authorization scope.
 * Clients never submit these fields as authoritative business ownership data.
 */
export interface RequestContext {
  requestId: string;
  actorId: string | null;
  actorType: ActorType;
  permissions: ReadonlySet<PermissionCode>;
  sellerIds: ReadonlySet<string>;
  storeIds: ReadonlySet<string>;
  sellerPermissions: ReadonlyMap<string, ReadonlySet<PermissionCode>>;
  sessionId: string | null;
}
