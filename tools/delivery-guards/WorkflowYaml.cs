using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace DeliveryGuards;

/// <summary>A node of a YAML document: a mapping, a sequence or a scalar.</summary>
public interface IYamlNode;

/// <summary>A scalar, as YAML resolves it (quotes removed, block scalars folded or kept literal).</summary>
public sealed record YamlScalar(string Value) : IYamlNode;

/// <summary>A sequence, block (<c>- item</c>) or flow (<c>[a, b]</c>).</summary>
public sealed record YamlSequence(IReadOnlyList<IYamlNode> Items) : IYamlNode;

/// <summary>A mapping, keys in document order.</summary>
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
/// Reads a workflow with YamlDotNet's representation model (no reflection-based serializer, so it suits a file-based
/// app) and converts it to the small node types the guards query.
/// </summary>
public static class WorkflowYaml
{
  /// <summary>Parses <paramref name="yaml"/>, a single document, into its root node.</summary>
  /// <exception cref="FormatException">The text is not valid YAML, or holds no single document.</exception>
  public static IYamlNode Parse(string yaml)
  {
    var stream = new YamlStream();
    try
    {
      using var reader = new StringReader(yaml);
      stream.Load(reader);
    }
    catch (YamlException e)
    {
      throw new FormatException($"line {e.Start.Line}: {e.Message}", e);
    }

    if (stream.Documents.Count != 1)
    {
      throw new FormatException($"expected one YAML document, found {stream.Documents.Count}.");
    }

    return Convert(stream.Documents[0].RootNode);
  }

  private static IYamlNode Convert(YamlNode node) => node switch
  {
    YamlScalarNode scalar => new YamlScalar(scalar.Value ?? ""),
    YamlSequenceNode sequence => new YamlSequence([.. sequence.Children.Select(Convert)]),
    YamlMappingNode mapping => new YamlMapping(
      [.. mapping.Children.Select(e => new KeyValuePair<string, IYamlNode>(Key(e.Key), Convert(e.Value)))]),
    _ => throw new FormatException($"unsupported YAML node at line {node.Start.Line}."),
  };

  private static string Key(YamlNode key) =>
    key is YamlScalarNode { Value: { } value }
      ? value
      : throw new FormatException($"line {key.Start.Line}: a key must be a scalar.");
}
