using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Calendar.Api.Contracts;

/// <summary>
/// Reads an instant only when it carries an explicit offset (<c>Z</c> or <c>±hh:mm</c>). The default converter
/// would read "2026-10-26T10:00:00" in the server's local offset, silently storing the wrong instant.
/// </summary>
internal sealed partial class ExplicitOffsetConverter : JsonConverter<DateTimeOffset>
{
  [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
  private static partial Regex WithOffset();

  public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
  {
    var text = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
    if (text is null || !WithOffset().IsMatch(text)
        || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var value))
    {
      throw new JsonException("Expected an instant with an explicit offset, e.g. 2026-10-26T14:00:00Z or 2026-10-26T10:00:00-04:00.");
    }

    return value;
  }

  public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
      writer.WriteStringValue(value);
}
