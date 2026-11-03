# Installing Tenantry Pro

The Pro packages come from the package feed, a private NuGet feed that Tenantry runs at tenantry.dev. Tenantry Core
and everything else stay on nuget.org. This describes installation as of Pro 0.8; check
https://tenantry.dev/docs/pro/installation for changes.

## What the user needs

1. A Tenantry Pro subscription. No GitHub account is involved.
2. A feed token, created on the Pro access page (https://tenantry.dev/dashboard/pro). The page shows a token only
   once, so the user copies it straight away. One token per developer or CI system lets each be revoked on its own.
3. The licence key, from the same page. It stays the same for as long as they use Pro.

The user creates the token and copies the key. Do not ask them to paste either into the conversation or into a file
that is committed.

## 1. `nuget.config` next to the solution

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="TenantryPro" value="https://tenantry.dev/feed/v3/index.json" protocolVersion="3" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
    <packageSource key="TenantryPro">
      <package pattern="Tenantry.Pro" />
      <package pattern="Tenantry.Pro.*" />
    </packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <TenantryPro>
      <add key="Username" value="tenantry" />
      <add key="ClearTextPassword" value="%TENANTRY_FEED_TOKEN%" />
    </TenantryPro>
  </packageSourceCredentials>
</configuration>
```

It holds no secrets and is committed: NuGet reads the token from the `TENANTRY_FEED_TOKEN` environment variable. The
mapping sends `Tenantry.Pro` and `Tenantry.Pro.*` to the package feed and everything else, Tenantry Core included, to
nuget.org. The element under `packageSourceCredentials` is named after the source's key, `TenantryPro`; the feed
reads only the password and accepts any user name. If the solution already has a `nuget.config`, merge these entries
into it; with source mapping on, every source needs at least one pattern, so map the other feeds too.

## 2. The feed token on the machine

The user sets the variable in their shell profile or user environment, then restarts the terminal and IDE:

```bash
export TENANTRY_FEED_TOKEN=tpf_your_feed_token
```

On Windows: `[Environment]::SetEnvironmentVariable('TENANTRY_FEED_TOKEN', 'tpf_your_feed_token', 'User')` in
PowerShell.

## 3. Packages

```bash
dotnet add package Tenantry.AspNetCore --version 0.8.0 # Tenantry Core, from nuget.org
dotnet add package Tenantry.Pro --version 0.8.0 # from the package feed
dotnet add package Tenantry.Pro.EfCore --version 0.8.0 # schema per tenant, provisioning, migrations, audit, health checks
```

`--version 0.8.0` makes NuGet install 0.8.0 exactly, the lowest version that satisfies it. If a command fails with
NU1102, stop and tell the user. Do not install an older version, and do not remove `--version`. Once it succeeds,
update every Tenantry and Tenantry Pro package to the newest 0.8.x patch, which
`dotnet list package --outdated --highest-patch` lists. Without `--highest-patch` it lists the newest release of any
minor, and Pro 0.8 needs Tenantry Core 0.8.

The integrations are `Tenantry.Pro.Hangfire`, `Tenantry.Pro.Quartz`, `Tenantry.Pro.MassTransit` and
`Tenantry.Pro.Rebus`. Pro's version must match Tenantry Core's minor version.

## 4. The licence key

Add `UsePro` to the app's existing `AddTenantry` call, inside its `tenant => ...` lambda, and keep everything already
there (resolvers, access validators, store). It reads the key from the `Tenantry:License` setting when the
application starts:

```csharp
tenant.UsePro();   // the licence key comes from Tenantry:License
```

Locally, from the application's project directory:

```bash
dotnet user-secrets init
dotnet user-secrets set "Tenantry:License" "<your licence key>"
```

User secrets are read only in the `Development` environment. Elsewhere, set the environment variable
`Tenantry__License` or use the secrets vault's configuration provider. When the key comes from somewhere configuration
cannot read, pass it with `pro.UseLicenseKey(key)`. The key is checked offline, at startup.

## Lock files, CI, Docker and restore errors

Follow the guide for these. It changes with the package feed, so this reference does not copy it:

- Lock files: https://tenantry.dev/docs/pro/installation#5-turn-on-lock-files
- CI, which needs a feed token of its own and the key as secrets: https://tenantry.dev/docs/pro/installation#ci
- Docker builds, which take the token as a build secret: https://tenantry.dev/docs/pro/installation#docker-builds
- A restore that cannot reach the feed, or fails on `NU1900`:
  https://tenantry.dev/docs/pro/installation#when-the-package-feed-is-unreachable
- `NU1301`, `NU1101` or `NU1102` from a restore, or `LicenseRequiredException` at startup:
  https://tenantry.dev/docs/pro/installation#troubleshooting
