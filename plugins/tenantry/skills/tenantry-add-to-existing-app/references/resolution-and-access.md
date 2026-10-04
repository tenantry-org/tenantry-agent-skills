# Resolution and access validation

Two separate decisions. Resolution reads which tenant a request names. Access validation checks that the caller may
use that tenant. Resolution alone is never enough when the caller can choose the value (a header, a subdomain, a
route): add a validator.

## Pick the resolver

| The app today | Resolver | Access validation |
|---------------|----------|-------------------|
| Each token carries exactly one tenant id | `ResolveFromClaim("tenant_id")` | Not needed: the caller cannot name another tenant |
| Tokens list several tenants, the client picks one | `ResolveFromHeader("X-Tenant-Id")` | `ValidateTenantAccessByClaim("tenant_id")` |
| A browser app on `acme.example.com` | `ResolveFromSubdomain(o => o.BaseDomains.Add("example.com"))` | A claim or membership validator |
| Tenants bring their own domains | `ResolveFromHost(o => o.ExcludedDomains.Add("example.com"))`, added last | A claim or membership validator |
| Routes such as `/orgs/{tenant}/orders` | `ResolveFromRouteValue("tenant")` | A claim or membership validator |
| Membership is in a database table | any of the above | `ValidateTenantAccess<MembershipValidator>()` |

Use the claim type and header name the app already issues and sends. `ResolveFromQueryString` is for development and
tests only. Several resolvers are tried in the order added, and the first identifier one returns is used, so put the
most trusted first.

A subdomain, host or slug is usually not the tenant id: implement `FindByIdentifierAsync` in the store (see
[tenant-store.md](tenant-store.md)). `ResolveFromSubdomain` with `BaseDomains` set resolves only one label before a
base domain; add `localhost` to `BaseDomains` so `acme.localhost` works in development.

## Claim validation

```csharp
tenant.ValidateTenantAccessByClaim("tenant_id");
```

Passes when any `tenant_id` claim on `HttpContext.User` equals the resolved tenant's id. It accepts repeated claims
and one claim holding a JSON array. The claims must hold tenant ids, not slugs. `app.UseTenantry()` must run after
`app.UseAuthentication()`.

## Membership validation

```csharp
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tenantry;
using Tenantry.AspNetCore;

public sealed class MembershipValidator(AppDbContext db) : ITenantAccessValidator<Guid>
{
    public async ValueTask<bool> ValidateAsync(HttpContext http, ITenantDescriptor<Guid> tenant, CancellationToken ct) =>
        await db.Memberships.AnyAsync(
            m => m.UserId == http.User.FindFirstValue(ClaimTypes.NameIdentifier) && m.OrganisationId == tenant.TenantId,
            ct);
}
```

```csharp
tenant.ValidateTenantAccess<MembershipValidator>();
```

It is created in each request's scope. `ValidateTenantAccess<T>()` returns the builder without its key type, so call
it as a statement of its own or last in the chain. The membership table is not tenant-owned (it says which tenants a
user belongs to), so it stays unmarked. Several validators combine with AND.

## Requiring a tenant

```csharp
tenant.RequireTenantByDefault();
```

```csharp
app.MapGet("/health", () => "ok").AllowMissingTenant();
app.MapGet("/orders", (AppDbContext db) => db.Orders.ToListAsync()).RequireTenant();   // per endpoint, if not by default
```

Controllers use `[RequireTenant]` and `[AllowMissingTenant]` from `Tenantry.AspNetCore`. Without
`RequireTenantByDefault()`, an endpoint that is not marked runs with no tenant when none resolves, and its tenant-owned
queries return nothing.

Responses on an endpoint that requires a tenant:

| Situation | Status |
|-----------|--------|
| No resolver produced an identifier | `400` |
| The identifier names no tenant | `404`, or `403` once any access validator is configured |
| A validator refused the tenant | `403` |
| `ValidateTenantActivity` refused it | `403` |

The bodies are empty unless `builder.Services.AddProblemDetails()` is registered.

`UseTenantry()` answers before `UseAuthorization()`. With `ResolveFromClaim`, a request without a valid token has no
claim and so no tenant, and gets `400` rather than the `401` clients may expect. Change the status if they rely on it:

```csharp
tenant.ConfigureResolution(o => o.MissingTenantStatusCode = StatusCodes.Status401Unauthorized);
```

## Pipeline order

```csharp
app.UseAuthentication();
app.UseTenantry();        // reads User and endpoint metadata
app.UseAuthorization();
app.MapControllers();
```

`WebApplication` adds routing first. A custom pipeline calls `UseRouting()` before `UseTenantry()`. Static files and
other middleware that must not resolve a tenant go before it. For authentication settings that differ per tenant, see
https://tenantry.dev/docs/core/authentication-per-tenant.

More: https://tenantry.dev/docs/core/tenant-resolution and https://tenantry.dev/docs/core/access-control
