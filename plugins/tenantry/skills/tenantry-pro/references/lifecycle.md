# Provisioning and offboarding

## Provisioning

`ITenantProvisioner<TKey>.ProvisionAsync(tenant)` runs, in this order: `CreateDatabase` or `CreateSchema`, then
`Migrations`, then your steps in the order added. Only registered steps run.

```csharp
// Inside the app's existing AddTenantry(tenant => ...) call.
tenant.UsePro(pro => pro
    .AddProvisioningStep<SeedTenantData>()        // your step, last
    .AddDatabaseProvisioning<AppDbContext>()      // CreateDatabase, runs first
    .AddMigrations<AppDbContext>());              // Migrations, after it
```

For a database per tenant, the context is registered with Core's `UseConnectionStrings` and
`AddDbContextPerTenantDatabase`, as in the tenantry-database-per-tenant skill's
[registration.md](../../tenantry-database-per-tenant/references/registration.md).

For a schema per tenant, use `AddSchemaProvisioning<AppDbContext>()` in place of `AddDatabaseProvisioning`.

The provisioner does not add the tenant to the store. Add it first, not yet active, then provision it and pass the
call that makes it active:

```csharp
public sealed class TenantOnboarding(ITenantProvisioner<string> provisioner, IMyTenantRepository tenants)
{
    public async Task<TenantLifecycleResult<string>> CreateAsync(string id, string name, CancellationToken ct)
    {
        var descriptor = new Tenant { TenantId = id, Name = name, IsActive = false };
        await tenants.AddAsync(descriptor, ct);

        // Activates the tenant only if every step succeeded, then invalidates it.
        return await provisioner.ProvisionAsync(descriptor, token => tenants.ActivateAsync(id, token), ct);
    }
}
```

`ProvisionAsync` invalidates the tenant after the activation because, with `CacheTenants`, a request or job for it
while the steps ran cached it as not active, and would refuse it until that copy expired. Do not activate the tenant
yourself after `ProvisionAsync(descriptor, ct)`, which only runs the steps, unless you then call
`ITenantInvalidator<TKey>.InvalidateAsync(id)`. Other instances of the app keep their copy unless invalidations are
broadcast ([background-jobs.md](background-jobs.md#invalidating-a-tenant-on-every-instance)).

- A failed step is reported in the `TenantLifecycleResult<TKey>` (`Succeeded`, `Steps`, `Error`), not thrown, and
  the activation is not called. By default it stops the steps after it
  (`pro.ConfigureProvisioning(o => o.StopOnFailure = false)` runs them all).
- Your steps implement `ITenantProvisioningStep<TKey>` (`ExecuteAsync(context, ct)`, with the tenant in
  `context.Tenant`). Each is resolved from a scope for the tenant and must be idempotent, as recovering from a failure
  means provisioning again.
- `ProvisionAsync` throws for a reserved tenant id, a missing or invalid licence, or cancellation, and passes on
  what the activation throws. Provisioning again runs the steps again, then the activation.
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
