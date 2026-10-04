// Writes every ```csharp block of the skills and AGENTS.md out as a C# file, for scripts/check-snippets.sh to build
// against the Tenantry packages. Ported from Tenantry Core's scripts/doc-snippets.cs, which builds its docs' blocks
// the same way. Usage:
//
//   dotnet run scripts/extract-snippets.cs -- <repository> <output directory> <core|pro>
//
// "core" writes the blocks of every page except the tenantry-pro skill's, "pro" only that skill's, since the Pro
// packages come from a private feed. Each block becomes one file, with #line directives so that compiler errors point
// at the markdown:
//   - It gets the using directives of every block on its page: a page names each namespace its code needs once,
//     in whichever block reads best.
//   - Its types go into a namespace of its own, nested in the namespace of the block before it on the page: a later
//     block sees the types an earlier one declared, and a block can declare its own AppDbContext as an alternative
//     to an earlier one (the nearest declaration wins). A block also sees, through aliases, the types that only a
//     later block declares, as when a page registers a class before showing it.
//   - Its statements go into an async method, where `builder`, `app`, `args` and the like are in scope as in a
//     Program.cs (scripts/snippets/Ambient.cs). Statements that use `tenant` (or `pro`) without declaring it come from inside
//     AddTenantry's lambda (or UsePro's), so they go into Ambient's WithTenant (or WithPro) lambda, for the tenant key
//     type the block names (Guid, string, int or long). When it names none: Guid, as most of the skills use, and
//     string in the tenantry-pro skill, whose examples use string keys as Pro's docs do.
//   - A block that holds only members (a property, a method) goes into a class.
// A block that is not meant to compile (it shows another library's code, or only the shape of something) is marked
// ```csharp no-compile, which GitHub and the agents that read the skills ignore.
#:package Microsoft.CodeAnalysis.CSharp@5.0.0
#:property PublishAot=false

using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

if (args.Length != 3 || args[2] is not ("core" or "pro"))
{
    Console.Error.WriteLine("usage: dotnet run scripts/extract-snippets.cs -- <repository> <output directory> <core|pro>");
    return 2;
}

var repo = Path.GetFullPath(args[0]);
var output = Path.GetFullPath(args[1]);
var pro = args[2] == "pro";
Directory.CreateDirectory(output);

var proSkill = Path.Combine(repo, "plugins", "tenantry", "skills", "tenantry-pro") + Path.DirectorySeparatorChar;
var pages = new[] { Path.Combine(repo, "AGENTS.md"), Path.Combine(repo, "README.md") }
    .Concat(Directory.GetFiles(Path.Combine(repo, "plugins"), "*.md", SearchOption.AllDirectories)
        .Order(StringComparer.Ordinal))
    .Where(File.Exists)
    .Where(path => path.StartsWith(proSkill, StringComparison.Ordinal) == pro)
    .ToList();

var parseOptions = new CSharpParseOptions(LanguageVersion.Preview);
int written = 0, skipped = 0;

foreach (var (page, pageNumber) in pages.Select((page, index) => (page, index + 1)))
{
    var blocks = ReadBlocks(page).ToList();
    var pageUsings = blocks.Where(block => !block.Skip)
        .SelectMany(block => CSharpSyntaxTree.ParseText(block.Code, parseOptions).GetCompilationUnitRoot().Usings)
        .Select(directive => directive.ToString())
        .Distinct()
        .ToList();
    // Each compiled block's namespace, and the non-generic types it declares.
    var compiled = new List<(Block Block, int Number, string Namespace, HashSet<string> Types)>();
    var ns = $"Snippets.P{pageNumber:D2}";
    foreach (var (block, blockNumber) in blocks.Select((block, index) => (block, index + 1)))
    {
        if (block.Skip)
        {
            skipped++;
            continue;
        }

        ns += $".B{blockNumber:D2}";
        compiled.Add((block, blockNumber, ns, DeclaredTypes(block.Code)));
    }

    for (var i = 0; i < compiled.Count; i++)
    {
        var (block, blockNumber, blockNamespace, _) = compiled[i];
        var seen = compiled.Take(i + 1).SelectMany(earlier => earlier.Types).ToHashSet();
        var later = compiled.Skip(i + 1)
            .SelectMany(next => next.Types.Select(type => (Type: type, next.Namespace)))
            .Where(declared => !seen.Contains(declared.Type))
            .DistinctBy(declared => declared.Type)
            .Select(declared => $"using {declared.Type} = {declared.Namespace}.{declared.Type};")
            .ToList();
        File.WriteAllText(Path.Combine(output, $"P{pageNumber:D2}B{blockNumber:D2}.cs"),
            Generate(block, blockNamespace, pageUsings, later));
        written++;
    }
}

