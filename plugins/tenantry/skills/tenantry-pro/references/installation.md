# Installing Tenantry Pro

The Pro packages are on a private GitHub Packages feed owned by the `tenantry-org` organisation. Tenantry Core and
everything else stay on nuget.org. This describes installation as of Pro 0.7; check
https://tenantry.dev/docs/pro/installation for changes.

## What the user needs

1. A Tenantry Pro subscription, with their GitHub account connected on the Pro access page
   (https://tenantry.dev/dashboard/pro) and the `tenantry-org` invitation accepted.
2. A GitHub personal access token (classic) from that account with only the `read:packages` scope. Fine-grained tokens
   do not work with GitHub's NuGet registry.
3. The licence key, from the same page. It does not expire.

The user creates the token and copies the key. Do not ask them to paste either into the conversation or into a file
that is committed.

## 1. `nuget.config` next to the solution

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />
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
      <add key="Username" value="%TENANTRY_GITHUB_USERNAME%" />
      <add key="ClearTextPassword" value="%TENANTRY_GITHUB_PAT%" />
    </tenantry-pro>
  </packageSourceCredentials>
</configuration>
```

It holds no secrets and is committed. If the solution already has a `nuget.config`, merge these entries into it; with
source mapping on, every source needs at least one pattern, so map the other feeds too.

## 2. Credentials on the machine

The user sets these in their shell profile or user environment, then restarts the terminal and IDE:

```bash
export TENANTRY_GITHUB_USERNAME=your-github-username
export TENANTRY_GITHUB_PAT=ghp_your_token
```

## 3. Packages

```bash
dotnet add package Tenantry.AspNetCore     # Tenantry Core, from nuget.org
dotnet add package Tenantry.Pro            # from the private feed
dotnet add package Tenantry.Pro.EfCore     # schema per tenant, provisioning, migrations, audit, health checks
```

The integrations are `Tenantry.Pro.Hangfire`, `Tenantry.Pro.Quartz`, `Tenantry.Pro.MassTransit` and
`Tenantry.Pro.Rebus`. Pro's version must match Tenantry Core's minor version.

## 4. The licence key

`UsePro` reads the key from the `Tenantry:License` setting when the application starts:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")
    .UseStore<MyTenantStore>()
    .UsePro());   // the licence key comes from Tenantry:License
```

Locally, from the application's project directory:

```bash
dotnet user-secrets init
dotnet user-secrets set "Tenantry:License" "<your licence key>"
```

User secrets are read only in the `Development` environment. Elsewhere, set the environment variable
`Tenantry__License` or use the secrets vault's configuration provider. When the key comes from somewhere configuration
cannot read, pass it with `pro.UseLicenseKey(key)`. The key is checked offline, at startup.

## CI

The pipeline needs the two feed credentials to restore, and the key for anything that starts the application:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TENANTRY_GITHUB_USERNAME: ${{ vars.TENANTRY_GITHUB_USERNAME }}
      TENANTRY_GITHUB_PAT: ${{ secrets.TENANTRY_GITHUB_PAT }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore
      - run: dotnet build --no-restore
      - run: dotnet test --no-build
        env:
          Tenantry__License: ${{ secrets.TENANTRY_LICENSE }}
```

A workflow's own `GITHUB_TOKEN` cannot read another organisation's private feed, so the token is a secret. In a Docker
build, pass the token as a build secret, not a build argument.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `NU1101: Unable to find package Tenantry.Pro` naming the `tenantry-pro` source | The variables are not set in this shell, the token is not classic with `read:packages`, has expired, belongs to another account, or the invitation is not accepted |
| `NU1101` naming only nuget.org | The `tenantry-pro` source or its mapping is missing, or another `nuget.config` with `<clear />` wins (`dotnet nuget list source`) |
| `LicenseRequiredException` at startup | No key reached `Tenantry:License`, or it was mistyped |
