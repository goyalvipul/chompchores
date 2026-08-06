# PWA email confirmation (Supabase Auth)

Local Docker kids app does **not** send email. This applies only to the Supabase PWA.

## Dashboard settings (you)

1. **Authentication → Providers → Email**
   - Enable Email provider
   - **Confirm email:** ON (required for signup activation)

2. **Authentication → URL configuration**
   - **Site URL:** your Cloudflare Pages URL (e.g. `https://chompchores.pages.dev`)
   - **Redirect URLs** allow-list:
     - `https://chompchores.pages.dev/**`
     - `http://localhost:4173/**`

3. **Authentication → Email templates → Confirm signup**

Suggested subject:

```text
Confirm your ChompChores household
```

Suggested body (HTML ok in Supabase editor):

```html
<h2>Welcome to ChompChores</h2>
<p>Hi {{ .Data.display_name }},</p>
<p>Thanks for creating your household. Confirm your email to activate your admin account:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
<p>After confirming, return to the app and sign in with your email or username.</p>
<p>— ChompChores</p>
```

4. Optional later: **Project Settings → Auth → SMTP** (Resend / SendGrid) for a branded From address. Until then Supabase sends from its default mailer (rate-limited on free tier).

## App behavior

- Sign up stores `display_name`, `username`, `phone`, `household_name` in Auth user metadata.
- After signup the PWA shows Sign in with a success message (does not enter the app).
- First successful authenticated `get_app_state` call runs `ensure_my_household()` which creates the household (default name **My House** unless changed), admin profile, and empty app state.
- Kids added via Manage use the `create_member` Edge Function (`email_confirm: true`) — no verification email for kids.

## Deploy Edge Function (admin add-user)

```bash
npx supabase functions deploy create_member --project-ref ixwwrmehcfmbporkgfzm
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in the function secrets (usually auto-injected on hosted Supabase).
