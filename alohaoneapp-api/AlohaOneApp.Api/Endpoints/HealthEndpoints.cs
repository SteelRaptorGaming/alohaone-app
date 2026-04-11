namespace AlohaOneApp.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new
        {
            status = "healthy",
            product = "AlohaOneApp",
            version = typeof(HealthEndpoints).Assembly.GetName().Version?.ToString() ?? "0.1.0",
            time = DateTimeOffset.UtcNow,
        })).AllowAnonymous();
    }
}
