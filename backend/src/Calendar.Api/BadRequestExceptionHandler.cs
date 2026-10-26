using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;

namespace Calendar.Api;

/// <summary>
/// Turns request-binding failures into 400 problem details in every environment. A JSON failure becomes a
/// validation problem naming the offending field (from the JSON path); anything else a plain 400.
/// </summary>
internal sealed class BadRequestExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not BadHttpRequestException bad)
        {
            return false;
        }

        IResult result;
        if (bad.InnerException is JsonException { Path: { Length: > 0 } path } json)
        {
            var field = path.StartsWith("$.", StringComparison.Ordinal) ? path[2..] : path;
            result = Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [FirstLine(json.Message)] });
        }
        else
        {
            result = Results.Problem(statusCode: bad.StatusCode, title: "Bad request.");
        }

        await result.ExecuteAsync(httpContext);
        return true;
    }

    private static string FirstLine(string message)
    {
        var end = message.IndexOf(" Path:", StringComparison.Ordinal);
        return end > 0 ? message[..end] : message;
    }
}
