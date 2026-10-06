# Background jobs and messages

Without Pro, background work puts the tenant id in the job or message and runs it with Core's
`ITenantScopeFactory<TKey>.RunInScopeAsync` (the `tenantry-non-http` skill). Pro does this for four libraries, and adds
base classes for work over every tenant.

## Integrations

Each needs its package (`Tenantry.Pro.Hangfire`, `.Quartz`, `.MassTransit`, `.Rebus`), a `pro.Add...Propagation()`
call, and a host-side `UseTenantry` call in the library's own configuration. The app fails to start if the host-side
call is missing.

```csharp
// Hangfire. Inside the app's existing AddTenantry(tenant => ...) call:
tenant.UsePro(pro => pro.AddHangfirePropagation());
```

```csharp
using Hangfire;

// Beside it, where the app registers Hangfire:
builder.Services.AddHangfire((sp, config) => config
    .UseInMemoryStorage()      // or your storage
    .UseTenantry(sp));
builder.Services.AddHangfireServer();
```

| Library | Pro registration | Host side |
|---------|------------------|-----------|
| Hangfire | `pro.AddHangfirePropagation()` | `config.UseTenantry(sp)` in `AddHangfire((sp, config) => ...)` |
| Quartz.NET | `pro.AddQuartzPropagation()` | `q.UseTenantry()` in `AddQuartz(q => ...)` |
| MassTransit | `pro.AddMassTransitPropagation()` | `cfg.UseTenantry(context)` in the transport's configuration |
| Rebus | `pro.AddRebusPropagation()` | `o.UseTenantry(sp)` in `.Options(...)` of `AddRebus((configure, sp) => ...)` |

A job enqueued or a message sent during a request carries that request's tenant and runs as it. To enqueue or send for
another tenant, or from code with none, use `WithTenant`:

```csharp
jobs.WithTenant(tenantId).Enqueue<ReportJob>(job => job.Execute());   // Hangfire: runs as tenantId
```

Pass the tenant when you have it rather than its id: an id of the wrong type compiles and fails when the job runs.

A recurring job from `RecurringJob.AddOrUpdate` is created by Hangfire's scheduler with no tenant. For a recurring job
per tenant use Hangfire's `AddOrUpdateForEachTenant`, or Quartz.NET's `ForEachTenant`.

## Work with no tenant, or a tenant that no longer exists

| The job or message | Setting (default) |
|--------------------|-------------------|
| Carries no tenant | `OnMissingTenant` (`Warn`: runs without a tenant and logs) |
| Carries an invalid id, a tenant the store does not have, or a suspended tenant | `OnUnresolvedTenant` (`Reject`: throws, and the library's retry and error handling apply) |

Values are `Allow`, `Warn`, `Skip` and `Reject` (`TenantPropagationBehavior`). Set them per integration:
`pro.AddHangfirePropagation(o => o.OnMissingTenant = TenantPropagationBehavior.Reject)`. Use `Skip` or `Reject` for
`OnMissingTenant` when every job must carry a tenant.

The tenant a job or message names is read from the store and checked with `ValidateTenantActivity`, but the header
itself is not authenticated: only let producers you control send to these queues.

## Invalidating a tenant on every instance

Each instance of the app caches tenants (`CacheTenants`) and connection strings (`pro.CacheConnectionStrings()`) on
its own, and `ITenantInvalidator<TKey>.InvalidateAsync` clears only the instance that calls it. With MassTransit,
`pro.BroadcastInvalidationsOverMassTransit()` (`Tenantry.Pro.MassTransit`) publishes each invalidation over the app's
bus, and every other instance clears its own copies when it receives it:

```csharp
// Inside the app's existing AddTenantry(tenant => ...) call, beside AddMassTransit:
tenant.UsePro(pro => pro.BroadcastInvalidationsOverMassTransit());
```

It covers the invalidations provisioning and offboarding make, and does not need `pro.AddMassTransitPropagation()`. An
instance that is starting or has lost the broker misses what is published meanwhile, so keep cache durations no
longer than a stale tenant may be served. Without MassTransit, use Tenantry Core's `tenant.BroadcastInvalidations(...)`
with a channel of your own (https://tenantry.dev/docs/core/tenant-stores#several-instances).

## Work over every tenant

```csharp
using Tenantry;
using Tenantry.Pro;

public sealed class NightlyRollup(
    ITenantScopeFactory<string> scopeFactory, ITenantLookup<string> tenants, ILogger<NightlyRollup> logger)
    : PeriodicTenantBackgroundService<string>(scopeFactory, tenants, logger)
{
    protected override TimeSpan Interval => TimeSpan.FromHours(24);

    protected override async Task ExecuteForTenantAsync(ITenantScope<string> scope, CancellationToken ct)
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.SaveChangesAsync(ct);
    }
}

builder.Services.AddHostedService<NightlyRollup>();
```

`TenantBackgroundService<TKey>` runs once for every tenant and completes. Both skip suspended tenants, run one tenant
at a time unless `MaxConcurrency` is overridden, and log a tenant's exception and go on to the next.

More: https://tenantry.dev/docs/pro/background-jobs and the pages for each library
(https://tenantry.dev/docs/pro/hangfire, /quartz, /masstransit, /rebus).
