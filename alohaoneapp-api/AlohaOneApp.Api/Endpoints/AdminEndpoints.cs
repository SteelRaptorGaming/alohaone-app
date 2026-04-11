using AlohaOneApp.Api.Models;
using AlohaOneApp.Api.Services;

namespace AlohaOneApp.Api.Endpoints;

/// <summary>Marker class for logger category in admin endpoints.</summary>
public sealed class AdminLogCategory { }

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin").AllowAnonymous();  // bearer-token validated inline below

        // ── POST /api/admin/purchases/grant ───────────────────────────────
        // Webhook from AlohaCommerce when a purchase grants entitlements.
        // Spec v1.1 §8 + §12.1 Q1.
        group.MapPost("/purchases/grant", (
            HttpContext ctx,
            PurchaseGrantEvent body,
            WebhookSecurity security,
            IdempotencyTracker idempotency,
            EntitlementsClient entitlements,
            ILogger<AdminLogCategory> log) =>
        {
            // Service-bearer auth — pre-shared, replaced with signed JWT after shared pool ships
            var auth = ctx.Request.Headers.Authorization.ToString();
            if (!security.ValidateBearer(auth))
            {
                log.LogWarning("Webhook rejected: invalid bearer from {RemoteIp}", ctx.Connection.RemoteIpAddress);
                return Results.Json(new { error = "INVALID_BEARER" }, statusCode: 401);
            }

            // Idempotency dedup
            if (!idempotency.MarkAndCheck(body.event_id))
            {
                log.LogInformation("Webhook duplicate event_id={EventId} for user {UserId} — acked without reprocessing",
                    body.event_id, body.user_id);
                return Results.Ok(new { received = true, duplicate = true });
            }

            log.LogInformation("Webhook accepted: event_id={EventId} kind={Kind} user={UserId} product={ProductId}",
                body.event_id, body.kind, body.user_id, body.product_id);

            // Flush the entitlements cache for this user — the next dashboard
            // load will pull fresh data from Commerce. We don't trust the
            // webhook payload as the source of truth (spec v1.1 §12.1 Q3).
            entitlements.InvalidateUser(body.user_id);

            // TODO when persistence lands: write to inbound_webhook_events table
            // for audit + retry-window dedup across cold starts. v1 dedupe is
            // per-Lambda-instance only.

            return Results.Ok(new { received = true, duplicate = false });
        });
    }
}
