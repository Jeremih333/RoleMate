# Northflank deployment

The account is on the Developer Sandbox tier and already contains the empty
project `anon-chat`. Deploy RoleMate into that project:

```powershell
northflank create service combined `
  --projectId anon-chat `
  --file infrastructure/northflank/service.json `
  --output json
```

`service.json` contains only non-secret settings. Inject
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `INTERNAL_API_SECRET`,
`SESSION_SECRET`, `PUBLIC_BASE_URL`, `MINI_APP_URL`, and `ALLOWED_ORIGINS`
through a restricted Northflank secret group.

Northflank requires a default payment method even for Developer Sandbox
resources. The Sandbox allowance is limited to two services, two jobs, and one
addon; check the current account plan before creating additional resources.
