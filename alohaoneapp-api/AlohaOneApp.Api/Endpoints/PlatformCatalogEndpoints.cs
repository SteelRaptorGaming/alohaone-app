using Aloha.Core.Auth;
using Aloha.Core.Models;
using Aloha.Core.Services;
using Dapper;
using Stripe;

namespace AlohaOneApp.Api.Endpoints;

/// <summary>
/// Phase E.1 — Platform catalog admin endpoints. Hosts CRUD for the
/// centralized platform catalog that lives in the shared schema
/// (shared.platforms + shared.platform_tiers). Every child platform
/// (Commerce, Document, Backup, Configurator, Browser, future) reads
/// its tier pricing from here.
///
/// Served from the AlohaOneApp shared API (shared.api.alohaone.ai).
/// Every mutation is gated by RequirePlatformAdmin. Web designers and
/// store owners cannot see or modify these.
/// </summary>
public static class PlatformCatalogEndpoints
{
    public static void MapPlatformCatalogEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/catalog")
            .WithTags("Platform Catalog (AlohaOne admin)")
            .RequireAuthorization();

        // ── Platforms ───────────────────────────────────────────────────────

        // GET /api/admin/catalog/platforms — list every child platform with
        // tier count, enabled flag, and a rollup of active subscriptions.
        group.MapGet("/platforms", async (HttpContext ctx, IDbConnectionFactory db) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();
            var rows = await conn.QueryAsync(
                """
                SELECT p.id, p.code, p.name, p.description, p.icon,
                       p.display_order, p.enabled, p.stripe_product_id,
                       p.created_at, p.updated_at,
                       (SELECT COUNT(*) FROM shared.platform_tiers t
                          WHERE t.platform_id = p.id AND t.is_active) AS active_tier_count,
                       (SELECT COUNT(*) FROM shared.org_subscriptions s
                          WHERE s.platform_id = p.id AND s.status = 'active') AS active_subscription_count
                FROM shared.platforms p
                ORDER BY p.display_order, p.id
                """);
            return Results.Ok(rows);
        });

        // PUT /api/admin/catalog/platforms/{id}/enabled — flip the enabled
        // flag. Disabled platforms stay visible to their existing subscribers
        // (grandfathered) but no new signups can start.
        group.MapPut("/platforms/{id:long}/enabled",
            async (HttpContext ctx, IDbConnectionFactory db, long id, PlatformEnabledRequest req) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();
            var updated = await conn.ExecuteAsync(
                """
                UPDATE shared.platforms
                SET enabled = @Enabled, updated_at = NOW()
                WHERE id = @Id
                """,
                new { Id = id, req.Enabled });

            if (updated == 0) return ApiError.NotFound("Platform not found");
            return Results.Ok(new { ok = true, enabled = req.Enabled });
        });

        // GET /api/admin/catalog/platforms/{id} — single platform detail
        group.MapGet("/platforms/{id:long}", async (HttpContext ctx, IDbConnectionFactory db, long id) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();
            var p = await conn.QuerySingleOrDefaultAsync(
                """
                SELECT id, code, name, description, icon, display_order,
                       enabled, stripe_product_id, created_at, updated_at
                FROM shared.platforms WHERE id = @Id
                """, new { Id = id });

            if (p is null) return ApiError.NotFound("Platform not found");
            return Results.Ok(p);
        });

        // ── Tiers ──────────────────────────────────────────────────────────

        // GET /api/admin/catalog/platforms/{id}/tiers — list all tiers for a
        // platform, with store count (Commerce only — nonzero for now).
        group.MapGet("/platforms/{id:long}/tiers",
            async (HttpContext ctx, IDbConnectionFactory db, long id) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();
            var tiers = await conn.QueryAsync(
                """
                SELECT t.id, t.platform_id, t.code, t.name, t.description,
                       t.monthly_price_cents, t.features_json, t.stripe_price_id,
                       t.is_active, t.display_order, t.created_at, t.updated_at,
                       (SELECT COUNT(*) FROM commerce.stores s
                          WHERE s.shared_tier_id = t.id) AS store_count
                FROM shared.platform_tiers t
                WHERE t.platform_id = @PlatformId
                ORDER BY t.display_order, t.id
                """, new { PlatformId = id });
            return Results.Ok(tiers);
        });

        // POST /api/admin/catalog/platforms/{id}/tiers — create a new tier
        // and matching Stripe Price.
        group.MapPost("/platforms/{id:long}/tiers",
            async (HttpContext ctx, IDbConnectionFactory db, StripeSecretsProvider stripe,
                   long id, TierUpsertRequest req) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Code) || !IsValidCode(req.Code))
                return ApiError.BadRequest("Code must match ^[a-z0-9_-]{2,40}$");
            if (string.IsNullOrWhiteSpace(req.Name))
                return ApiError.BadRequest("Name is required");
            if (req.MonthlyPriceCents < 0)
                return ApiError.BadRequest("monthlyPriceCents must be >= 0");

            using var conn = await db.CreateOpenConnectionAsync();

            var platform = await conn.QuerySingleOrDefaultAsync(
                "SELECT id, code, name, stripe_product_id FROM shared.platforms WHERE id = @Id",
                new { Id = id });
            if (platform is null) return ApiError.NotFound("Platform not found");

            var exists = await conn.QuerySingleOrDefaultAsync<long?>(
                """
                SELECT id FROM shared.platform_tiers
                WHERE platform_id = @PlatformId AND code = @Code
                """,
                new { PlatformId = id, req.Code });
            if (exists.HasValue)
                return ApiError.BadRequest($"A tier with code '{req.Code}' already exists for this platform");

            // Ensure the platform has a Stripe Product; create lazily if missing.
            // If the Stripe secret is not configured (edge case in bare dev),
            // skip Stripe entirely — the tier saves with stripe_price_id NULL
            // and can be backfilled by re-saving once the secret is populated.
            string stripeKey = "";
            try { stripeKey = await stripe.GetSecretKeyAsync(); }
            catch { /* no stripe configured — graceful local-dev fallback */ }

            var stripeConfigured = !string.IsNullOrEmpty(stripeKey);
            var stripeProductId = (string?)platform.stripe_product_id;
            string? stripePriceId = null;
            if (stripeConfigured)
            {
                if (string.IsNullOrEmpty(stripeProductId))
                {
                    stripeProductId = await CreateStripeProductAsync(stripeKey,
                        (string)platform.name, (string)platform.code);
                    await conn.ExecuteAsync(
                        "UPDATE shared.platforms SET stripe_product_id = @ProductId, updated_at = NOW() WHERE id = @Id",
                        new { ProductId = stripeProductId, Id = id });
                }

                stripePriceId = await CreateStripePriceAsync(stripeKey,
                    stripeProductId!, req.Name, req.MonthlyPriceCents);
            }

            var newId = await conn.QuerySingleAsync<long>(
                """
                INSERT INTO shared.platform_tiers
                    (platform_id, code, name, description, monthly_price_cents,
                     features_json, stripe_price_id, is_active, display_order,
                     created_at, updated_at)
                VALUES
                    (@PlatformId, @Code, @Name, @Description, @MonthlyPriceCents,
                     @FeaturesJson::jsonb, @StripePriceId, @IsActive, @DisplayOrder,
                     NOW(), NOW())
                RETURNING id
                """,
                new
                {
                    PlatformId = id,
                    req.Code,
                    req.Name,
                    Description = req.Description ?? "",
                    req.MonthlyPriceCents,
                    FeaturesJson = req.FeaturesJson ?? "{}",
                    StripePriceId = stripePriceId,
                    IsActive = req.IsActive ?? true,
                    DisplayOrder = req.DisplayOrder ?? 0
                });

            return Results.Ok(new { id = newId, stripePriceId, stripeProductId });
        });

        // PUT /api/admin/catalog/platforms/{id}/tiers/{tierId} — update a tier.
        // Code is immutable. Price changes create a new Stripe Price and
        // archive the old one; existing subscriptions bill at the new price
        // on next invoice after Commerce's SyncSubscriptionItemsAsync runs.
        group.MapPut("/platforms/{id:long}/tiers/{tierId:long}",
            async (HttpContext ctx, IDbConnectionFactory db, StripeSecretsProvider stripe,
                   long id, long tierId, TierUpsertRequest req) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();
            var current = await conn.QuerySingleOrDefaultAsync(
                """
                SELECT t.id, t.code, t.name, t.monthly_price_cents, t.stripe_price_id,
                       p.stripe_product_id, p.name AS platform_name, p.code AS platform_code
                FROM shared.platform_tiers t
                JOIN shared.platforms p ON p.id = t.platform_id
                WHERE t.id = @Id AND t.platform_id = @PlatformId
                """, new { Id = tierId, PlatformId = id });
            if (current is null) return ApiError.NotFound("Tier not found");

            var oldStripePriceId = (string?)current.stripe_price_id;
            var oldPriceCents    = (int)current.monthly_price_cents;
            var stripeProductId  = (string?)current.stripe_product_id ?? "";
            var newStripePriceId = oldStripePriceId;

            // Stripe Prices are immutable; if the price changed and Stripe is
            // configured, mint a new Price object and archive the old one.
            // If the Stripe secret is missing (edge case) the tier updates
            // locally with stripe_price_id unchanged — the admin can re-save
            // after the secret is populated.
            string stripeKey = "";
            try { stripeKey = await stripe.GetSecretKeyAsync(); }
            catch { /* no stripe configured — graceful local-dev fallback */ }

            var stripeConfigured = !string.IsNullOrEmpty(stripeKey);
            if (stripeConfigured &&
                (req.MonthlyPriceCents != oldPriceCents || string.IsNullOrEmpty(oldStripePriceId)))
            {
                if (string.IsNullOrEmpty(stripeProductId))
                {
                    stripeProductId = await CreateStripeProductAsync(stripeKey,
                        (string)current.platform_name, (string)current.platform_code);
                    await conn.ExecuteAsync(
                        "UPDATE shared.platforms SET stripe_product_id = @ProductId, updated_at = NOW() WHERE id = @Id",
                        new { ProductId = stripeProductId, Id = id });
                }

                newStripePriceId = await CreateStripePriceAsync(stripeKey,
                    stripeProductId, req.Name ?? (string)current.name, req.MonthlyPriceCents);

                if (!string.IsNullOrEmpty(oldStripePriceId))
                {
                    try
                    {
                        var priceService = new PriceService();
                        await priceService.UpdateAsync(oldStripePriceId,
                            new PriceUpdateOptions { Active = false },
                            new RequestOptions { ApiKey = stripeKey });
                    }
                    catch { /* non-fatal — the old price just stays active in Stripe */ }
                }
            }

            await conn.ExecuteAsync(
                """
                UPDATE shared.platform_tiers
                SET name                = COALESCE(@Name, name),
                    description         = COALESCE(@Description, description),
                    monthly_price_cents = @MonthlyPriceCents,
                    features_json       = COALESCE(@FeaturesJson::jsonb, features_json),
                    stripe_price_id     = @StripePriceId,
                    is_active           = COALESCE(@IsActive, is_active),
                    display_order       = COALESCE(@DisplayOrder, display_order),
                    updated_at          = NOW()
                WHERE id = @Id
                """,
                new
                {
                    Id = tierId,
                    req.Name,
                    req.Description,
                    req.MonthlyPriceCents,
                    req.FeaturesJson,
                    StripePriceId = newStripePriceId,
                    req.IsActive,
                    req.DisplayOrder
                });

            return Results.Ok(new { ok = true, stripePriceId = newStripePriceId });
        });

        // DELETE /api/admin/catalog/platforms/{id}/tiers/{tierId} — archive
        // (soft delete). Refuses if any stores or active subscriptions still
        // point at this tier, since that would orphan billing.
        group.MapDelete("/platforms/{id:long}/tiers/{tierId:long}",
            async (HttpContext ctx, IDbConnectionFactory db, long id, long tierId) =>
        {
            if (ctx.RequirePlatformAdmin() is { } denied) return denied;

            using var conn = await db.CreateOpenConnectionAsync();

            var storeCount = await conn.QuerySingleAsync<long>(
                "SELECT COUNT(*) FROM commerce.stores WHERE shared_tier_id = @Id",
                new { Id = tierId });
            var subCount = await conn.QuerySingleAsync<long>(
                "SELECT COUNT(*) FROM shared.org_subscriptions WHERE tier_id = @Id AND status = 'active'",
                new { Id = tierId });

            if (storeCount > 0 || subCount > 0)
                return ApiError.BadRequest(
                    $"Cannot archive tier: {storeCount} store(s) and {subCount} active subscription(s) still reference it. Reassign them first.");

            var updated = await conn.ExecuteAsync(
                """
                UPDATE shared.platform_tiers
                SET is_active = false, updated_at = NOW()
                WHERE id = @Id AND platform_id = @PlatformId
                """, new { Id = tierId, PlatformId = id });
            if (updated == 0) return ApiError.NotFound("Tier not found for this platform");
            return Results.Ok(new { ok = true });
        });

        // ── Public catalog read (no admin) ─────────────────────────────────
        // GET /api/catalog — enabled platforms + active tiers, for the
        // AlohaOne cart/checkout view. AllowAnonymous for now; the shell
        // gates the page itself behind login. Child platforms (Commerce
        // BillingService etc.) can also call this to resolve tier pricing.
        app.MapGet("/api/catalog", async (IDbConnectionFactory db) =>
        {
            using var conn = await db.CreateOpenConnectionAsync();
            var platforms = (await conn.QueryAsync(
                """
                SELECT id, code, name, description, icon, display_order
                FROM shared.platforms
                WHERE enabled = TRUE
                ORDER BY display_order, id
                """)).ToList();

            var tiers = (await conn.QueryAsync(
                """
                SELECT id, platform_id, code, name, description, monthly_price_cents,
                       features_json, display_order
                FROM shared.platform_tiers
                WHERE is_active = TRUE AND platform_id IN (
                    SELECT id FROM shared.platforms WHERE enabled = TRUE)
                ORDER BY platform_id, display_order, id
                """)).ToList();

            return Results.Ok(new { platforms, tiers });
        }).AllowAnonymous();
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static bool IsValidCode(string code) =>
        System.Text.RegularExpressions.Regex.IsMatch(code, @"^[a-z0-9_-]{2,40}$");

    private static async Task<string> CreateStripeProductAsync(
        string apiKey, string platformName, string platformCode)
    {
        var productService = new ProductService();
        var product = await productService.CreateAsync(new ProductCreateOptions
        {
            Name = $"AlohaOne — {platformName}",
            Metadata = new Dictionary<string, string>
            {
                ["purpose"] = "alohaone_platform_tier",
                ["platform_code"] = platformCode
            }
        }, new RequestOptions { ApiKey = apiKey });

        return product.Id;
    }

    private static async Task<string> CreateStripePriceAsync(
        string apiKey, string stripeProductId, string tierName, int unitAmountCents)
    {
        var priceService = new PriceService();
        var price = await priceService.CreateAsync(new PriceCreateOptions
        {
            Product = stripeProductId,
            UnitAmount = unitAmountCents,
            Currency = "usd",
            Recurring = new PriceRecurringOptions { Interval = "month" },
            Nickname = $"{tierName} (${unitAmountCents / 100.0:0.00}/mo)",
            Metadata = new Dictionary<string, string> { ["tier_name"] = tierName }
        }, new RequestOptions { ApiKey = apiKey });

        return price.Id;
    }

    public record PlatformEnabledRequest(bool Enabled);

    public record TierUpsertRequest(
        string? Code,
        string? Name,
        string? Description,
        int MonthlyPriceCents,
        string? FeaturesJson,
        bool? IsActive,
        int? DisplayOrder);
}
