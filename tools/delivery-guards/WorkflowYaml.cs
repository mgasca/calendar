namespace DeliveryGuards;

/// <summary>A node of a YAML document: a mapping, a sequence or a scalar.</summary>
public interface IYamlNode;

/// <summary>A scalar, with its quotes removed; a block scalar keeps its line breaks.</summary>
public sealed record YamlScalar(string Value) : IYamlNode;

/// <summary>A sequence, block (<c>- item</c>) or flow (<c>[a, b]</c>).</summary>
public sealed record YamlSequence(IReadOnlyList<IYamlNode> Items) : IYamlNode;

/// <summary>A block mapping, keys in document order.</summary>
public sealed record YamlMapping(IReadOnlyList<KeyValuePair<string, IYamlNode>> Entries) : IYamlNode
{
  /// <summary>The value of <paramref name="key"/>, or null when the mapping has no such key.</summary>
  public IYamlNode? this[string key] => Entries.FirstOrDefault(e => e.Key == key).Value;

  /// <summary>The scalar value of <paramref name="key"/>, or null when it is missing or not a scalar.</summary>
  public string? Text(string key) => (this[key] as YamlScalar)?.Value;

  /// <summary>The mapping under <paramref name="key"/>, or null.</summary>
  public YamlMapping? Map(string key) => this[key] as YamlMapping;

  /// <summary>The items under <paramref name="key"/>: a sequence's items, a single scalar as one item, or none.</summary>
  public IReadOnlyList<IYamlNode> List(string key) => this[key] switch
  {
    YamlSequence s => s.Items,
    YamlScalar s => [s],
    _ => [],
  };
}

/// <summary>
/// Reads the subset of YAML that the GitHub workflows in this repo use: block mappings and sequences, flow sequences
/// of scalars, literal and folded block scalars, quoted and plain scalars, and comments. Anchors, aliases, tags, flow
/// mappings and multi-document streams are not supported; a document that needs them fails with
/// <see cref="FormatException"/> rather than being misread.
/// </summary>
public static class WorkflowYaml
{
  private sealed record Line(int Number, int Indent, string Text);

  /// <summary>Parses <paramref name="yaml"/> into its root node.</summary>
  public static IYamlNode Parse(string yaml)
  {
    var raw = yaml.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
    var reader = new Reader(raw);
    return reader.ParseDocument();
  }

  private sealed class Reader(string[] raw)
  {
    private int _next;
    private Line? _pending;

    public IYamlNode ParseDocument()
    {
      Line first = Peek() ?? throw new FormatException("The document is empty.");
      IYamlNode root = ParseBlock(first.Indent);
      if (Peek() is { } extra)
      {
        throw new FormatException($"Line {extra.Number}: unexpected indentation.");
      }

      return root;
    }

    /// <summary>The next significant line (not blank, not a comment), without consuming it.</summary>
    private Line? Peek()
    {
      if (_pending is not null)
      {
        return _pending;
      }

      while (_next < raw.Length)
      {
        var text = raw[_next];
        var trimmed = text.TrimStart(' ');
        if (trimmed.Length == 0 || trimmed.StartsWith('#'))
        {
          _next++;
          continue;
        }

        if (trimmed.StartsWith('\t'))
        {
          throw new FormatException($"Line {_next + 1}: tabs are not allowed in indentation.");
        }

        if (trimmed is "---" or "...")
        {
          throw new FormatException($"Line {_next + 1}: multi-document streams are not supported.");
        }

        _pending = new Line(_next + 1, text.Length - trimmed.Length, StripComment(trimmed).TrimEnd());
        _next++;
        return _pending;
      }

      return null;
    }

    private void Skip()
    {
      _ = Peek() ?? throw new FormatException("Unexpected end of document.");
      _pending = null;
    }

    /// <summary>Puts back a line whose first part was consumed (the content after a <c>- </c>).</summary>
    private void Push(Line line) => _pending = line;

