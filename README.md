# Tenantry agent skills

Skills that let an AI coding agent add [Tenantry](https://tenantry.dev), multi-tenancy for ASP.NET Core and EF Core,
to a .NET application correctly, and review an application that already uses it.

The repository is a Claude Code plugin marketplace with one plugin, `tenantry`. The skills follow the open
[Agent Skills](https://agentskills.io/specification) format, so other agents that read `SKILL.md` files can use them,
and [AGENTS.md](AGENTS.md) has the same guidance in one file for agents that read only that.

| Skill | Use it to |
|-------|-----------|
| [`tenantry-add-to-existing-app`](plugins/tenantry/skills/tenantry-add-to-existing-app/SKILL.md) | Add Tenantry to an existing ASP.NET Core and EF Core app with a shared database, from inspection to a passing isolation test |
| [`tenantry-new-app`](plugins/tenantry/skills/tenantry-new-app/SKILL.md) | Start a new multi-tenant API or worker |
| [`tenantry-non-http`](plugins/tenantry/skills/tenantry-non-http/SKILL.md) | Run work as a tenant in workers, jobs, console and desktop apps |
| [`tenantry-database-per-tenant`](plugins/tenantry/skills/tenantry-database-per-tenant/SKILL.md) | Give each tenant its own database |
| [`tenantry-migrate-from-finbuckle`](plugins/tenantry/skills/tenantry-migrate-from-finbuckle/SKILL.md) | Move an app from Finbuckle.MultiTenant to Tenantry |
| [`tenantry-audit-isolation`](plugins/tenantry/skills/tenantry-audit-isolation/SKILL.md) | Review an app that uses Tenantry for isolation gaps, with findings by file and line |
| [`tenantry-pro`](plugins/tenantry/skills/tenantry-pro/SKILL.md) | Decide when Tenantry Pro, the paid package, applies, and set up each of its features |

## Install in Claude Code

From your shell:

```bash
claude plugin marketplace add tenantry-org/tenantry-agent-skills
claude plugin install tenantry@tenantry-agent-skills
```

Or inside a session:

```text
/plugin marketplace add tenantry-org/tenantry-agent-skills
/plugin install tenantry@tenantry-agent-skills
```

The skills then load when a task matches their description, or you can run one by name, for example
`/tenantry:tenantry-add-to-existing-app`.

To turn the plugin on for everyone who works in a repository, add the marketplace and the plugin with
`--scope project`, from the repository:

```bash
claude plugin marketplace add tenantry-org/tenantry-agent-skills --scope project
claude plugin install tenantry@tenantry-agent-skills --scope project
```

and commit `.claude/settings.json`. It then names the marketplace under `extraKnownMarketplaces` and the plugin under
`enabledPlugins`. A collaborator's Claude Code registers the marketplace once they trust the folder, and loads the
plugin from it. Enabling the plugin alone is not enough: without the marketplace entry, a collaborator's Claude Code
does not know where the plugin comes from.

To get updates, run `claude plugin update tenantry@tenantry-agent-skills`, or turn on auto-update for the marketplace
under **Marketplaces** in `/plugin`. The plugin has no version number, so each new commit is an update.

## Use with other agents

Agents that read Agent Skills look for skill folders, each with a `SKILL.md`, in their own skills directory or in
`.agents/skills/`. Copy the folders you want from [plugins/tenantry/skills](plugins/tenantry/skills), keeping each
folder whole, since `SKILL.md` refers to the files in its `references/` folder:

```bash
git clone https://github.com/tenantry-org/tenantry-agent-skills
mkdir -p .agents/skills
cp -R tenantry-agent-skills/plugins/tenantry/skills/* .agents/skills/
```

The frontmatter uses only the fields in the Agent Skills specification, so the folders can also be uploaded where
that format is accepted.

For agents that read only an `AGENTS.md` (or `CLAUDE.md`), either point them at this repository's
[AGENTS.md](AGENTS.md), or copy the short block at its end into your project's own file.

## Versions

The skills are for Tenantry Core and Tenantry Pro 0.7 and later. They were written and checked against 0.7 before it
was released, using packages built from the source.

Every skill tells the agent to check the Tenantry version a project uses and to upgrade a project on 0.6 or earlier
first: 0.6 has isolation gaps that 0.7 fixes, and some names the skills use do not exist in it
([changelog](https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md)). Every `dotnet add package`
line pins `--version 0.7.0`, which makes NuGet install 0.7.0 exactly and fail, rather than install 0.6, until 0.7.0 is
published. The skills tell the agent to stop and tell the user if it fails, and to update to the newest 0.7.x patch
once it succeeds.

## Checking the skills

```bash
node scripts/validate.mjs
```

It needs Node.js 20 or later and nothing else, and checks:

- the marketplace and plugin manifests against the fields Claude Code's marketplace and manifest references list;
- each skill's frontmatter against the Agent Skills specification's fields and limits;
- that every relative link resolves, and every link to a heading in this repository finds it;
- that links to tenantry.dev name a docs page that exists, and, given the docs of the release the skills target
  (`--core-docs <tenantry-core>/docs --pro-docs <tenantry-pro-docs>/docs`), that the heading they link to exists
  there;
- that no file names an API, namespace or package Tenantry 0.7 no longer has (`scripts/removed-names.txt`, copied
  from the Tenantry repositories' own lists);
- that every line that adds a Tenantry package with `dotnet add` pins `--version` to the release the skills target,
  `TENANTRY_VERSION` in `.github/workflows/validate.yml`, which is set there and nowhere else;
- that no C# example registers a resolver the caller controls (header, subdomain, host, route, query string, or one
  of your own) without an access validator. A block whose own resolver checks the caller's access itself can say so
  with ```` ```csharp no-validator-needed ````; no block in the skills needs it today;
- no em dashes and no list items that start with a bold label; and that every workflow action is pinned to a commit.

`--online` also requests each linked docs page.

```bash
scripts/check-snippets.sh
```

builds every C# block in the skills and AGENTS.md against the Tenantry packages, with the .NET 10 SDK, and reports
errors at the block's line. Tenantry's TNY1001 and TNY1002 warnings are errors there, so an example that crosses
tenants on purpose says so with a `#pragma warning disable` and a reason. The build cannot catch a resolver without an
access validator, since TNY2001 reports nothing once any block in the one project adds a validator; the per-block
check in `validate.mjs` covers that. It builds against the workflow's `TENANTRY_VERSION` from nuget.org, or a folder
of packages in `TENANTRY_CORE_PACKAGES`. The tenantry-pro skill's blocks are built only when `TENANTRY_PRO_PACKAGES`
names a folder of Pro packages, as Pro is on a private feed. A block marked `csharp no-compile` is skipped (another
library's code, or a signature shown for its shape).

CI runs both on every push and pull request. Until Tenantry 0.7.0 is published, the docs headings are checked by page
name only and the code blocks are not built in CI, as neither the 0.7 docs tags nor the packages exist yet; each
prints a notice and starts checking on its own once they do. Before then they were run locally, against docs and
packages built from the Tenantry repositories' master branches. `claude plugin validate .` runs Claude Code's own
checks.

## Reporting a mistake

If a skill tells an agent something that is wrong, or that does not work when followed, open an issue at
https://github.com/tenantry-org/tenantry-agent-skills/issues with the skill's name, the Tenantry version, what the
agent did and what happened. Problems with Tenantry itself go to
https://github.com/tenantry-org/tenantry-core/issues.

## Licence

Apache License 2.0, the same as Tenantry Core: see [LICENSE](LICENSE). Tenantry Pro, which the `tenantry-pro` skill
describes, is commercial software with its own licence.
