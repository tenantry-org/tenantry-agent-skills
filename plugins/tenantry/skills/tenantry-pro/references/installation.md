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
    <add key="tenantry-pro" value="https://tenantry.dev/feed/v3/index.json" protocolVersion="3" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
    <packageSource key="tenantry-pro">
      <package pattern="Tenantry.Pro" />
      <package pattern="Tenantry.Pro.*" />
    </packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <tenantry-pro>
      <add key="Username" value="tenantry" />
      <add key="ClearTextPassword" value="%TENANTRY_FEED_TOKEN%" />
    </tenantry-pro>
  </packageSourceCredentials>
</configuration>
```

It holds no secrets and is committed: NuGet reads the token from the `TENANTRY_FEED_TOKEN` environment variable. The
mapping sends `Tenantry.Pro` and `Tenantry.Pro.*` to the package feed and everything else, Tenantry Core included, to
nuget.org. The element under `packageSourceCredentials` is named after the source's key, `tenantry-pro`; the feed
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
update every Tenantry and Tenantry Pro package to the newest 0.8.x patch: `dotnet list package --outdated` lists it.

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

## Lock files

With a lock file, every restore gets exactly the packages last restored. Turn it on for each project, for example in
`Directory.Build.props`, and commit the `packages.lock.json` files the next restore writes:

```xml
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

CI then restores with `dotnet restore --locked-mode`, which fails rather than resolve anything the lock file does not
name. After updating a package, restore without `--locked-mode` and commit the lock files it rewrites.

## CI

The pipeline needs a feed token of its own to restore, and the key for anything that starts the application. The user
creates a token for it on the Pro access page and stores both as secrets:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TENANTRY_FEED_TOKEN: ${{ secrets.TENANTRY_FEED_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore --locked-mode
      - run: dotnet build --no-restore
      - run: dotnet test --no-build
        env:
          Tenantry__License: ${{ secrets.TENANTRY_LICENSE }}
```

A build that writes its own `nuget.config` without the credentials can pass them in the environment variable
`NuGetPackageSourceCredentials_tenantry-pro`, set to `Username=tenantry;Password=<the feed token>`.

## Docker builds

Pass the token as a build secret, not a build argument, which the image's history keeps:

```dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY nuget.config ./
COPY src/MyApp/MyApp.csproj src/MyApp/packages.lock.json src/MyApp/
RUN --mount=type=secret,id=tenantry_feed_token,env=TENANTRY_FEED_TOKEN \
    dotnet restore src/MyApp --locked-mode
COPY . .
RUN dotnet publish src/MyApp -c Release --no-restore -o /app
```

```bash
docker build --secret id=tenantry_feed_token,env=TENANTRY_FEED_TOKEN .
```

The `env=` option of a secret mount needs the Dockerfile syntax the first line selects.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `NU1301` with `401 (Unauthorized)` for a `tenantry.dev` address | The feed received no live token: `TENANTRY_FEED_TOKEN` is not set in this shell or CI step, has a trailing newline, or names a token revoked on the Pro access page |
| `NU1301` with `403 (Forbidden)` for a `tenantry.dev` address | The token belongs to a subscription that has ended with no vested releases |
| `NU1102: Unable to find package Tenantry.Pro with version`, with versions found in `tenantry-pro` | That version is not served to this subscription (after it ended, a release past the vested-through date) or does not exist |
| `NU1101: Unable to find package Tenantry.Pro` naming only nuget.org | The `tenantry-pro` source or its mapping is missing, or another `nuget.config` with `<clear />` wins (`dotnet nuget list source`) |
| `LicenseRequiredException` at startup | No key reached `Tenantry:License`, or it was mistyped |