    private IYamlNode ParseBlock(int indent)
    {
      Line line = Peek()!;
      return IsSequenceItem(line.Text) ? ParseSequence(indent) : ParseMapping(indent);
    }

    private YamlSequence ParseSequence(int indent)
    {
      var items = new List<IYamlNode>();
      while (Peek() is { } line && line.Indent == indent && IsSequenceItem(line.Text))
      {
        Skip();
        var content = line.Text.Length == 1 ? "" : line.Text[2..].TrimStart(' ');
        if (content.Length == 0)
        {
          items.Add(ParseNested(indent));
          continue;
        }

        var contentIndent = line.Indent + (line.Text.Length - content.Length);
        if (SplitKey(content) is not null)
        {
          // "- key: value": a mapping whose first entry sits on the item's line.
          Push(new Line(line.Number, contentIndent, content));
          items.Add(ParseMapping(contentIndent));
        }
        else
        {
          items.Add(ParseInlineValue(content, line, indent));
        }
      }

      return new YamlSequence(items);
    }

    private YamlMapping ParseMapping(int indent)
    {
      var entries = new List<KeyValuePair<string, IYamlNode>>();
      while (Peek() is { } line && line.Indent == indent && !IsSequenceItem(line.Text))
      {
        Skip();
        (var key, var value) = SplitKey(line.Text) ?? throw new FormatException($"Line {line.Number}: expected 'key: value'.");
        if (entries.Exists(e => e.Key == key))
        {
          throw new FormatException($"Line {line.Number}: duplicate key '{key}'.");
        }

        IYamlNode node;
        if (value.Length > 0)
        {
          node = ParseInlineValue(value, line, indent);
        }
        else if (Peek() is { } next && next.Indent == indent && IsSequenceItem(next.Text))
        {
          // A sequence may sit at its key's own indentation.
          node = ParseSequence(indent);
        }
        else
        {
          node = ParseNested(indent);
        }

        entries.Add(new KeyValuePair<string, IYamlNode>(key, node));
      }

      if (Peek() is { } stray && stray.Indent > indent)
      {
        throw new FormatException($"Line {stray.Number}: unexpected indentation.");
      }

      return new YamlMapping(entries);
    }

    private IYamlNode ParseNested(int indent) =>
      Peek() is { } next && next.Indent > indent ? ParseBlock(next.Indent) : new YamlScalar("");

    private IYamlNode ParseInlineValue(string value, Line line, int indent)
    {
      if (value[0] is '|' or '>')
      {
        return ReadBlockScalar(value, line, indent);
      }

      if (value[0] == '[')
      {
        return ParseFlowSequence(value, line);
      }

      if (value[0] is '{' or '&' or '*' or '!')
      {
        throw new FormatException($"Line {line.Number}: flow mappings, anchors, aliases and tags are not supported.");
      }

      return new YamlScalar(Unquote(value, line));
    }

    private YamlScalar ReadBlockScalar(string header, Line line, int indent)
    {
      var folded = header[0] == '>';
      var chomp = header.Length > 1 ? header[1] : ' ';
      if (header.Length > 2 || (header.Length == 2 && chomp is not '-' and not '+'))
      {
        throw new FormatException($"Line {line.Number}: block scalar indentation indicators are not supported.");
      }

      // Raw lines, comments and blank lines included, until one is indented no deeper than the key.
      _pending = null;
      var lines = new List<string>();
      int? blockIndent = null;
      while (_next < raw.Length)
      {
        var text = raw[_next];
        var trimmed = text.TrimStart(' ');
        var lineIndent = text.Length - trimmed.Length;
        if (trimmed.Length > 0 && lineIndent <= indent)
        {
          break;
        }

        if (trimmed.Length > 0)
        {
          blockIndent ??= lineIndent;
          if (lineIndent < blockIndent)
          {
            throw new FormatException($"Line {_next + 1}: block scalar line is less indented than its first line.");
          }
        }

        lines.Add(trimmed.Length == 0 ? "" : text[blockIndent!.Value..]);
        _next++;
      }

      while (lines.Count > 0 && lines[^1].Length == 0)
      {
        lines.RemoveAt(lines.Count - 1);
      }

      var body = folded ? Fold(lines) : string.Join('\n', lines);
      return new YamlScalar(chomp == '-' || body.Length == 0 ? body : body + "\n");
    }

