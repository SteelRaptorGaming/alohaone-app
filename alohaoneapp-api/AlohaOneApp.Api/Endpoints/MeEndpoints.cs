using Aloha.Core.Auth;
using Aloha.Core.Services;
using AlohaOneApp.Api.Models;
using AlohaOneApp.Api.Services;
using Dapper;

namespace AlohaOneApp.Api.Endpoints;

public static class MeEndpoints
{
    public static void MapMeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/me");
        // Auth: AlohaCore JWT middleware fills HttpContext.User. We pull
        // the local user_id and cognito_sub from there.

        // ── GET /api/me ──────────────────────────────────────────────────
        // Current user profile, role detection, etc.
        group.MapGet("/", (HttpContext ctx) =>
        {
            // TODO: pull real user data once shared identity lands. For v1
            // we just echo the JWT claims.
            var sub = ctx.User?.FindFirst("sub")?.Value;
            var email = ctx.User?.FindFirst("email")?.Value;
            return Results.Ok(new
            {
                cognito_sub = sub,
                email,
                authenticated = ctx.User?.Identity?.IsAuthenticated ?? false,
            });
        });

        // ── GET /api/me/platforms ────────────────────────────────────────
        // What platforms does this user have access to? Pulls from Commerce
        // via EntitlementsClient and reshapes for the AlohaOneApp shell.
        // Used by the Home tile-grid and the platform dropdown.
        group.MapGet("/platforms", async (HttpContext ctx, EntitlementsClient entitlements) =>
        {
            // Pull the AlohaCommerce user_id from the JWT custom claim.
            // TODO: real claim mapping after shared identity lands. For v1
            // we accept a ?user_id query param to unblock testing.
            var userIdStr = ctx.Request.Query["user_id"].ToString();
            if (!long.TryParse(userIdStr, out var userId) || userId <= 0)
            {
                return Results.BadRequest(new
                {
                    error = "USER_ID_REQUIRED",
                    detail = "Pass ?user_id=N until shared identity wires the JWT claim mapping.",
                });
            }

            var resp = await entitlements.GetForUserAsync(userId);
            if (resp == null)
            {
                // No entitlements yet — return empty list rather than 404.
                // The shell renders this as the "no platforms enabled yet" state.
                return Results.Ok(new MePlatformsResponse(
                    user_id: userId,
                    fetched_at: DateTimeOffset.UtcNow,
                    enabled_platforms: new List<EnabledPlatform>()
                ));
            }

            // Group entitlements by source.product_id, pick out the platform.{slug}
            // key as the slug, and aggregate any limit.* keys into the limits dict.
            var byProduct = resp.entitlements
                .GroupBy(e => e.source.product_id)
                .Select(g =>
                {
                    var first = g.First();
                    var platformKey = g.FirstOrDefault(e => e.feature_key.StartsWith("platform."));
                    if (platformKey == null) return null;

                    var slug = platformKey.feature_key.Substring("platform.".Length);
                    var limits = g
                        .Where(e => e.feature_key.StartsWith("limit."))
                        .ToDictionary(
                            e => e.feature_key.Substring("limit.".Length),
                            e => e.feature_value ?? "");

                    return new EnabledPlatform(
                        slug: slug,
                        product_title: first.source.product_title,
                        product_id: first.source.product_id,
                        tier_status: first.source.status,
                        current_period_end: first.source.current_period_end,
                        limits: limits
                    );
                })
                .Where(p => p != null)
                .ToList()!;

            return Results.Ok(new MePlatformsResponse(
                user_id: resp.user_id,
                fetched_at: resp.fetched_at,
                enabled_platforms: byProduct!
            ));
        }).AllowAnonymous();  // pre-shared-identity: relax auth so the shell can call this with ?user_id

        // ── GET /api/me/billing ──────────────────────────────────────────
        // TODO: real subscription state from Commerce. Stub for v1.
        group.MapGet("/billing", () => Results.Ok(new
        {
            monthly_total = 0m,
            currency = "USD",
            subscriptions = Array.Empty<object>(),
            payment_method = (object?)null,
            note = "Stub — real billing wires up after shared identity lands.",
        })).AllowAnonymous();

        // ── GET /api/me/activity ─────────────────────────────────────────
        // TODO: real cross-platform activity feed. Stub for v1.
        group.MapGet("/activity", () => Results.Ok(new
        {
            items = Array.Empty<object>(),
            note = "Stub — real activity feed wires up after shared identity lands.",
        })).AllowAnonymous();

        // ── GET /api/me/subscriptions ────────────────────────────────────
        // Phase E.2 — what platforms is the current user's organization
        // actually subscribed to? Drives the AlohaOne dashboard tile grid
        // and any client-side gating. Returns one row per
        // (org, platform, status) in shared.org_subscriptions, joined up
        // with tier and platform metadata so the shell can render without
        // extra round-trips. Reuses the "first org by id" heuristic from
        // CheckoutEndpoints until a user-selected active org lands.
        group.MapGet("/subscriptions",
            async (HttpContext ctx, IDbConnectionFactory db) =>
        {
            if (ctx.RequireAuth() is { } denied) return denied;
            var auth = ctx.GetAuthContext();

            using var conn = await db.CreateOpenConnectionAsync();

            var org = await conn.QuerySingleOrDefaultAsync(
                """
                SELECT o.id, o.name
                FROM shared.organizations o
                JOIN shared.organization_users ou ON ou.organization_id = o.id
                WHERE ou.user_id = @UserId
                ORDER BY o.id
                LIMIT 1
                """, new { UserId = auth.UserId });

            if (org is null)
            {
                return Results.Ok(new
                {
                    organization_id = (long?)null,
                    organization_name = (string?)null,
                    subscriptions = Array.Empty<object>()
                });
            }

            var rows = await conn.QueryAsync(
                """
                SELECT s.id, s.platform_id, s.tier_id, s.status,
                       s.current_period_end, s.stripe_subscription_id,
                       s.created_at, s.updated_at,
                       p.code  AS platform_code,
                       p.name  AS platform_name,
                       p.icon  AS platform_icon,
                       p.enabled AS platform_enabled,
                       t.code  AS tier_code,
                       t.name  AS tier_name,
                       t.monthly_price_cents
                FROM shared.org_subscriptions s
                JOIN shared.platforms      p ON p.id = s.platform_id
                LEFT JOIN shared.platform_tiers t ON t.id = s.tier_id
                WHERE s.organization_id = @OrgId
                ORDER BY p.display_order, p.id
                """, new { OrgId = (long)org.id });

            return Results.Ok(new
            {
                organization_id = (long)org.id,
                organization_name = (string)org.name,
                subscriptions = rows
            });
        });
    }
}
