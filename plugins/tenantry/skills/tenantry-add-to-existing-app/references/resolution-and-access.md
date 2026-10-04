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

## Pipeline order

```csharp
app.UseAuthentication();
app.UseAuthorization();   // first, so an anonymous caller gets 401 rather than 403
app.UseTenantry();        // reads User and endpoint metadata
app.MapControllers();
```

With an authorization policy that reads the tenant, put `app.UseTenantry()` between authentication and authorization
instead. `WebApplication` adds routing first; a custom pipeline calls `UseRouting()` before `UseTenantry()`. Static
files and other middleware that must not resolve a tenant go before it.

## Authentication settings per tenant

When tenants sign in with settings of their own (an `Authority`, client id or cookie name), set them per scheme with
`ConfigurePerTenant` from `Tenantry.Options` (`dotnet add package Tenantry.Options --version 0.7.0`), and resolve the
tenant before authentication:

```csharp
app.UseTenantResolution();   // finds the tenant and makes it current
app.UseAuthentication();     // authenticates with the tenant's settings
app.UseTenantry();           // runs the access validators, then rejects or continues
app.UseAuthorization();      // sees only a tenant the validators allowed
```

Call `app.UseAuthentication()` and `app.UseAuthorization()` yourself, and put only authentication between the first
two. Authorization between them makes the app fail to start (or, added another way, refuses each request with `500`
and event 1013). Resolve from the host, subdomain, route or header, added before any claim resolver.

Between `UseTenantResolution()` and `UseTenantry()` the tenant is current but not yet checked against the user. So
code that runs during authentication (`OnTokenValidated`, `OnValidatePrincipal`, `IClaimsTransformation`) must not
grant claims, roles or permissions from the current tenant, must not write as it, and must not renew or reissue a
cookie with claims taken from it.

Cookies of every tenant decrypt with the app's one key ring. Add a `tenant_id` claim at sign-in and validate it
(`ValidateTenantAccessByClaim("tenant_id")`), and name the cookie per tenant, so a user of one tenant is simply
anonymous on another:

```csharp
using Microsoft.AspNetCore.Authentication.Cookies;

tenant.ConfigurePerTenant(perTenant => perTenant
    .Configure<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme, (o, t) =>
        o.Cookie.Name = $".App.{t.TenantId}"));
```

With ASP.NET Core Identity, name each of its four cookie schemes this way: `IdentityConstants.ApplicationScheme`,
`ExternalScheme`, `TwoFactorRememberMeScheme` and `TwoFactorUserIdScheme`.

The cookie name is the recommended set-up; Tenantry's refusal is the safety net. When the validators refuse a tenant
that was current during authentication and the request has a signed-in user, the whole request is refused (`403` by
default) on every endpoint, sign-in pages included. Tenantry signs out every scheme that signs out locally (each
cookie scheme), so `OnSigningOut` handlers run on these refusals: do not treat them as a logout the user asked for. The
response carries no cookies set after `UseTenantResolution()` and no sign-out redirect. A failed sign-out logs event
1015; event 1014 at startup means the authorization-order check no longer works on that ASP.NET Core version.

More: https://tenantry.dev/docs/core/authentication-per-tenant and https://tenantry.dev/docs/core/aspnetcore-identity

More: https://tenantry.dev/docs/core/tenant-resolution and https://tenantry.dev/docs/core/access-control
