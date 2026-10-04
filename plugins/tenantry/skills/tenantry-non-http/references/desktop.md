# Desktop apps

WPF, WinForms, MAUI and Avalonia apps register Tenantry the same way as a worker, usually with
`Host.CreateApplicationBuilder` or a `ServiceCollection` built at startup. The user picks or signs in to a tenant;
the app then runs each piece of work as that tenant.

## Await `RunInScopeAsync`, never block on it

The UI thread has a synchronization context. The work you pass to `RunInScopeAsync` starts on the context you called
it from, so it can update the UI, and the scope's services are disposed there too, where they were created. Because
`RunInScopeAsync` returns to that context, await it:

```csharp no-compile
private async void LoadButton_Click(object sender, RoutedEventArgs e)
{
    var invoices = await _scopes.RunInScopeAsync(_selectedTenantId, (scope, ct) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>().Invoices.ToListAsync(ct));

    InvoiceList.ItemsSource = invoices;
}
```

Blocking on it on the UI thread (`.Result`, `.Wait()`, `.GetAwaiter().GetResult()`) deadlocks: the UI thread waits
for work that needs the UI thread to finish.

Tenantry's own reads do not return to the context, so a store read, an activity check or a connection string that
your code waits for on the UI thread does not deadlock, though it still freezes the UI while it runs. Use
`ConfigureAwait(false)` in your own store and connection-string delegates for the same reason.

## One tenant for the whole window

For an app that works as one tenant until the user switches, keep the tenant's id (not its scope) and open a scope per
operation as above. A scope kept open for the life of a window keeps one `DbContext` alive, whose change tracker keeps
growing and keeps entities from before any switch.

## Switching tenant

Open new scopes with the new id. Do not reuse a context or a scope from the previous tenant: after a switch, `Find` and
`Local` can still return the previous tenant's tracked entities (writing them is refused).

More: https://tenantry.dev/docs/core/non-http-hosts#desktop-apps
