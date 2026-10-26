using Calendar.Api;
using Calendar.Api.Endpoints;
using Calendar.Infrastructure;
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
builder.Services.AddSingleton(TimeProvider.System);
// Binding failures throw in every environment and BadRequestExceptionHandler turns them into 400 problem details.
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
builder.Services.AddExceptionHandler<BadRequestExceptionHandler>();
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

