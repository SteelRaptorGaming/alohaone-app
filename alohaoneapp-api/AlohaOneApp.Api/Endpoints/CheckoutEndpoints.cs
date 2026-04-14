using Aloha.Core.Auth;
using Aloha.Core.Models;
using Aloha.Core.Services;
using Dapper;
using Stripe;
using Stripe.Checkout;

namespace AlohaOneApp.Api.Endpoints;

/// <summary>
/// Phase E.2 — Cart + Stripe Checkout for the AlohaOne.ai shared API.
///
/// The cart is implicit on the request: the client POSTs an array of
/// {platformId, tierId, quantity} items and gets back a Stripe Checkout
/// Session URL. Cart UI lives entirely in the browser — AlohaOneApp
/// stores cart state in localStorage until the user hits "Check out",
/// at which point it gets shipped here.
///
/// Checkout creates (or re-uses) one Stripe Customer per organization.
/// A single cart produces one Stripe Subscription with one line item
/// per cart entry; the webhook at /api/billing/webhook upserts a row in
/// shared.org_subscriptions per platform, all pointing at the same
/// stripe_subscription_id.
/// </summary>
public static class CheckoutEndpoints
{
    public static void MapCheckoutEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/checkout")
            .WithTags("Checkout")
            .RequireAuthorization();