Console.WriteLine($"{written} code blocks written to {output}, {skipped} marked no-compile, from {pages.Count} pages");
return 0;

string Generate(Block block, string ns, IReadOnlyList<string> pageUsings, IReadOnlyList<string> laterTypes)
{
    var tree = CSharpSyntaxTree.ParseText(block.Code, parseOptions);
    var root = tree.GetCompilationUnitRoot();
    var file = new StringBuilder();
    var path = block.Page.Replace("\\", "/");

    void Line(string text) => file.Append(text).Append('\n');

    void Mapped(SyntaxNode node)
    {
        var line = tree.GetLineSpan(node.FullSpan).StartLinePosition.Line;
        Line($"#line {block.FirstLine + line} \"{path}\"");
        Line(node.ToFullString().TrimEnd());
        Line("#line default");
    }

    Line("// <auto-generated/> from " + Path.GetRelativePath(repo, block.Page) + ":" + block.FirstLine);
    Line("#nullable enable");

    if (IsMembersOnly(tree, block.Code))
    {
        foreach (var directive in pageUsings)
            Line(directive);
        Line($"namespace {ns};");
        foreach (var alias in laterTypes)
            Line(alias);
        Line("file partial class Members");
        Line("{");
        Line($"#line {block.FirstLine} \"{path}\"");
        Line(block.Code);
        Line("#line default");
        Line("}");
        return file.ToString();
    }

    var own = root.Usings.Select(directive => directive.ToString()).ToList();
    foreach (var shared in pageUsings.Except(own))
        Line(shared);
    foreach (var directive in root.Usings)
        Mapped(directive);
    foreach (var alias in root.Externs)
        Mapped(alias);
    foreach (var attributes in root.AttributeLists)
        Mapped(attributes);

    Line($"namespace {ns};");
    foreach (var alias in laterTypes)
        Line(alias);

    var statements = root.Members.OfType<GlobalStatementSyntax>().ToList();
    if (statements.Count > 0)
    {
        var returnsValue = statements.SelectMany(statement => statement.DescendantNodesAndSelf(Descend))
            .OfType<ReturnStatementSyntax>()
            .Any(statement => statement.Expression is not null);
        Line("file static class Program");
        Line("{");
        Line(returnsValue ? "    public static async Task<int> Run()" : "    public static async Task Run()");
        Line("    {");
        var first = tree.GetLineSpan(statements[0].FullSpan).StartLinePosition.Line;
        var lambdas = LambdaParameters(statements).ToList();
        foreach (var (parameter, wrapper) in lambdas)
            Line($"        {wrapper}<{KeyType(block.Code)}>({parameter} => {{");
        Line($"#line {block.FirstLine + first} \"{path}\"");
        Line(block.Code[statements[0].FullSpan.Start..statements[^1].FullSpan.End].TrimEnd());
        Line("#line default");
        foreach (var _ in lambdas)
            Line("        });");
        Line("    }");
        Line("}");
    }

    foreach (var member in root.Members.Where(member => member is not GlobalStatementSyntax))
        Mapped(member);

    return file.ToString();
}

