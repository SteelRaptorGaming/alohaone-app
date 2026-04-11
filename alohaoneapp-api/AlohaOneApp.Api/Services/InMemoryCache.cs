using System.Collections.Concurrent;

namespace AlohaOneApp.Api.Services;

/// <summary>
/// Tiny TTL-based concurrent cache. Per-Lambda-instance state — survives
/// warm invocations within the same container, evaporates on cold start.
/// Sufficient for the 60-second entitlements caching specified in v1.1 §12.1 Q3.
/// </summary>
public class InMemoryCache<TKey, TValue> where TKey : notnull
{
    private record Entry(TValue Value, DateTimeOffset ExpiresAt);

    private readonly ConcurrentDictionary<TKey, Entry> _entries = new();

    public bool TryGet(TKey key, out TValue value)
    {
        if (_entries.TryGetValue(key, out var entry) && entry.ExpiresAt > DateTimeOffset.UtcNow)
        {
            value = entry.Value;
            return true;
        }

        // Expired or missing — evict so the dictionary doesn't accumulate stale entries
        if (_entries.TryGetValue(key, out _))
        {
            _entries.TryRemove(key, out _);
        }

        value = default!;
        return false;
    }

    public void Set(TKey key, TValue value, TimeSpan ttl)
    {
        _entries[key] = new Entry(value, DateTimeOffset.UtcNow.Add(ttl));
    }

    public void Remove(TKey key)
    {
        _entries.TryRemove(key, out _);
    }
}
