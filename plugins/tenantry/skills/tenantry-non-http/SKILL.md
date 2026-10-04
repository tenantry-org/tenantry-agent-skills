---
name: tenantry-non-http
description: Runs code as a Tenantry tenant outside HTTP requests, in workers, BackgroundService and hosted services, queue consumers, scheduled jobs, console tools and desktop apps. Use when Tenantry work has no request, or a job or worker loses its tenant.
license: Apache-2.0
compatibility: .NET 8, 9 or 10. Tenantry 0.7 or later.
metadata:
  tenantry-version: "0.7"
---

# Tenantry outside HTTP requests

In a web request, `app.UseTenantry()` makes the tenant current. Anywhere else, your code does, around each unit of
work. Until it does, no tenant is current: tenant-owned queries return no rows and tenant-owned saves throw
`TenantNotResolvedException`. That is Tenantry failing closed, not a bug to work around.

These instructions are for Tenantry 0.7 and later. If the project references Tenantry at 0.6 or earlier
(`dotnet list package`), upgrade every Tenantry package to 0.7 first: 0.6 has isolation gaps that 0.7 fixes, and some
names used here do not exist in it. What changed: https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md

## 1. Register Tenantry without ASP.NET Core

```bash
dotnet add package Tenantry.Core --version 0.7.0
dotnet add package Tenantry.EfCore --version 0.7.0     # when the host uses EF Core
```

```csharp
var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddTenantry<Guid>(tenant => tenant.UseStore<OrganisationTenantStore>());   // or UseInMemoryStore([...])

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry());
```

`--version 0.7.0` means 0.7.0 or later, so the command fails, rather than installing 0.6, until 0.7.0 is published.
A host that serves web requests too keeps its one `AddTenantry` call; the same registration serves both. Register a
store when any code looks tenants up by id: `ITenantLookup<TKey>` and `RunInScopeAsync` throw
`InvalidOperationException` without one.

## 2. Choose how to make the tenant current

`ITenantScopeFactory<TKey>` and `ITenantContextSetter<TKey>` are singletons, so a hosted service can take them in its
constructor. Choose by what you have:

| You have | Call | DI scope | Checks the tenant |
|----------|------|----------|-------------------|
| A tenant id, from a message, a job's data or a command-line argument | `scopes.RunInScopeAsync(id, work, ct)` | Opens one | Yes: missing throws `TenantNotFoundException`, suspended throws `TenantInactiveException` |
| A descriptor you read from the store yourself, such as in a loop over every tenant | `scopes.CreateScope(tenant)` | Opens one | No |
| A descriptor, inside a scope something else opened (a message framework's consumer scope, custom middleware) | `setter.MakeCurrent(tenant)` | None | No |

The trusted-descriptor rule: `CreateScope` and `MakeCurrent` trust the descriptor they are given. They do not look it
up or check whether it is active, so a descriptor the store does not hold becomes current like any other, and its id
filters queries and stamps new rows. Pass them only a descriptor you read from the store (or `ITenantLookup<TKey>`).
Whenever the work starts from an id, use `RunInScopeAsync`.

`IServiceProvider.CreateScope()` and `CreateAsyncScope()` are plain DI scopes and set no tenant.

Code for each case, including a loop over every tenant that skips suspended ones, is in
[references/patterns.md](references/patterns.md).

## 3. Follow the async rules

The current tenant is held in an `AsyncLocal`. It flows into code you call and await, never back out to your caller.

- Open the scope, or call `MakeCurrent`, in the method that does the work. A tenant made current inside an `async`
  helper is gone when the helper returns.
- Give each tenant its own scope and therefore its own `DbContext`. Never reuse one context across tenants.
- Work queued to run later must not rely on the current tenant: capture the id, and run the work with
  `RunInScopeAsync(id, ...)` when it happens.
- Never keep `CurrentTenant` in a singleton's field.
- Hosted services read tenants through `ITenantLookup<TKey>`, not by injecting the scoped store.

## 4. Desktop apps

Await `RunInScopeAsync` on the UI thread; never block on it with `.Result`, `.Wait()` or
`GetAwaiter().GetResult()`, which deadlocks. Details in [references/desktop.md](references/desktop.md).

## 5. Test it

Write the test in [references/worker-test.md](references/worker-test.md): it runs the work by tenant id against
SQLite in memory, and checks each tenant's rows are its own and that an unknown id is refused.

## 6. Verify

1. `dotnet build` has no new warnings.
2. The worker test passes.
3. Run the host once against a development database and check that rows written by the background work carry the
   right tenant id.

Hangfire, Quartz.NET, MassTransit and Rebus can carry the tenant into jobs and messages for you with Tenantry Pro, a
paid package (see the `tenantry-pro` skill). Without it, put the tenant id in the job or message yourself and use
`RunInScopeAsync` in the handler.

## Further reading

- Non-HTTP hosts: https://tenantry.dev/docs/core/non-http-hosts
- Core concepts, the `AsyncLocal` model: https://tenantry.dev/docs/core/core-concepts#the-asynclocal-model
- Testing: https://tenantry.dev/docs/core/testing
