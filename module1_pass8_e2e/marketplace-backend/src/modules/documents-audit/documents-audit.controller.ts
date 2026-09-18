import type { NextFunction, Request, Response } from "express";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { getRequestId } from "../../http/request-id.js";
import {
  auditIdParamsSchema,
  auditListQuerySchema,
  confirmUploadParamsSchema,
  documentIdParamsSchema,
  linkFileBodySchema,
  linkFileParamsSchema,
  signUploadBodySchema,
  unlinkFileParamsSchema,
} from "./documents-audit.schema.js";
import { DocumentsAuditService } from "./documents-audit.service.js";

/** Thin HTTP controller for the seven Module 21 document/audit endpoints. */
export class DocumentsAuditController {
  /** Stores the already-composed service used by this thin HTTP adapter. */
  constructor(private readonly service: DocumentsAuditService) {}

  /** Creates pending file metadata and a constrained signed direct-upload grant. */
  signUpload = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = signUploadBodySchema.parse(request.body);
      const result = await this.service.signUpload(getRequestContext(response), input);
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Confirms one direct upload using provider metadata rather than client-supplied claims. */
  confirmUpload = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = confirmUploadParamsSchema.parse(request.params);
      const result = await this.service.confirmUpload(getRequestContext(response), id);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Links a confirmed file to one service-authorized business resource. */
  linkFile = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = linkFileParamsSchema.parse(request.params);
      const input = linkFileBodySchema.parse(request.body);
      const result = await this.service.linkFile(getRequestContext(response), id, input);
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates a short-lived signed download after service-level file/resource authorization. */
  getDownload = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = documentIdParamsSchema.parse(request.params);
      const result = await this.service.getDownload(getRequestContext(response), id);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Removes one active file/resource link without deleting the physical storage object. */
  unlinkFile = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id, linkId } = unlinkFileParamsSchema.parse(request.params);
      const result = await this.service.unlinkFile(
        getRequestContext(response),
        id,
        linkId,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one bounded, permission-filtered page of append-only audit metadata. */
  listAuditLogs = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = auditListQuerySchema.parse(request.query);
      const result = await this.service.listAuditLogs(getRequestContext(response), query);
      response.status(200).json(
        successResponse(result.items, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one authorized audit record with redacted before/after snapshots. */
  getAuditLog = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = auditIdParamsSchema.parse(request.params);
      const result = await this.service.getAuditLog(getRequestContext(response), id);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };
}

