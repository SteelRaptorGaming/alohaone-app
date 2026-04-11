namespace AlohaOneApp.Api.Services;

/// <summary>
/// Tracks event_ids we've already seen so duplicate webhook deliveries don't
/// double-fire side effects. v1: in-memory only (per-Lambda-instance). v2:
/// promote to a database-backed table so deduplication holds across cold
/// starts and concurrent Lambda containers.
/// </summary>
public class IdempotencyTracker
{
    private readonly InMemoryCache<string, bool> _seen = new();
    private static readonly TimeSpan RetentionWindow = TimeSpan.FromHours(24);

    /// <summary>
    /// Returns true if this is the first time we've seen this event_id within
    /// the retention window. Returns false if it's a duplicate.
    /// </summary>
    public bool MarkAndCheck(string eventId)
    {
        if (string.IsNullOrEmpty(eventId)) return true;  // unkeyed events always processed

        if (_seen.TryGet(eventId, out _)) return false;  // duplicate

        _seen.Set(eventId, true, RetentionWindow);
        return true;
    }
}
