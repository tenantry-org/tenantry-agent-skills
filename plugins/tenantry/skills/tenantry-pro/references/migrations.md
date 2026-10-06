# Migrating every tenant: `migrate-tenants`

`pro.AddMigrations<TContext>()` applies the context's EF Core migrations to each tenant's database or schema: as a
provisioning step, and for every tenant from the migration runner.

```csharp
// Inside the app's existing AddTenantry(tenant => ...) call.
tenant.UsePro(pro => pro.AddMigrations<AppDbContext>());
```

The context must be registered so that a tenant's scope gives the tenant's own database or schema: for a database
per tenant with `UseConnectionStrings` and `AddDbContextPerTenantDatabase`, as in the tenantry-database-per-tenant skill's
[registration.md](../../tenantry-database-per-tenant/references/registration.md), or with `UseTenantry()` and
[schema per tenant](schema-per-tenant.md).

## As a deployment step (recommended)

```csharp
await using var app = builder.Build();

// dotnet run -- migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;

// ... the pipeline
await app.RunAsync();
return 0;
```

Run it once per deployment, from one process (a CI/CD stage or a Kubernetes `Job`, not an init container), before
the new version serves traffic:

```bash
dotnet MyApp.dll migrate-tenants
dotnet MyApp.dll migrate-tenants --tenant acme --tenant globex --max-failures 1   # canaries first
dotnet MyApp.dll migrate-tenants --exclude acme --exclude globex
```

| Exit code | Meaning |
|-----------|---------|
| 0 | Every selected database and schema is migrated or was up to date |
| 1 | At least one failed; the run went through all the others |
| 2 | The run stopped early (`--max-failures` reached, or a stop signal) |
| 3 | The run could not start (bad option, no valid licence, unknown `--tenant`, store unreadable) |

Misspelt options (`--tenants`, `-tenant`) are refused rather than migrating every tenant. Run one migration step at a
time; in CI, queue a second run rather than cancelling the first.

## At startup

`pro.AddMigrations<AppDbContext>(o => o.OnStartup = StartupMigrations.FailOnError)` migrates every tenant as the app
starts (`LogFailures` starts anyway). It runs on every instance and lengthens startup, so keep it for single-instance
deployments and development. It does not create a missing database unless
`o.CreateMissingDatabases = builder.Environment.IsDevelopment()`.

## Which tenants

The runner migrates every tenant the store's `GetAllTenantsAsync` returns, suspended ones included. A store that hides
suspended tenants leaves them behind.

To migrate with other credentials than the application's, call `pro.UseAdminContext<AppDbContext>(sp => …)` once:
provisioning, migrations, offboarding's drops and the migration health check all use the context it builds. The
delegate must return a new context each time. With a schema per tenant, build it with
`UseApplicationServiceProvider(sp)` and `UseTenantry()` so it gets the schema. In mixed mode it is called for every
tenant, so it must also connect `Shared` tenants to the shared database.

More: https://tenantry.dev/docs/pro/migration-orchestration
