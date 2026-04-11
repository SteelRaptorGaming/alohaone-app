using System.Security.Cryptography;
using System.Text;

namespace AlohaOneApp.Api.Services;

/// <summary>
/// Bearer-token validation for incoming webhooks from AlohaCommerce.
/// Pre-shared-pool: a single static bearer from Secrets Manager (spec v1.1 §12.1 Q4).
/// Replaced with signed-JWT validation when the shared AlohaOne Cognito pool ships.
/// Constant-time comparison to avoid timing side channels.
/// </summary>
public class WebhookSecurity
{
    private readonly byte[] _expected;

    public WebhookSecurity(IConfiguration config)
    {
        var bearer = config["SERVICE_BEARER"] ?? "dogfood_dev_placeholder_replace_before_prod";
        _expected = Encoding.UTF8.GetBytes(bearer);
    }

    public bool ValidateBearer(string? authHeader)
    {
        if (string.IsNullOrWhiteSpace(authHeader)) return false;
        if (!authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;

        var supplied = Encoding.UTF8.GetBytes(authHeader.Substring(7).Trim());
        return CryptographicOperations.FixedTimeEquals(_expected, supplied);
    }
}
