using Calendar.Api;
using Calendar.Api.Endpoints;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi(options => options.AddSchemaTransformer((schema, _, _) =>
{
  // Properties read by ExplicitOffsetConverter lose their type in the generated schema; they are optional instants.
  if (schema.Type is null && schema.Format == "date-time")
  {
    schema.Type = JsonSchemaType.String | JsonSchemaType.Null;
  }

  return Task.CompletedTask;
}));
builder.Services.AddProblemDetails();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
  options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost);
var auth = builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
      options.Cookie.HttpOnly = true;
      options.Cookie.SameSite = SameSiteMode.Lax;
      options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
      options.ExpireTimeSpan = TimeSpan.FromHours(8);
      options.SlidingExpiration = false;
      options.Events.OnRedirectToLogin = context => ApiAuthentication.RedirectOrStatus(context, 401);
      options.Events.OnRedirectToAccessDenied = context => ApiAuthentication.RedirectOrStatus(context, 403);
    });
var clientId = builder.Configuration["Auth:Google:ClientId"];
var clientSecret = builder.Configuration["Auth:Google:ClientSecret"];
if (!string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret))
{
  auth.AddGoogle(options =>
  {
    options.ClientId = clientId;
    options.ClientSecret = clientSecret;
    options.CallbackPath = "/api/auth/callback/google";
    options.ClaimActions.MapJsonKey("picture", "picture");
    options.Events.OnCreatingTicket = context =>
    {
      var verified = context.User.TryGetProperty("email_verified", out var value) && value.ValueKind == System.Text.Json.JsonValueKind.True;
      var email = context.Principal?.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
      var allowed = builder.Configuration.GetSection("Auth:AllowedEmails").Get<string[]>() ?? [];
      if (!ApiAuthentication.IsAllowed(email, verified, allowed))
      {
        context.Fail("Access denied");
      }
      return Task.CompletedTask;
    };
    options.Events.OnRemoteFailure = context =>
    {
      context.HandleResponse();
      context.Response.Redirect("/signin?error=access_denied");
      return Task.CompletedTask;
    };
  });
}
builder.Services.AddAuthorization(options => options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
builder.Services.AddSingleton(TimeProvider.System);
// Binding failures throw in every environment and BadRequestExceptionHandler turns them into 400 problem details.
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
builder.Services.AddExceptionHandler<BadRequestExceptionHandler>();
builder.Services.AddCalendarInfrastructure(builder.Configuration);

var app = builder.Build();

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
  app.UseHsts();
  app.UseHttpsRedirection();
}
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
  app.MapOpenApi().AllowAnonymous();
}

app.MapHealthEndpoints();
app.MapAuthEndpoints(!string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret));
app.MapEventEndpoints();
app.MapTaskEndpoints();
app.MapAgendaEndpoints();

await app.RunAsync();

