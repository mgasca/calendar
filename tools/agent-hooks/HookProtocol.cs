using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace AgentHooks;

/// <summary>What a hook tells Claude Code: an exit code, JSON on stdout and a note on stderr.</summary>
public sealed record HookResult(int ExitCode, string? Stdout = null, string? Stderr = null)
{
  /// <summary>Let the action through, with nothing to add.</summary>
  public static HookResult Pass { get; } = new(0);
}

/// <summary>A guard's verdict on a pre-tool-use action.</summary>
public sealed record Verdict(string Decision, string Reason);

/// <summary>The fields of a hook's stdin JSON that the guards read.</summary>
public sealed record HookInput(string? ToolName, string? Command, string? FilePath, string Cwd, bool StopHookActive)
{
  /// <summary>Parses the JSON Claude Code writes to a hook's stdin. Throws <see cref="JsonException"/> when malformed.</summary>
  public static HookInput Parse(string json)
  {
    using var doc = JsonDocument.Parse(json);
    JsonElement root = doc.RootElement;
    JsonElement toolInput = root.TryGetProperty("tool_input", out JsonElement input) ? input : default;
    return new HookInput(
      Text(root, "tool_name"),
      toolInput.ValueKind == JsonValueKind.Object ? Text(toolInput, "command") : null,
      toolInput.ValueKind == JsonValueKind.Object ? Text(toolInput, "file_path") : null,
      Text(root, "cwd") ?? Directory.GetCurrentDirectory(),
      root.TryGetProperty("stop_hook_active", out JsonElement active) && active.ValueKind == JsonValueKind.True);
  }

  private static string? Text(JsonElement element, string name) =>
    element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

/// <summary>Builds the JSON shapes Claude Code understands.</summary>
public static class HookOutput
{
  /// <summary>A PreToolUse decision: "deny" or "ask", with the reason shown to Claude.</summary>
  public static string PreToolUse(Verdict verdict) =>
    Write(w =>
    {
      w.WriteStartObject("hookSpecificOutput");
      w.WriteString("hookEventName", "PreToolUse");
      w.WriteString("permissionDecision", verdict.Decision);
      w.WriteString("permissionDecisionReason", verdict.Reason);
      w.WriteEndObject();
    });

  /// <summary>Extra context for Claude after an event, without blocking anything.</summary>
  public static string Context(string eventName, string text) =>
    Write(w =>
    {
      w.WriteStartObject("hookSpecificOutput");
      w.WriteString("hookEventName", eventName);
      w.WriteString("additionalContext", text);
      w.WriteEndObject();
    });

  /// <summary>Keeps Claude working, with the reason as its next instruction.</summary>
  public static string StopBlock(string reason) =>
    Write(w =>
    {
      w.WriteString("decision", "block");
      w.WriteString("reason", reason);
    });

  private static string Write(Action<Utf8JsonWriter> body)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      writer.WriteStartObject();
      body(writer);
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }
}