// The builder parameters that statements use without declaring, outermost first, with the Ambient method that
// supplies each.
static IEnumerable<(string Parameter, string Wrapper)> LambdaParameters(IReadOnlyList<GlobalStatementSyntax> statements)
{
    var nodes = statements.SelectMany(statement => statement.DescendantNodesAndSelf()).ToList();
    var declared = nodes.Select(node => node switch
        {
            ParameterSyntax parameter => parameter.Identifier.Text,
            VariableDeclaratorSyntax variable => variable.Identifier.Text,
            SingleVariableDesignationSyntax designation => designation.Identifier.Text,
            ForEachStatementSyntax loop => loop.Identifier.Text,
            _ => null
        })
        .OfType<string>()
        .ToHashSet();
    var uses = nodes.OfType<IdentifierNameSyntax>()
        .Where(name => name.Parent is not MemberAccessExpressionSyntax access || access.Expression == name)
        .ToLookup(name => name.Identifier.Text);

    // Only when every use calls a method on it: `tenant.TenantId` or `CreateScope(tenant)` is a tenant, not a builder.
    foreach (var (parameter, wrapper) in new[] { ("tenant", "WithTenant"), ("pro", "WithPro") })
        if (uses[parameter].Any() && !declared.Contains(parameter) && uses[parameter].All(IsCallReceiver))
            yield return (parameter, wrapper);

    static bool IsCallReceiver(IdentifierNameSyntax name) =>
        name.Parent is MemberAccessExpressionSyntax { Parent: InvocationExpressionSyntax } access && access.Expression == name;
}

string KeyType(string code) =>
    Regex.Match(code, @"<(Guid|string|int|long)>") is { Success: true } match ? match.Groups[1].Value
        : pro ? "string" : "Guid";

// The names of the non-generic types a block declares at its top level.
HashSet<string> DeclaredTypes(string code) =>
    CSharpSyntaxTree.ParseText(code, parseOptions).GetCompilationUnitRoot().Members
        .OfType<BaseTypeDeclarationSyntax>()
        .Where(type => type is not TypeDeclarationSyntax { TypeParameterList: not null })
        .Select(type => type.Identifier.Text)
        .ToHashSet();

// Lambdas and local functions have returns of their own.
static bool Descend(SyntaxNode node) =>
    node is not (AnonymousFunctionExpressionSyntax or LocalFunctionStatementSyntax);

// A block that does not parse as a file but does parse as the body of a class, such as a lone property.
bool IsMembersOnly(SyntaxTree tree, string code)
{
    if (!tree.GetDiagnostics().Any(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error))
        return false;

    var wrapped = CSharpSyntaxTree.ParseText($"class C {{\n{code}\n}}", parseOptions);
    return !wrapped.GetDiagnostics().Any(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error);
}

static IEnumerable<Block> ReadBlocks(string page)
{
    var lines = File.ReadAllLines(page);
    for (var i = 0; i < lines.Length; i++)
    {
        var open = Regex.Match(lines[i], @"^(?<indent>\s*)(?<fence>`{3,}|~{3,})\s*(csharp|cs|c#)(?<meta>(\s.*)?)$",
            RegexOptions.IgnoreCase);
        if (!open.Success)
            continue;

        var indent = open.Groups["indent"].Value.Length;
        var fence = open.Groups["fence"].Value;
        var body = new List<string>();
        var j = i + 1;
        for (; j < lines.Length && !Regex.IsMatch(lines[j], $@"^\s*{Regex.Escape(fence)}\s*$"); j++)
            body.Add(lines[j].Length >= indent && string.IsNullOrWhiteSpace(lines[j][..indent])
                ? lines[j][indent..]
                : lines[j].TrimStart());

        var skip = Regex.IsMatch(open.Groups["meta"].Value, @"(^|\s)no-compile(\s|$)");
        yield return new Block(page, i + 2, string.Join("\n", body), skip);
        i = j;
    }
}

internal sealed record Block(string Page, int FirstLine, string Code, bool Skip);
