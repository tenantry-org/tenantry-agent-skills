# Provisioning and offboarding

## Provisioning

`ITenantProvisioner<TKey>.ProvisionAsync(tenant)` runs, in this order: `CreateDatabase` or `CreateSchema`, then
`Migrations`, then your steps and seeders in the order added. Only registered steps run.

```csharp
tenant.UseConnectionStrings(opts =>
    opts.GetConnectionString = t => $"Server=.;Database=app_{t.TenantId};Integrated Security=true;TrustServerCertificate=True");

tenant.UsePro(pro => pro
    .AddSeeder<MyTenantSeeder>()                  // your seeder, last
    .AddDatabaseProvisioning<AppDbContext>()      // CreateDatabase, runs first
    .AddMigrations<AppDbContext>());              // Migrations, after it

tenant.AddDbContextPerTenantDatabase<AppDbContext>((sp, options) => options.UseSqlServer());
```

For a schema per tenant, use `AddSchemaProvisioning<AppDbContext>()` in place of `AddDatabaseProvisioning`.

The provisioner does not add the tenant to the store. Add it first, not yet active, provision, then activate:

```csharp
public sealed class TenantOnboarding(ITenantProvisioner<string> provisioner, IMyTenantRepository tenants)
{
    public async Task<TenantProvisioningResult<string>> CreateAsync(string id, string name, CancellationToken ct)
    {
        var descriptor = new Tenant { TenantId = id, Name = name, IsActive = false };
        await tenants.AddAsync(descriptor, ct);

        var result = await provisioner.ProvisionAsync(descriptor, ct);
        if (result.Succeeded)
            await tenants.ActivateAsync(id, ct);

        return result;
    }
}
```

- A failed step is reported in the result (`Succeeded`, `Steps`, `Error`), not thrown; by default it stops the steps
  after it (`pro.ConfigureProvisioning(o => o.StopOnFailure = false)` runs them all).
- Seeders implement `ITenantSeeder<TKey>` and other steps `ITenantProvisioningStep<TKey>`. Both are resolved from a
  scope for the tenant and must be idempotent, as recovering from a failure means provisioning again.
- `ProvisionAsync` throws for a reserved tenant id, a missing or invalid licence, or cancellation.
- Protect the endpoint or command that provisions with an administrator's authorization policy.

## Offboarding

`ITenantDeprovisioner<TKey>.DeprovisionAsync(tenant)` runs your steps (export, archive) first, then
`DeleteSharedData`, `DropDatabase` or `DropSchema`, then clears every cache Tenantry keeps for the tenant.

```csharp
tenant.UsePro(pro => pro
    .AddDeprovisioningStep<ExportTenantData>()           // yours, first
    .AddDatabaseDeprovisioning<AppDbContext>());         // DropDatabase
```

Use `AddSchemaDeprovisioning<TContext>()` for a schema, and `AddSharedDataDeletion<TContext>()` to delete a tenant's
rows from a shared database.

- It refuses a tenant that the store still has as active: suspend it first (which needs a `ValidateTenantActivity`
  check) or remove it from the store.
- The first failed step stops offboarding, so a failed export never lets a drop run.
- Order: suspend the tenant and invalidate it (`ITenantInvalidator<TKey>.InvalidateAsync`), deprovision, and remove it
  from the store only once `result.Succeeded`.

More: https://tenantry.dev/docs/pro/tenant-lifecycle
