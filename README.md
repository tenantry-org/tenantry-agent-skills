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

To turn the plugin on for everyone who works in a repository, install it with `--scope project`, which records it in
the repository's `.claude/settings.json`; each collaborator still runs the install command once.

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

The skills were checked against Tenantry Core and Tenantry Pro 0.7, which were not yet released when they were
written. Every API name was checked against the source, and the `tenantry-add-to-existing-app` and `tenantry-non-http`
skills were followed step by step on a sample app and worker built against Tenantry Core packed from source. Until 0.7
is on NuGet, `dotnet add package` installs 0.6, where some names differ; the skills tell the agent to check the
installed version.

## Checking the skills

```bash
node scripts/validate.mjs
```

It checks the marketplace and plugin manifests against the fields Claude Code documents, the frontmatter of every
skill against the Agent Skills specification, every relative link and anchor, the writing conventions, and that no
API name removed before 0.7 appears. It needs Node.js 20 or later and nothing else. CI runs it on every push and pull
request. `claude plugin validate .` runs Claude Code's own checks.

## Reporting a mistake

If a skill tells an agent something that is wrong, or that does not work when followed, open an issue at
https://github.com/tenantry-org/tenantry-agent-skills/issues with the skill's name, the Tenantry version, what the
agent did and what happened. Problems with Tenantry itself go to
https://github.com/tenantry-org/tenantry-core/issues.

## Licence

Apache License 2.0, the same as Tenantry Core: see [LICENSE](LICENSE). Tenantry Pro, which the `tenantry-pro` skill
describes, is commercial software with its own licence.
