using System.Net.Http.Headers;
using System.Net.Http.Json;
using AlohaOneApp.Api.Models;

namespace AlohaOneApp.Api.Services;

/// <summary>
/// HTTP client for AlohaCommerce's GET /api/customers/{user_id}/entitlements endpoint.
///
/// Auth: pre-shared-pool, uses a static service bearer from configuration
/// (`SERVICE_BEARER` env, sourced from Secrets Manager). Replaced with a signed
/// JWT after the shared AlohaOne Cognito pool ships (spec v1.1 §9).
///
/// Caching: in-process 60-second cache per user_id, per spec v1.1 §12.1 Q3.
/// Webhook receipt flushes the relevant entry via InvalidateUser().
/// </summary>
public class EntitlementsClient
{
    private readonly HttpClient _http;
    private readonly ILogger<EntitlementsClient> _log;
    private readonly string _bearer;
    private readonly InMemoryCache<long, EntitlementsResponse> _cache;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

    public EntitlementsClient(
        IHttpClientFactory httpFactory,
        IConfiguration config,
        ILogger<EntitlementsClient> log)
    {
        _http = httpFactory.CreateClient("AlohaCommerce");
        _log = log;
        _bearer = config["SERVICE_BEARER"] ?? "dogfood_dev_placeholder_replace_before_prod";
        _cache = new InMemoryCache<long, EntitlementsResponse>();

        var commerceBase = config["ALOHACOMMERCE_API_BASE"] ?? "https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com";
        _http.BaseAddress = new Uri(commerceBase);
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    /// <summary>
    /// Fetch entitlements for a user, using a 60-second in-memory cache.
    /// Returns null on 404 (user not found in Commerce yet — common pre-shared-identity)
    /// or on transient errors. Caller should fall back to "no platforms enabled" UI.
    /// </summary>
    public async Task<EntitlementsResponse?> GetForUserAsync(long userId, CancellationToken ct = default)
    {
        if (_cache.TryGet(userId, out var cached))
        {
            return cached;
        }

        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get, $"/api/customers/{userId}/entitlements");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bearer);

            var resp = await _http.SendAsync(req, ct);
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _log.LogInformation("Entitlements: user {UserId} not found in Commerce (404)", userId);
                return null;
            }
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogWarning("Entitlements: Commerce returned {Status} for user {UserId}", resp.StatusCode, userId);
                return null;
            }

            var data = await resp.Content.ReadFromJsonAsync<EntitlementsResponse>(cancellationToken: ct);
            if (data != null)
            {
                _cache.Set(userId, data, CacheTtl);
            }
            return data;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Entitlements: failed to fetch for user {UserId}", userId);
            return null;
        }
    }

    /// <summary>
    /// Webhook receipt flushes the cache for the affected user so the next
    /// dashboard load pulls fresh entitlements. Webhooks are invalidation
    /// hints, not the source of truth, per spec v1.1 §12.1 Q3.
    /// </summary>
    public void InvalidateUser(long userId)
    {
        _cache.Remove(userId);
        _log.LogInformation("Entitlements cache flushed for user {UserId}", userId);
    }
}