    private static string Fold(List<string> lines)
    {
      var parts = new List<string>();
      var paragraph = new List<string>();
      foreach (var l in lines)
      {
        if (l.Length == 0)
        {
          parts.Add(string.Join(' ', paragraph));
          paragraph.Clear();
        }
        else
        {
          paragraph.Add(l);
        }
      }

      parts.Add(string.Join(' ', paragraph));
      return string.Join('\n', parts);
    }

    private static YamlSequence ParseFlowSequence(string value, Line line)
    {
      if (!value.EndsWith(']'))
      {
        throw new FormatException($"Line {line.Number}: a flow sequence must close on its own line.");
      }

      var inner = value[1..^1].Trim();
      if (inner.Length == 0)
      {
        return new YamlSequence([]);
      }

      if (inner.Contains('[', StringComparison.Ordinal) || inner.Contains('{', StringComparison.Ordinal))
      {
        throw new FormatException($"Line {line.Number}: nested flow collections are not supported.");
      }

      return new YamlSequence([.. inner.Split(',').Select(item => (IYamlNode)new YamlScalar(Unquote(item.Trim(), line)))]);
    }

    private static bool IsSequenceItem(string text) => text == "-" || text.StartsWith("- ", StringComparison.Ordinal);

    /// <summary>Splits <c>key: value</c> at the first colon outside quotes that ends the text or precedes a space.</summary>
    private static (string Key, string Value)? SplitKey(string text)
    {
      if (text[0] is '"' or '\'')
      {
        var close = text.IndexOf(text[0], 1);
        if (close > 0 && close + 1 < text.Length && text[close + 1] == ':')
        {
          return (text[1..close], text[(close + 2)..].Trim());
        }

        return null;
      }

      for (var i = 0; i < text.Length; i++)
      {
        if (text[i] == ':' && (i + 1 == text.Length || text[i + 1] == ' '))
        {
          return (text[..i].TrimEnd(), text[(i + 1)..].Trim());
        }
      }

      return null;
    }

    /// <summary>Removes a <c> #</c> comment that is outside quotes; a <c>#</c> inside a word stays.</summary>
    private static string StripComment(string text)
    {
      char? quote = null;
      for (var i = 0; i < text.Length; i++)
      {
        var c = text[i];
        if (quote is not null)
        {
          if (c == quote)
          {
            quote = null;
          }
        }
        else if (c is '"' or '\'' && (i == 0 || text[i - 1] is ' ' or ':' or '[' or ','))
        {
          quote = c;
        }
        else if (c == '#' && i > 0 && text[i - 1] == ' ')
        {
          return text[..i];
        }
      }

      return text;
    }

    private static string Unquote(string value, Line line)
    {
      if (value.Length >= 2 && value[0] == '\'' && value[^1] == '\'')
      {
        return value[1..^1].Replace("''", "'", StringComparison.Ordinal);
      }

      if (value.Length >= 2 && value[0] == '"' && value[^1] == '"')
      {
        if (value.Contains('\\', StringComparison.Ordinal))
        {
          throw new FormatException($"Line {line.Number}: escapes in double-quoted scalars are not supported.");
        }

        return value[1..^1];
      }

      if (value[0] is '"' or '\'')
      {
        throw new FormatException($"Line {line.Number}: a quoted scalar must be the whole value, on one line.");
      }

      return value;
    }
  }
}
