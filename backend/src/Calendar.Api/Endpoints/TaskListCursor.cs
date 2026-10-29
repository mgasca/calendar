using System.Text.Json;
using Calendar.Infrastructure.Queries;
using Microsoft.AspNetCore.WebUtilities;

namespace Calendar.Api.Endpoints;

/// <summary>
/// The opaque <c>cursor</c> of the task list: the view and the key of a page's last task, as base64url JSON.
/// A cursor only continues the view it was issued for.
/// </summary>
internal static class TaskListCursor
{
  private sealed record Payload(TaskListView View, Guid Id, DateOnly? DueDate, DateTimeOffset? Instant);

  public static string Encode(TaskListView view, TaskListKey key) =>
      WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new Payload(view, key.Id, key.DueDate, key.Instant)));

  /// <summary>Decodes a cursor issued for <paramref name="view"/>; <c>false</c> when it is malformed or for another view.</summary>
  public static bool TryDecode(string cursor, TaskListView view, out TaskListKey key)
  {
    key = new(Guid.Empty, null, null);
    Payload? payload;
    try
    {
      payload = JsonSerializer.Deserialize<Payload>(WebEncoders.Base64UrlDecode(cursor));
    }
    catch (Exception ex) when (ex is FormatException or JsonException)
    {
      return false;
    }

    var complete = payload switch
    {
      null => false,
      { Id: var id } when id == Guid.Empty => false,
      { View: TaskListView.Upcoming or TaskListView.Overdue, DueDate: null } => false,
      { View: TaskListView.Completed, Instant: null } => false,
      _ => true,
    };
    if (!complete || payload!.View != view)
    {
      return false;
    }

    key = new(payload.Id, payload.DueDate, payload.Instant);
    return true;
  }
}
