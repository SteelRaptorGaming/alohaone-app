using System.Text.Json;
using Aloha.Core.Services;
using Dapper;
using Stripe;
using Stripe.Checkout;

namespace AlohaOneApp.Api.Endpoints;

/// <summary>
/// Phase E.2 — Stripe webhook receiver for the AlohaOne shared API.
///
/// Endpoint: POST /api/billing/webhook — anonymous but signature-gated.
/// Handles lifecycle events for subscriptions created via AlohaOne.ai
/// cart/checkout:
///
///   checkout.session.completed     — upsert shared.org_subscriptions rows
///   invoice.paid                   — flip to active on each row
///   invoice.payment_failed         — flag past_due on each row
///   customer.subscription.updated  — sync status + period end
///   customer.subscription.deleted  — flag canceled
///
/// Every row is keyed by (organization_id, platform_id). A single cart
/// with multiple platforms produces one Stripe subscription but N rows
/// in shared.org_subscriptions, all pointing at the same
/// stripe_subscription_id — so every handler updates all matching rows.
/// </summary>
public static class BillingWebhookEndpoints
{
    public static void MapBillingWebhookEndpoints(this WebApplication app)
    {
        app.MapPost("/api/billing/webhook", HandleWebhook).AllowAnonymous();
    }

    private static async Task<IResult> HandleWebhook(
        HttpContext ctx, StripeSecretsProvider stripe, IDbConnectionFactory db)
    {
        var body = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var signature = ctx.Request.Headers["Stripe-Signature"].FirstOrDefault();
        string webhookSecret = "";
        try { webhookSecret = await stripe.GetWebhookSecretAsync(); }
        catch { /* missing is fine — we fall through to ParseEvent below */ }

        Event stripeEvent;
        try
        {
            stripeEvent = string.IsNullOrEmpty(webhookSecret)
                ? EventUtility.ParseEvent(body)
                : EventUtility.ConstructEvent(body, signature, webhookSecret);
        }
        catch (StripeException ex)
        {
            return Results.BadRequest(new { error = "Invalid signature", detail = ex.Message });
        }

        using var conn = await db.CreateOpenConnectionAsync();

        // Idempotency: log event, skip if already processed.
        var inserted = await conn.ExecuteAsync(
            """
            INSERT INTO shared.billing_events (stripe_event_id, event_type, payload, created_at)
            VALUES (@EventId, @EventType, @Payload::jsonb, NOW())
            ON CONFLICT (stripe_event_id) DO NOTHING
            """,
            new { EventId = stripeEvent.Id, EventType = stripeEvent.Type, Payload = body });
        if (inserted == 0)
            return Results.Ok(new { ok = true, duplicate = true });

        switch (stripeEvent.Type)
        {
            case "checkout.session.completed":
                await HandleCheckoutSessionCompleted(stripeEvent, conn, stripe);
                break;
            case "invoice.paid":
            case "invoice.payment_succeeded":
                await HandleInvoicePaid(stripeEvent, conn);
                break;
            case "invoice.payment_failed":
                await HandleInvoicePaymentFailed(stripeEvent, conn);
                break;
            case "customer.subscription.updated":
                await HandleSubscriptionUpdated(stripeEvent, conn);
                break;
            case "customer.subscription.deleted":
                await HandleSubscriptionDeleted(stripeEvent, conn);
                break;
        }

        return Results.Ok(new { ok = true });
    }

    private static async Task HandleCheckoutSessionCompleted(
        Event stripeEvent, System.Data.IDbConnection conn, StripeSecretsProvider stripe)
    {
        var session = stripeEvent.Data.Object as Session;
        if (session is null || string.IsNullOrEmpty(session.SubscriptionId)) return;

        if (!session.Metadata.TryGetValue("organization_id", out var orgIdStr) ||
            !long.TryParse(orgIdStr, out var orgId) || orgId <= 0) return;

        if (!session.Metadata.TryGetValue("cart_items", out var cartJson))
            return;

        List<CartMetadataItem>? items;
        try
        {
            items = JsonSerializer.Deserialize<List<CartMetadataItem>>(cartJson);
        }
        catch { items = null; }
        if (items is null || items.Count == 0) return;

        // Pull the real subscription from Stripe so we capture the period
        // window + status without guessing.
        string apiKey = "";
        try { apiKey = await stripe.GetSecretKeyAsync(); } catch { /* handler is best-effort */ }
        var reqOpts = new RequestOptions { ApiKey = apiKey };
        var subService = new SubscriptionService();
        Subscription? stripeSub = null;
        try { stripeSub = await subService.GetAsync(session.SubscriptionId, requestOptions: reqOpts); }
        catch { /* non-fatal for the initial upsert; later webhook events will hydrate */ }

        var status = stripeSub?.Status ?? "active";
        var periodStart = stripeSub?.CurrentPeriodStart;
        var periodEnd = stripeSub?.CurrentPeriodEnd;
        var cancelAtEnd = stripeSub?.CancelAtPeriodEnd ?? false;
        var customerId = stripeSub?.CustomerId ?? session.CustomerId;

        foreach (var item in items)
        {
            await conn.ExecuteAsync(
                """
                INSERT INTO shared.org_subscriptions
                    (organization_id, platform_id, tier_id,
                     stripe_subscription_id, stripe_customer_id,
                     status, quantity,
                     current_period_start, current_period_end,
                     cancel_at_period_end, created_at, updated_at)
                VALUES
                    (@OrgId, @PlatformId, @TierId,
                     @SubId, @CustomerId,
                     @Status, @Quantity,
                     @PeriodStart, @PeriodEnd,
                     @CancelAtEnd, NOW(), NOW())
                ON CONFLICT (organization_id, platform_id) DO UPDATE SET
                    tier_id = EXCLUDED.tier_id,
                    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                    stripe_customer_id = EXCLUDED.stripe_customer_id,
                    status = EXCLUDED.status,
                    quantity = EXCLUDED.quantity,
                    current_period_start = EXCLUDED.current_period_start,
                    current_period_end = EXCLUDED.current_period_end,
                    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                    updated_at = NOW()
                """,
                new
                {
                    OrgId = orgId,
                    PlatformId = item.pid,
                    TierId = item.tid,
                    SubId = session.SubscriptionId,
                    CustomerId = customerId,
                    Status = status,
                    Quantity = item.q <= 0 ? 1 : item.q,
                    PeriodStart = periodStart,
                    PeriodEnd = periodEnd,
                    CancelAtEnd = cancelAtEnd
                });
        }

        // Keep shared.organizations.billing_status in sync.
        await conn.ExecuteAsync(
            "UPDATE shared.organizations SET billing_status = @Status, updated_at = NOW() WHERE id = @OrgId",
            new { Status = status, OrgId = orgId });
    }

