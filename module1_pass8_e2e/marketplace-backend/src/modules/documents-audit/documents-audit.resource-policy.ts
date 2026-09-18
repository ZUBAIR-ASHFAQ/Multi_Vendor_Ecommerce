import type { RequestContext } from "../../common/types/request-context.js";

/** Actions that can require a linked business-resource authorization decision. */
export type DocumentResourceAction = "read" | "link" | "unlink";

/** Safe scope metadata returned after a business resource has been authorized. */
export interface AuthorizedDocumentResource {
  sellerId: string | null;
}

/**
 * Small boundary used by Documents so later Seller/Product/Report modules can provide
 * resource ownership checks without Documents importing their repositories directly.
 */
export interface DocumentResourcePolicy {
  authorize(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource | null>;
}

/**
 * Base policy for the user resource owned by Module 2.
 * Downstream business resources are added through CompositeDocumentResourcePolicy.
 */
export class CurrentDocumentResourcePolicy implements DocumentResourcePolicy {
  /** Authorizes only a user's own Module 2 user resource at this generation stage. */
  async authorize(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    _action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource | null> {
    if (resourceType === "user" && context.actorId === resourceId) {
      return { sellerId: null };
    }
    return null;
  }
}

/** Tries independent resource policies in order so later modules can extend Documents without reverse imports. */
export class CompositeDocumentResourcePolicy implements DocumentResourcePolicy {
  /** Stores the ordered policies used to authorize one linked business resource. */
  constructor(private readonly policies: readonly DocumentResourcePolicy[]) {}

  /** Returns the first successful authorization result and otherwise fails closed with null. */
  async authorize(
    context: RequestContext,
    resourceType: string,
    resourceId: string,
    action: DocumentResourceAction,
  ): Promise<AuthorizedDocumentResource | null> {
    for (const policy of this.policies) {
      const authorized = await policy.authorize(
        context,
        resourceType,
        resourceId,
        action,
      );
      if (authorized) return authorized;
    }
    return null;
  }
}
