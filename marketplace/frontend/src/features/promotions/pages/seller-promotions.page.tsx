import { useState } from "react";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { PromotionStatusBadge } from "../components/promotion-status-badge";
import { PromotionForm } from "../forms/promotion.form";
import { useCreateSellerPromotionMutation } from "../hooks/use-promotions";
import { PROMOTION_PERMISSION } from "../promotions.constants";
import type { CreatePromotionInput, Promotion } from "../schemas/promotions.schemas";

/** Renders seller-scoped promotion creation without inventing a seller list endpoint. */
function SellerPromotionsContent() {
  const [created, setCreated] = useState<Promotion | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const createPromotion = useCreateSellerPromotionMutation();

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pricing & Growth</p>
        <h1 className="mt-1 text-2xl font-bold">Seller Promotions</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Create seller-funded percentage promotions. Seller ownership and target ownership are derived and revalidated by the API.
        </p>
      </section>

      {created ? (
        <section role="status" className="rounded-xl border bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong>{created.name}</strong> was created with {created.scopes.length} eligibility scope(s).
              {created.coupon ? <span className="block">Coupon: {created.coupon.code}</span> : null}
            </div>
            <PromotionStatusBadge status={created.status} />
          </div>
        </section>
      ) : null}

      <PromotionForm
        key={formVersion}
        mode="seller-create"
        isPending={createPromotion.isPending}
        error={createPromotion.error}
        onSubmit={async (input) => {
          const result = await createPromotion.mutateAsync(input as CreatePromotionInput);
          setCreated(result);
          setFormVersion((value) => value + 1);
        }}
      />

      <section className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
        <strong className="text-slate-800">Creation-only seller API</strong>
        <p className="mt-1">
          The approved Module 9 API includes seller promotion creation but does not define a
          seller promotion list route. This page does not invent one.
        </p>
      </section>
    </div>
  );
}

/** Protects seller promotion creation with seller account type and seller-scoped permission. */
export function SellerPromotionsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={PROMOTION_PERMISSION.SELLER_MANAGE}>
          <SellerPromotionsContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}