        // POST /api/checkout/create-session
        group.MapPost("/create-session",
            async (HttpContext ctx, IDbConnectionFactory db, StripeSecretsProvider stripe,
                   CreateCheckoutSessionRequest req) =>
        {
            if (ctx.RequireAuth() is { } denied) return denied;
            var auth = ctx.GetAuthContext();

            if (req.Items is null || req.Items.Length == 0)
                return ApiError.BadRequest("Cart is empty");
            if (req.Items.Length > 5)
                return ApiError.BadRequest("Cart holds at most five items");

            string apiKey;
            try { apiKey = await stripe.GetSecretKeyAsync(); }
            catch (Exception ex)
            {
                return ApiError.BadRequest("Stripe is not configured on this environment: " + ex.Message);
            }
            if (string.IsNullOrEmpty(apiKey))
                return ApiError.BadRequest("Stripe is not configured on this environment");
            var reqOpts = new RequestOptions { ApiKey = apiKey };

            using var conn = await db.CreateOpenConnectionAsync();

            // Resolve the user's organization. Phase E.2 MVP: if a user
            // belongs to multiple orgs we use the first one returned. A
            // later phase will let the user pick their active org.
            var orgRow = await conn.QuerySingleOrDefaultAsync(
                """
                SELECT o.id, o.name, o.stripe_customer_id
                FROM shared.organizations o
                JOIN shared.organization_users ou ON ou.organization_id = o.id
                WHERE ou.user_id = @UserId
                ORDER BY o.id
                LIMIT 1
                """, new { UserId = auth.UserId });
            if (orgRow is null)
                return ApiError.BadRequest("User has no organization");
            long orgId = (long)orgRow.id;
            string orgName = (string)orgRow.name;
            string? stripeCustomerId = (string?)orgRow.stripe_customer_id;

            // Look up each cart item's tier + platform in the shared catalog.
            // Enforces: platform enabled, tier active, and price has a real
            // Stripe Price ID (which requires STRIPE_SECRET_KEY to have been
            // set at the time the tier was saved).
            var platformIds = req.Items.Select(i => i.PlatformId).ToArray();
            var tierIds     = req.Items.Select(i => i.TierId).ToArray();

            var priced = (await conn.QueryAsync(
                """
                SELECT t.id AS tier_id, t.platform_id, t.stripe_price_id,
                       t.name AS tier_name, t.monthly_price_cents,
                       p.name AS platform_name, p.enabled
                FROM shared.platform_tiers t
                JOIN shared.platforms p ON p.id = t.platform_id
                WHERE t.platform_id = ANY(@PlatformIds)
                  AND t.id = ANY(@TierIds)
                  AND t.is_active = TRUE
                """, new { PlatformIds = platformIds, TierIds = tierIds })).ToList();

            var pricedByPlatform = priced.ToDictionary(r => (long)r.platform_id, r => r);

            var lineItems = new List<SessionLineItemOptions>();
            var cartSummary = new List<object>();
            foreach (var item in req.Items)
            {
                if (!pricedByPlatform.TryGetValue(item.PlatformId, out var row))
                    return ApiError.BadRequest(
                        $"Platform {item.PlatformId} / tier {item.TierId} not found or inactive");
                if ((bool)row.enabled != true)
                    return ApiError.BadRequest($"Platform {(string)row.platform_name} is not enabled for new signups");
                var stripePriceId = (string?)row.stripe_price_id;
                if (string.IsNullOrEmpty(stripePriceId))
                    return ApiError.BadRequest(
                        $"Tier {(string)row.tier_name} has no Stripe Price yet. Save it through the admin catalog first.");
                if ((long)row.tier_id != item.TierId)
                    return ApiError.BadRequest(
                        $"Tier id {item.TierId} does not match platform {item.PlatformId}");

                var qty = item.Quantity <= 0 ? 1 : item.Quantity;
                lineItems.Add(new SessionLineItemOptions { Price = stripePriceId, Quantity = qty });
                cartSummary.Add(new
                {
                    platform_id = item.PlatformId,
                    tier_id = item.TierId,
                    tier_name = (string)row.tier_name,
                    platform_name = (string)row.platform_name,
                    monthly_price_cents = (long)row.monthly_price_cents,
                    quantity = qty
                });
            }

            // Ensure the org has a Stripe customer — create lazily on first checkout.
            if (string.IsNullOrEmpty(stripeCustomerId))
            {
                var customerService = new CustomerService();
                var customer = await customerService.CreateAsync(new CustomerCreateOptions
                {
                    Name = orgName,
                    Email = auth.Email,
                    Metadata = new Dictionary<string, string>
                    {
                        ["organization_id"] = orgId.ToString(),
                        ["organization_name"] = orgName
                    }
                }, reqOpts);
                stripeCustomerId = customer.Id;

                await conn.ExecuteAsync(
                    "UPDATE shared.organizations SET stripe_customer_id = @CustomerId, updated_at = NOW() WHERE id = @OrgId",
                    new { CustomerId = stripeCustomerId, OrgId = orgId });
            }

            // Build the Checkout Session. We stamp organization_id + a
            // serialized cart into both session and subscription metadata
            // so the webhook can reconstruct the (org, platform) rows to
            // upsert without having to re-query our DB for cart state.
            var cartPayload = System.Text.Json.JsonSerializer.Serialize(
                req.Items.Select(i => new { pid = i.PlatformId, tid = i.TierId, q = i.Quantity }));

            var metadata = new Dictionary<string, string>
            {
                ["organization_id"] = orgId.ToString(),
                ["cart_items"] = cartPayload
            };

            var successUrl = (req.SuccessUrl ?? "https://app.alohaone.ai/checkout-success.html")
                             + (req.SuccessUrl != null && req.SuccessUrl.Contains('?') ? "&" : "?")
                             + "session_id={CHECKOUT_SESSION_ID}";
            var cancelUrl = req.CancelUrl ?? "https://app.alohaone.ai/catalog.html?canceled=1";

            var sessionService = new SessionService();
            var session = await sessionService.CreateAsync(new SessionCreateOptions
            {
                Customer = stripeCustomerId,
                Mode = "subscription",
                LineItems = lineItems,
                SuccessUrl = successUrl,
                CancelUrl = cancelUrl,
                Metadata = metadata,
                SubscriptionData = new SessionSubscriptionDataOptions { Metadata = metadata },
                AllowPromotionCodes = false
            }, reqOpts);

            return Results.Ok(new
            {
                url = session.Url,
                sessionId = session.Id,
                organizationId = orgId,
                cart = cartSummary
            });
        });
    }

    public record CheckoutItem(long PlatformId, long TierId, int Quantity);

    public record CreateCheckoutSessionRequest(
        CheckoutItem[] Items,
        string? SuccessUrl,
        string? CancelUrl);
}
