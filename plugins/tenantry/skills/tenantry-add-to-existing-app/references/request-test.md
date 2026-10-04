# The request test

This test runs the whole app in memory with `WebApplicationFactory<Program>`: its real `Program.cs`, store,
resolvers, access validators, pipeline and endpoints, against a test database. It proves that each tenant's requests
see only that tenant's rows, that new rows are stamped with the request's tenant, and that a request with no tenant,
an unknown tenant or a tenant the caller may not use is refused. It does not prove anything about endpoints it does
not call.

## What the test changes, and what it must not

- It points the app at a test database through configuration, the way the app reads its connection string. It does
  not replace the app's `DbContext` registration: that would skip the app's `UseTenantry()`.
- It replaces authentication with a test scheme that signs the caller in with the claims the test sends, so the
  test can act as a member of tenant A or B. The app's resolvers and access validators still run on those claims.
- Nothing else.

## Packages

```bash
dotnet add tests/MyApp.Tests package Microsoft.AspNetCore.Mvc.Testing --version <the app's ASP.NET Core version>
```

On .NET 8 and 9, add `public partial class Program;` at the end of the app's `Program.cs` so the test can name it
(.NET 10 makes the generated `Program` public).

## The test

The example is for an app that resolves the tenant from an `org_id` claim, reads its connection string from
`ConnectionStrings:App`, uses SQLite, and has `GET /projects` and `POST /projects?name=...` for a tenant-owned
`Project`. Replace these with the app's own: one endpoint that lists a tenant-owned type and one that creates it.

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

public sealed class TenantRequestTests
{
    private static readonly Guid TenantA = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01");
    private static readonly Guid TenantB = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02");

    [Fact]
    public async Task EachTenantSeesOnlyItsOwnRows()
    {
        await using var app = await TestApp.StartAsync();
        var a = app.ClientFor(TenantA);
        var b = app.ClientFor(TenantB);

        Assert.Equal(HttpStatusCode.Created, (await a.PostAsync("/projects?name=A-1", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await b.PostAsync("/projects?name=B-1", null)).StatusCode);

        Assert.Equal(["A-1"], await a.GetFromJsonAsync<string[]>("/projects") ?? []);
        Assert.Equal(["B-1"], await b.GetFromJsonAsync<string[]>("/projects") ?? []);
    }

    [Fact]
    public async Task ARequestWithNoTenantIsRefused()
    {
        await using var app = await TestApp.StartAsync();

        var response = await app.Factory.CreateClient().GetAsync("/projects");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ATenantTheStoreDoesNotHaveIsRefused()
    {
        await using var app = await TestApp.StartAsync();

        var response = await app.ClientFor(Guid.Parse("11111111-1111-1111-1111-111111111111")).GetAsync("/projects");

        // 404 with no access validator; 403 once one is configured.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // The app, with its own registration, on a test database of its own.
    private sealed class TestApp : IAsyncDisposable
    {
        private readonly string _databasePath;

        private TestApp(WebApplicationFactory<Program> factory, string databasePath)
        {
            Factory = factory;
            _databasePath = databasePath;
        }

        public WebApplicationFactory<Program> Factory { get; }

        public static async Task<TestApp> StartAsync()
        {
            var databasePath = Path.Combine(Path.GetTempPath(), $"tenant-requests-{Guid.NewGuid():N}.db");
            var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
            {
                // The connection string the app reads; its DbContext registration, with UseTenantry(), is unchanged.
                host.UseSetting("ConnectionStrings:App", $"Data Source={databasePath}");
                host.ConfigureTestServices(services => services
                    .AddAuthentication(TestAuthentication.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, TestAuthentication>(TestAuthentication.SchemeName, null));
            });

            // Create the schema and the tenants in a plain DI scope: no tenant is current, and none is needed.
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.MigrateAsync();
            db.Organisations.AddRange(
                new Organisation { Id = TenantA, Name = "Tenant A", Slug = "a" },
                new Organisation { Id = TenantB, Name = "Tenant B", Slug = "b" });
            await db.SaveChangesAsync();

            return new TestApp(factory, databasePath);
        }

        // A client signed in as a member of the tenant. For an app that names the tenant in a header and checks it
        // with ValidateTenantAccessByClaim("tenant_id"), send the claim as "tenant_id=..." and the header too:
        // client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString()). Then add a test that sends one
        // tenant's claim with another tenant's header and expects 403.
        public HttpClient ClientFor(Guid tenantId)
        {
            var client = Factory.CreateClient();
            client.DefaultRequestHeaders.Add(TestAuthentication.ClaimsHeader, $"org_id={tenantId}");
            return client;
        }

        public async ValueTask DisposeAsync()
        {
            await Factory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            File.Delete(_databasePath);
        }
    }

    // Signs the request in with the claims in the X-Test-Claims header ("type=value;type=value"), or not at all.
    private sealed class TestAuthentication(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "Test";
        public const string ClaimsHeader = "X-Test-Claims";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue(ClaimsHeader, out var header))
                return Task.FromResult(AuthenticateResult.NoResult());

            var claims = header.ToString()
                .Split(';', StringSplitOptions.RemoveEmptyEntries)
                .Select(pair => pair.Split('=', 2))
                .Select(pair => new Claim(pair[0], pair[1]));
            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
        }
    }
}
```

## Adapting it

- The app uses SQL Server or PostgreSQL: point `ConnectionStrings:...` at a database in a container
  (Testcontainers), not at SQLite, which would fail on provider-specific SQL in the migrations.
- The app's tenants come from an in-memory store or another service: use its tenant ids, and leave out the
  `Organisations` seed. When they are in a table of another context, migrate that context too and seed the tenants
  there.
- The app has no authentication yet: leave out the test scheme, and send the tenant the way its clients do (a header,
  a host). Tell the user that callers can then choose any tenant.
- The app sets `DefaultAuthenticateScheme` or `DefaultChallengeScheme` itself: set them to `TestAuthentication.SchemeName`
  in `ConfigureTestServices` as well.
- The app resolves from a subdomain or host: give the client the tenant's host,
  `Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://acme.example.com") })`.

## Check that the test can fail

Remove `UseTenantry()` from the app's registration and run the test: `EachTenantSeesOnlyItsOwnRows` must fail. Put
the call back.

More: https://tenantry.dev/docs/core/testing
