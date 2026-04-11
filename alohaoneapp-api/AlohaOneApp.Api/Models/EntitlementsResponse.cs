namespace AlohaOneApp.Api.Models;

/// <summary>
/// Shape of the response from AlohaCommerce's
/// GET /api/customers/{user_id}/entitlements endpoint, per spec v1.1.
/// </summary>
public record EntitlementsResponse(
    long user_id,
    string cognito_sub,
    DateTimeOffset fetched_at,
    List<Entitlement> entitlements
);

public record Entitlement(
    string feature_key,
    string? feature_value,
    EntitlementSource source
);

public record EntitlementSource(
    string kind,
    long product_id,
    string product_title,
    long? subscription_id,
    string? status,
    DateTimeOffset? current_period_end
);
