# ⭐ ChompChores

Chore tracking app for Maahira. Runs on your local network — open it on any phone, tablet, or computer in your house.

## Features

- **Dashboard** — Maahira checks off chores. No PIN needed here.
- **Rewards** — PIN protected. Redeem points for rewards.
- **History** — PIN protected. Full log: every chore, reward, penalty, per day.
- **Manage** — PIN protected. Add/remove chores, rewards, configure settings.
- **Groups** — chores bundled together; all must be done to earn the group's points.
- **Daily target** — if Maahira doesn't hit the target by midnight, a penalty is auto-deducted.
- **Auto midnight reset** — chores clear automatically each day. Penalty applied if target was missed.
- **Negative balance** — the bank can go negative (red screen) if rewards are redeemed without enough points.
- **Persistent** — everything saved in `localStorage`. Survives reloads and reboots (same browser).

## Default PIN

**1234** — change it immediately in Manage → Settings → Change PIN.

## Deploy (Unix container / machine)

```bash
# 1. Copy the folder to your server
scp -r MaahiChores user@server:/opt/maahichores

# 2. SSH in and run
ssh user@server
cd /opt/maahichores
node server.js
```

Or keep it running with PM2:
```bash
npm install -g pm2
pm2 start server.js --name maahichores
pm2 startup   # auto-start on reboot
pm2 save
```

Or as a systemd service (create /etc/systemd/system/maahichores.service):
```ini
[Unit]
Description=MaahiChores
After=network.target

[Service]
WorkingDirectory=/opt/maahichores
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```
```bash
systemctl enable maahichores
systemctl start maahichores
```

## Change port
```bash
PORT=8080 node server.js
```
