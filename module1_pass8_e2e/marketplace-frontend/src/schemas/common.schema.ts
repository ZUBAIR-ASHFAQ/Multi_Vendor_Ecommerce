import { z } from "zod";

export const uuidSchema = z.uuid();

export const pageSchema = z.coerce.number().int().min(1).default(1);
export const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });
