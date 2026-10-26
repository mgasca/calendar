using Calendar.Api.Endpoints;
using Calendar.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddSingleton(TimeProvider.System);
// Malformed bodies and unparsable parameters are client errors (400 problem details) in every environment;
// by default Development turns them into exceptions that surface as 500.
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);
builder.Services.AddCalendarInfrastructure(builder.Configuration);

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapHealthEndpoints();
app.MapEventEndpoints();
app.MapTaskEndpoints();
app.MapAgendaEndpoints();

await app.RunAsync();

