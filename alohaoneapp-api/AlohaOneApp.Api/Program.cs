using Aloha.Core;
using AlohaOneApp.Api.Endpoints;
using AlohaOneApp.Api.Services;

// Npgsql 8.x maps TIMESTAMPTZ → DateTimeOffset by default; Dapper expects DateTime.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// ── Lambda hosting ──────────────────────────────────────────────────────────
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

// ── AlohaCore: auth (JWT), tenancy, db, audit, S3, webhooks ─────────────────
builder.Services.AddAlohaCore(builder.Configuration);

// ── App services ────────────────────────────────────────────────────────────
builder.Services.AddHttpClient("AlohaCommerce");
builder.Services.AddSingleton<EntitlementsClient>();
builder.Services.AddSingleton<WebhookSecurity>();
builder.Services.AddSingleton<IdempotencyTracker>();

// ── CORS (the AlohaOneApp shell calls this API from app.alohaone.ai) ────────
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(p => p
        .AllowAnyOrigin()
        .AllowAnyMethod()
        .AllowAnyHeader()));

var app = builder.Build();

// Standard Aloha middleware: CORS, Auth, Authorization, AuthContext
app.UseAlohaCore();

// ── Endpoint groups ─────────────────────────────────────────────────────────
app.MapHealthEndpoints();
app.MapAdminEndpoints();   // POST /api/admin/purchases/grant (webhook receiver)
app.MapMeEndpoints();      // GET /api/me, /api/me/platforms, /api/me/billing, /api/me/activity

app.Run();
