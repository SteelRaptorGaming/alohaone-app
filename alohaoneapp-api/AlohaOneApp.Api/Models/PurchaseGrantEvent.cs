namespace AlohaOneApp.Api.Models;

/// <summary>
/// Webhook payload posted by AlohaCommerce to
/// POST /api/admin/purchases/grant when a purchase completes or
/// a subscription state changes. Schema per spec v1.1 §8.
/// </summary>
public record PurchaseGrantEvent(
    string event_id,
    DateTimeOffset occurred_at,
    long user_id,
    string cognito_sub,
    string kind,                          // subscription_started | subscription_updated | subscription_canceled | digital_purchased | digital_refunded
    long product_id,
    string product_title,
    long? subscription_id,
    string? status,
    DateTimeOffset? current_period_end,
    List<EntitlementSnapshot> entitlements_snapshot
);

public record EntitlementSnapshot(
    string feature_key,
    string? feature_value
);
