export type UserStatus = "active" | "inactive" | "locked" | "pending";
export type AccountType = "platform_admin" | "seller" | "customer";
export type RoleScopeType = "platform" | "seller" | "customer";

interface AuthRole {
  id: string;
  code: string;
  name: string;
  scopeType: RoleScopeType;
  sellerId: string | null;
}

interface AuthScopes {
  sellerIds: string[];
  storeIds: string[];
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  status: UserStatus;
  roles: AuthRole[];
  permissions: string[];
  scopes: AuthScopes;
}

export interface AuthSessionData {
  accessToken: string;
  expiresInSeconds: number;
  user: AuthenticatedUser;
}

export interface RegisteredCustomer {
  id: string;
  email: string;
  displayName: string;
  accountType: "customer";
  status: UserStatus;
}