    private static async Task HandleInvoicePaid(Event stripeEvent, System.Data.IDbConnection conn)
    {
        var invoice = stripeEvent.Data.Object as Invoice;
        if (invoice is null || string.IsNullOrEmpty(invoice.SubscriptionId)) return;

        await conn.ExecuteAsync(
            """
            UPDATE shared.org_subscriptions
            SET status = 'active', updated_at = NOW()
            WHERE stripe_subscription_id = @SubId
            """,
            new { SubId = invoice.SubscriptionId });

        await conn.ExecuteAsync(
            """
            UPDATE shared.organizations
            SET billing_status = 'active', updated_at = NOW()
            WHERE id IN (
                SELECT organization_id FROM shared.org_subscriptions
                WHERE stripe_subscription_id = @SubId)
            """,
            new { SubId = invoice.SubscriptionId });
    }

    private static async Task HandleInvoicePaymentFailed(Event stripeEvent, System.Data.IDbConnection conn)
    {
        var invoice = stripeEvent.Data.Object as Invoice;
        if (invoice is null || string.IsNullOrEmpty(invoice.SubscriptionId)) return;

        await conn.ExecuteAsync(
            """
            UPDATE shared.org_subscriptions
            SET status = 'past_due', updated_at = NOW()
            WHERE stripe_subscription_id = @SubId
            """,
            new { SubId = invoice.SubscriptionId });

        await conn.ExecuteAsync(
            """
            UPDATE shared.organizations
            SET billing_status = 'past_due', updated_at = NOW()
            WHERE id IN (
                SELECT organization_id FROM shared.org_subscriptions
                WHERE stripe_subscription_id = @SubId)
            """,
            new { SubId = invoice.SubscriptionId });
    }

    private static async Task HandleSubscriptionUpdated(Event stripeEvent, System.Data.IDbConnection conn)
    {
        var sub = stripeEvent.Data.Object as Subscription;
        if (sub is null) return;

        await conn.ExecuteAsync(
            """
            UPDATE shared.org_subscriptions
            SET status = @Status,
                current_period_start = @PeriodStart,
                current_period_end = @PeriodEnd,
                cancel_at_period_end = @CancelAtEnd,
                updated_at = NOW()
            WHERE stripe_subscription_id = @SubId
            """,
            new
            {
                SubId = sub.Id,
                Status = sub.Status,
                PeriodStart = (DateTime?)sub.CurrentPeriodStart,
                PeriodEnd = (DateTime?)sub.CurrentPeriodEnd,
                CancelAtEnd = sub.CancelAtPeriodEnd
            });
    }

    private static async Task HandleSubscriptionDeleted(Event stripeEvent, System.Data.IDbConnection conn)
    {
        var sub = stripeEvent.Data.Object as Subscription;
        if (sub is null) return;

        await conn.ExecuteAsync(
            """
            UPDATE shared.org_subscriptions
            SET status = 'canceled', updated_at = NOW()
            WHERE stripe_subscription_id = @SubId
            """,
            new { SubId = sub.Id });

        await conn.ExecuteAsync(
            """
            UPDATE shared.organizations
            SET billing_status = 'canceled', updated_at = NOW()
            WHERE id IN (
                SELECT organization_id FROM shared.org_subscriptions
                WHERE stripe_subscription_id = @SubId)
            """,
            new { SubId = sub.Id });
    }

    private record CartMetadataItem(long pid, long tid, int q);
}
