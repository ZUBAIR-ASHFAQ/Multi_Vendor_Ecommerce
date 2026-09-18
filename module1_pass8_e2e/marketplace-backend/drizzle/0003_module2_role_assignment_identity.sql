-- Module 2 seller-aware role-assignment identity.
-- Seller-scoped role assignments need identity that includes seller_id.
-- The original primary key (user_id, role_id) prevented the same seller-scoped
-- role from being assigned to one user for more than one seller.

ALTER TABLE "user_roles"
  DROP CONSTRAINT "user_roles_pk";

-- Platform/customer role assignments use a null seller_id and remain unique per user + role.
CREATE UNIQUE INDEX "user_roles_platform_role_uq"
  ON "user_roles" USING btree ("user_id", "role_id")
  WHERE "seller_id" IS NULL;

-- Seller-scoped assignments are unique per user + role + seller.
-- seller_id intentionally has no FK until Module 4 creates the sellers table.
CREATE UNIQUE INDEX "user_roles_seller_role_uq"
  ON "user_roles" USING btree ("user_id", "role_id", "seller_id")
  WHERE "seller_id" IS NOT NULL;
