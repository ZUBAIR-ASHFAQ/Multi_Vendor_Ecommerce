import type { UserStatus } from "@/features/auth/types/auth.types";
import type { PaginationMeta } from "@/types/api";
import type { CustomerSort } from "../customers.constants";

export type CustomerProfileStatus = "active" | "inactive";
export type CustomerAddressStatus = "active" | "archived";

export interface CustomerProfile {
  userId: string;
  displayName: string;
  phone: string | null;
  status: CustomerProfileStatus;
  marketingOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  customerUserId: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  countryCode: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  status: CustomerAddressStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfileUpdateInput {
  displayName: string;
  phone: string | null;
  marketingOptIn: boolean;
}

export interface CustomerAddressWriteInput {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  countryCode: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

export interface AdminCustomerListItem {
  userId: string;
  email: string;
  accountStatus: UserStatus;
  profileStatus: CustomerProfileStatus;
  displayName: string;
  phone: string | null;
  marketingOptIn: boolean;
  addressCount: number;
  createdAt: string;
}

export interface AdminCustomerDetail {
  customer: AdminCustomerListItem;
  addresses: CustomerAddress[];
}

export interface CustomerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  profileStatus?: CustomerProfileStatus;
  accountStatus?: UserStatus;
  sort?: CustomerSort;
}

export interface PaginatedCustomers {
  items: AdminCustomerListItem[];
  meta: PaginationMeta;
}
