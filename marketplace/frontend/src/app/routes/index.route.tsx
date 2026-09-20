import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useCategoriesQuery } from "@/features/catalog-taxonomy/hooks/use-catalog-taxonomy";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { useProductSearchQuery } from "@/features/search-discovery/hooks/use-search-discovery";
import type { SearchProductCard } from "@/features/search-discovery/schemas/search-discovery.schemas";
import { formatMoney } from "@/lib/money";
import { rootRoute } from "@/app/routes/root.route";

const CATEGORY_GLYPHS = ["⌂", "◉", "◇", "◎", "✦", "□"] as const;
const HOME_PRODUCT_QUERY = { sort: "newest", page: 1, pageSize: 8 } as const;

/** Formats one Search price/range without using floating-point arithmetic for business logic. */
function productPrice(product: SearchProductCard): string {
  const minimum = formatMoney(product.minPrice, product.currency);
  if (product.minPrice === product.maxPrice) return minimum;
  return `${minimum} – ${formatMoney(product.maxPrice, product.currency)}`;
}

/** Premium public storefront landing page backed by the existing public catalog and Search contracts. */
function FoundationHomePage() {
  const categories = useCategoriesQuery();
  const products = useProductSearchQuery(HOME_PRODUCT_QUERY);
  const productItems = products.data?.data.items ?? [];
  const productMedia = usePublicMediaQuery(productItems.map((product) => product.thumbnailFileId));
  const mediaById = new Map(productMedia.data?.items.map((item) => [item.fileId, item]) ?? []);
  const categoryItems = (categories.data ?? [])
    .filter((category) => category.status === "active")
    .slice(0, 6);

  return (
    <div className="storefront-home">
      <section className="storefront-hero">
        <div className="storefront-hero-copy">
          <p className="storefront-eyebrow"><span /> Curated multi-vendor marketplace</p>
          <h1>Better objects.<br />Independent makers.</h1>
          <p className="storefront-hero-lead">
            Discover considered products from verified sellers, with unified checkout, secure payments,
            order tracking and marketplace-grade buyer protection.
          </p>
          <div className="storefront-hero-actions">
            <Link to="/search" className="storefront-primary-cta">Explore collection <span>→</span></Link>
            <Link to="/search/stores" className="storefront-secondary-cta">Meet the sellers <span>⌂</span></Link>
          </div>
          <div className="storefront-trust-row" aria-label="Marketplace benefits">
            <div><strong>Secure payments</strong><span>Protected checkout flow</span></div>
            <div><strong>Order tracking</strong><span>Follow fulfillment progress</span></div>
            <div><strong>Verified sellers</strong><span>Marketplace-reviewed businesses</span></div>
          </div>
        </div>

        <div className="storefront-hero-art" aria-hidden="true">
          <div className="hero-art-leaf hero-art-leaf-one" />
          <div className="hero-art-leaf hero-art-leaf-two" />
          <div className="hero-art-vase" />
          <div className="hero-art-table" />
          <div className="hero-art-chair"><span /></div>
          <p>A more<br />thoughtful<br />way to shop</p>
          <div className="storefront-stats">
            <div><strong>One cart</strong><span>across marketplace stores</span></div>
            <div><strong>One checkout</strong><span>with secure payments</span></div>
            <div><strong>One account</strong><span>for orders and returns</span></div>
          </div>
        </div>
      </section>

      <section className="storefront-section" aria-labelledby="home-categories-title">
        <div className="storefront-section-heading">
          <div>
            <p>Shop by collection</p>
            <h2 id="home-categories-title">Find your next favorite</h2>
          </div>
          <Link to="/products">Browse all products →</Link>
        </div>

        {categories.isPending ? (
          <div className="storefront-category-grid" aria-label="Loading categories" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="storefront-category-card storefront-card-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : categories.isError ? (
          <div className="storefront-inline-state" role="status">
            Categories are temporarily unavailable. <Link to="/products">Browse all products instead.</Link>
          </div>
        ) : categoryItems.length === 0 ? (
          <div className="storefront-inline-state">
            Collections are being prepared. <Link to="/products">Browse the live product catalog.</Link>
          </div>
        ) : (
          <div className="storefront-category-grid">
            {categoryItems.map((category, index) => (
              <Link
                key={category.id}
                to="/search"
                search={{ categoryId: category.id, sort: "relevance", page: 1, pageSize: 20 }}
                className="storefront-category-card"
              >
                <span className="storefront-category-glyph" aria-hidden="true">
                  {CATEGORY_GLYPHS[index % CATEGORY_GLYPHS.length]}
                </span>
                <span><strong>{category.name}</strong><small>Explore collection</small></span>
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="storefront-section" aria-labelledby="home-products-title">
        <div className="storefront-section-heading">
          <div>
            <p>Fresh from the marketplace</p>
            <h2 id="home-products-title">New arrivals</h2>
            <span>Recently published products from active marketplace stores.</span>
          </div>
          <Link to="/search" search={{ sort: "newest", page: 1, pageSize: 20 }}>Shop new arrivals →</Link>
        </div>

        {products.isPending ? (
          <div className="storefront-product-grid" aria-label="Loading new products" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="storefront-product-card storefront-product-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : products.isError ? (
          <div className="storefront-inline-state" role="status">
            New arrivals are temporarily unavailable. <Link to="/products">Browse the product catalog.</Link>
          </div>
        ) : productItems.length === 0 ? (
          <div className="storefront-inline-state">
            No published products are available yet. <Link to="/search/stores">Discover marketplace stores.</Link>
          </div>
        ) : (
          <div className="storefront-product-grid">
            {productItems.map((product) => {
              const image = product.thumbnailFileId ? mediaById.get(product.thumbnailFileId) : undefined;
              return (
                <article key={product.productId} className="storefront-product-card">
                  <Link
                    to="/products/$slug"
                    params={{ slug: product.slug }}
                    className="storefront-product-art"
                    aria-label={`View ${product.name}`}
                  >
                    {image?.mimeType.startsWith("image/") ? (
                      <img src={image.url} alt="" loading="lazy" />
                    ) : (
                      <div className="storefront-product-image-fallback" aria-hidden="true">◇</div>
                    )}
                    <span className={`storefront-product-badge${product.inStock ? "" : " storefront-product-badge-muted"}`}>
                      {product.inStock ? "In stock" : "Out of stock"}
                    </span>
                  </Link>
                  <div className="storefront-product-copy">
                    <p>{product.brand ?? product.categoryPath}</p>
                    <h3>
                      <Link to="/products/$slug" params={{ slug: product.slug }}>{product.name}</Link>
                    </h3>
                    <div className="storefront-rating">
                      <span aria-hidden="true">★</span>{" "}
                      {product.ratingCount > 0
                        ? `${product.ratingAvg.toFixed(1)} (${product.ratingCount})`
                        : "New to the marketplace"}
                    </div>
                    <div className="storefront-product-bottom">
                      <strong>{productPrice(product)}</strong>
                      <Link
                        to="/products/$slug"
                        params={{ slug: product.slug }}
                        className="storefront-add"
                        aria-label={`View ${product.name}`}
                      >
                        →
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="storefront-join">
        <div>
          <p>Built for buyers and independent businesses</p>
          <h2>Multi-vendor marketplace, one cohesive experience.</h2>
        </div>
        <div className="storefront-join-actions">
          <Button asChild><Link to="/seller/apply">Become a seller</Link></Button>
          <Button asChild variant="outline"><Link to="/login">Sign in</Link></Button>
          <Button asChild variant="outline"><Link to="/register">Create customer account</Link></Button>
          <Button asChild variant="outline"><Link to="/search">Search marketplace</Link></Button>
          <Button asChild variant="outline"><Link to="/products">Browse products</Link></Button>
        </div>
      </section>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationHomePage,
});
