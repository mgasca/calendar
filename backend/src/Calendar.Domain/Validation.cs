namespace Calendar.Domain;

/// <summary>Shared input validation for domain entities.</summary>
internal static class Validation
{
  public const int MaxTitleLength = 200;
  public const int MaxLocationLength = 200;
  public const int MaxNotesLength = 4000;

  /// <summary>Trims a required title; throws when blank or longer than <see cref="MaxTitleLength"/>.</summary>
  public static string NormalizeTitle(string? title, string paramName)
  {
    if (string.IsNullOrWhiteSpace(title))
    {
      throw new ArgumentException("Title is required.", paramName);
    }

    var trimmed = title.Trim();
    if (trimmed.Length > MaxTitleLength)
    {
      throw new ArgumentException($"Title must be at most {MaxTitleLength} characters.", paramName);
    }

    return trimmed;
  }

  /// <summary>Trims an optional text; blank becomes <c>null</c>; throws when longer than <paramref name="maxLength"/>.</summary>
  public static string? NormalizeOptional(string? value, int maxLength, string paramName)
  {
    var trimmed = value?.Trim();
    if (string.IsNullOrEmpty(trimmed))
    {
      return null;
    }

    if (trimmed.Length > maxLength)
    {
      throw new ArgumentException($"Value must be at most {maxLength} characters.", paramName);
    }

    return trimmed;
  }
}
