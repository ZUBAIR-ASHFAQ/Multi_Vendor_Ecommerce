/** Module 14 permissions used only to hide unavailable browser actions; the API remains authoritative. */
export const RETURNS_PERMISSION = {
  CREATE_OWN: "returns.create_own",
  READ_OWN: "returns.read_own",
  SELLER_MANAGE: "seller.returns.manage",
  ADMIN_MANAGE: "admin.returns.manage",
  ADMIN_REFUNDS_ISSUE: "admin.refunds.issue",
} as const;

/** Server-owned Return Request lifecycle values. */
export const RETURN_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECEIVED: "received",
  CLOSED: "closed",
} as const;

export const RETURN_STATUS_VALUES = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.CLOSED,
] as const;

/** Readable labels for server-owned Return states. */
export const RETURN_STATUS_LABEL: Record<(typeof RETURN_STATUS_VALUES)[number], string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  received: "Received",
  closed: "Closed",
};

/** Customer-selectable Return reasons approved by the backend contract. */
export const RETURN_REASON_VALUES = [
  "damaged",
  "defective",
  "wrong_item",
  "not_as_described",
  "changed_mind",
  "other",
] as const;

export const RETURN_REASON_LABEL: Record<(typeof RETURN_REASON_VALUES)[number], string> = {
  damaged: "Damaged",
  defective: "Defective",
  wrong_item: "Wrong item",
  not_as_described: "Not as described",
  changed_mind: "Changed mind",
  other: "Other",
};

/** Seller/support physical inspection values. */
export const RETURN_ITEM_CONDITION_VALUES = [
  "unopened",
  "opened",
  "damaged",
  "defective",
  "other",
] as const;

export const RETURN_ITEM_CONDITION_LABEL: Record<(typeof RETURN_ITEM_CONDITION_VALUES)[number], string> = {
  unopened: "Unopened",
  opened: "Opened",
  damaged: "Damaged",
  defective: "Defective",
  other: "Other",
};

/** Item-level resolution values keep refund money and physical restock separate. */
export const RETURN_ITEM_RESOLUTION_VALUES = ["refund_restock", "refund_no_restock"] as const;

export const RETURN_ITEM_RESOLUTION_LABEL: Record<(typeof RETURN_ITEM_RESOLUTION_VALUES)[number], string> = {
  refund_restock: "Refund and restock",
  refund_no_restock: "Refund without restock",
};
