import type { PaginationMeta } from "@/types/api";
import type { SellerApplicationSort } from "../sellers.constants";

export type SellerApplicationStatus = "submitted" | "approved" | "rejected";
export type SellerStatus = "active" | "suspended";
export type SellerApprovalStatus = "approved";
export type StoreStatus = "active" | "inactive" | "suspended";

export interface SellerApplicationBusinessProfile {
  legalName: string;
  displayName: string;
  taxId?: string | null;
}

export interface SellerApplication {
  id: string;
  applicantUserId: string;
  businessProfile: SellerApplicationBusinessProfile;
  status: SellerApplicationStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Seller {
  id: string;
  ownerUserId: string;
  legalName: string;
  displayName: string;
  taxId: string | null;
  status: SellerStatus;
  approvalStatus: SellerApprovalStatus;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SellerStore {
  id: string;
  sellerId: string;
  slug: string;
  name: string;
  description: string | null;
  logoFileId: string | null;
  status: StoreStatus;
  defaultCurrency: string;
  supportEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerStaffSummary {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
}

export interface MySeller {
  seller: Seller;
  stores: SellerStore[];
  staffSummary: SellerStaffSummary;
}

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoFileId: string | null;
  defaultCurrency: string;
  supportEmail: string | null;
  seller: {
    id: string;
    displayName: string;
  };
}

export interface SellerApplicationListParams {
  page?: number;
  pageSize?: number;
  status?: SellerApplicationStatus;
  sort?: SellerApplicationSort;
}

export interface PaginatedSellerApplications {
  items: SellerApplication[];
  meta: PaginationMeta;
}

export interface SubmitSellerApplicationInput {
  legalName: string;
  displayName: string;
  taxId?: string | null;
}

export interface UpdateSellerProfileInput {
  legalName?: string;
  displayName?: string;
  taxId?: string | null;
}

export interface CreateStoreInput {
  slug: string;
  name: string;
  description?: string | null;
  logoFileId?: string | null;
  defaultCurrency: string;
  supportEmail?: string | null;
}

export type SellerEditableStoreStatus = "active" | "inactive";

export interface UpdateStoreInput extends Partial<CreateStoreInput> {
  status?: SellerEditableStoreStatus;
}

export interface ApproveSellerApplicationResponse {
  application: SellerApplication;
  seller: Seller;
}
