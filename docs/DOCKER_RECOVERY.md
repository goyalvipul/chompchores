# Docker recovery: email, testing, redeployment

Applies to **legacy Docker app** (root index.html + server.js + /data/data.json). The separate Supabase web PWA is not deployed by Docker Compose.

## What changed

- Username + password verification now happens on the Node server, using an HttpOnly session cookie.
- Forgot username emails the username(s) associated with a trusted recovery address.
- Forgot password emails a random, one-use reset link (20-minute expiry) and revokes existing sessions when used.
- The browser cannot read existing password hashes or anonymously use /data.
- Recovery addresses are **server environment settings**, not fields writable through the legacy JSON API.
- The older app still uses SHA-256 hashes and some client-side permissions. This is not a complete authorization overhaul; avoid exposing it publicly until fully hardened.

## 1. Back up the existing family data FIRST

~~~bash
cd /path/to/chompchores
mkdir -p backups
docker cp chompcores:/data/data.json "./backups/data-before-recovery-$(date +%Y%m%d-%H%M%S).json"
chmod 700 backups
chmod 600 backups/data-before-recovery-*.json
~~~

Do not use docker compose down -v, docker volume rm, or docker system prune --volumes. The named volume **chompcores_data** contains the household's existing data. No database migration or volume replacement is needed.

## 2. Determine your existing username, even if you cannot log in

~~~bash
docker exec chompcores node -e 'const d=require("/data/data.json"); console.log((d.users||[]).map(u=>u.username).join("\n"))'
~~~

Run only on your own Docker host. Do not publish this household file.

## 3. Configure mail delivery and verified recovery addresses

Create a private .env file alongside docker-compose.yml:

~~~dotenv
APP_BASE_URL=https://chores.example.com
RESEND_API_KEY=re_REPLACE_WITH_REAL_KEY
MAIL_FROM=ChompChores <recovery@example.com>
RECOVERY_CONTACTS=your_actual_username=you@example.com
COOKIE_SECURE=true
~~~

Resend needs a working API key and a domain verified for sending email. Change the example hostname, sender, username and email. For two accounts:

~~~dotenv
RECOVERY_CONTACTS=parent1=parent1@example.com,parent2=parent2@example.com
~~~

Alternative for just one account: set RECOVERY_USERNAME and RECOVERY_EMAIL instead of RECOVERY_CONTACTS.

Use the actual ChompChores username found in Step 2, not your GitHub username unless it happens to match. Recovery sends only to addresses explicitly configured on the server. App users cannot change their recovery email over the anonymous API.

~~~bash
chmod 600 .env
~~~

Use a real reachable HTTPS hostname for production. localhost is valid only for testing on the same machine. Never commit mail keys to GitHub.

## 4. Test in an isolated Docker Compose project

**Use a separate clone** to avoid changing production's bind-mounted files before its container restarts.

~~~bash
cd /path/to/projects
git clone --branch feature/forgot-username-password https://github.com/goyalvipul/chompchores.git chompchores-recovery-test
cd chompchores-recovery-test
# Create .env here using your mail settings and test values:
# APP_BASE_URL=http://localhost:3001
# COOKIE_SECURE=false
# RECOVERY_CONTACTS=maahira=your_email@example.com
CHOMPCHORES_CONTAINER_NAME=chompcores-recovery-test CHOMPCHORES_PORT=3001 \
  docker compose -p chompchores-recovery-test up -d --build
docker compose -p chompchores-recovery-test ps
~~~

Visit http://localhost:3001 **on that host**. The test project has its own container, port, and fresh named volume. The legacy demo account is initially maahira / cherry; change it after testing. The production volume remains untouched.

If testing from another device, provide an HTTPS test hostname for port 3001 and set APP_BASE_URL to that hostname instead. Do not use localhost as an email reset link for remote users. Do not publish this default-credential test instance.

Run the automated tests on a machine with Node 20+:

~~~bash
node --test tests/auth.test.cjs
~~~

To stop the test but retain its volume:

~~~bash
docker compose -p chompchores-recovery-test down
~~~

## 5. Deploy this branch to the existing Docker instance

Run from the **original production repository folder**, after the backup and .env setup:

~~~bash
cd /path/to/chompchores
git fetch origin
docker compose stop chompcores
git switch feature/forgot-username-password
git pull --ff-only origin feature/forgot-username-password
docker compose config
docker compose up -d --build --no-deps chompcores
docker compose ps
docker compose logs --tail=100 chompcores
~~~

The brief stop prevents the old Node process from serving updated bind-mounted HTML. The existing Compose project and volume are preserved. There is no need to remove the container or database.

For subsequent code changes on this branch:

~~~bash
git pull --ff-only origin feature/forgot-username-password
docker compose up -d --build --no-deps chompcores
~~~

Check both recovery links and confirm that chores, history and points remain unchanged. Users will need to sign in again after the first deployment.

## 6. Emergency password reset without working email

If you own the Docker host and cannot configure email yet, a trusted local operator can reset one password using the bundled script. It makes a JSON backup, chooses a random temporary password, and displays that password once.

~~~bash
docker exec chompcores node /app/scripts/reset-legacy-password.cjs your_actual_username
~~~

Copy the temporary password and sign in. The command is available after the image has been rebuilt on the new branch. Run only on a private terminal, because the one-time password will be visible in terminal output. It does not affect Supabase users.

## 7. Rollback

~~~bash
docker compose stop chompcores
git switch main
docker compose up -d --build --no-deps chompcores
~~~

Your volume stays in place. Rolling back also restores the **old insecure /data API**. Treat it as an emergency temporary rollback, and don't expose that version on the public internet. Do not restore a data backup unless you have confirmed that the current data itself is damaged.

## Scope and security limitations

This branch removes anonymous JSON access, verifies logins on the server, and sends reset links to operator-defined mailboxes. However it retains a shared client-editable household JSON state, legacy SHA-256 password hashes, and incomplete server-side authorization for every chore/reward/admin action. It is appropriate to test on a trusted network first, not to declare fully production-hardened for unrestricted internet access. A later security migration should implement per-action server authorization and a salted slow password KDF.
