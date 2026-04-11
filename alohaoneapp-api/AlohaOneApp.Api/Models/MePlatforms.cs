namespace AlohaOneApp.Api.Models;

/// <summary>
/// Shell-friendly view of what platforms a user has access to.
/// Built from the entitlements response by extracting platform.* keys.
/// </summary>
public record MePlatformsResponse(
    long user_id,
    DateTimeOffset fetched_at,
    List<EnabledPlatform> enabled_platforms
);

public record EnabledPlatform(
    string slug,                          // "crm", "commerce", "drive", etc.
    string product_title,
    long product_id,
    string? tier_status,                  // "active", "trialing", "past_due", null for one-time
    DateTimeOffset? current_period_end,
    Dictionary<string, string> limits     // limit.contacts → "5000", limit.storage_gb → "100", etc.
);
