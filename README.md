# Predictvilla

Football intelligence prediction platform. Node.js 22 / Express 5 / MySQL 8.

## Requirements

- Node.js 22+
- MySQL 8
- PM2 (`npm i -g pm2`)
- A server with Nginx (see `nginx.conf.example`)

## Quick Start

```bash
# 1. Clone and install
cd /var/www/predictvilla
npm install

# 2. Create environment file
cp .env.example .env
nano .env        # fill in all values

# 3. Create MySQL database
mysql -u root -p -e "CREATE DATABASE predictvilla CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Run migrations (creates all 20 tables + seeds admin user)
node config/migrate.js
node config/migrate_auth.js

# 5. Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup       # follow the printed command to enable auto-start
```

## Environment Variables

Copy `.env.example` to `.env` and fill in every value.

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `NODE_ENV` | `production` or `development` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL connection |
| `JWT_SECRET` | Long random string for signing JWTs |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (sk_live_…) |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook secret for HMAC verification |
| `API_FOOTBALL_KEY` | API-Football v3 key (fixtures, statistics and odds) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email delivery |
| `FROM_EMAIL` / `FROM_NAME` | Sender address shown in emails |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | VIP channel chat ID |
| `BASE_URL` | Public URL e.g. `https://predictvilla.com` |

## Admin Access

After migration the default admin account is:

- **Email:** `admin@predictvilla.com`
- **Password:** `Admin@OL!`

**Change this immediately** after first login via Dashboard → Settings.

Admin panel: `https://yourdomain.com/admin/`

## Nginx

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/predictvilla
# Edit domain name inside the file
sudo ln -s /etc/nginx/sites-available/predictvilla /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL via Certbot
sudo certbot --nginx -d predictvilla.com -d www.predictvilla.com
```

## PM2 Commands

```bash
pm2 status                  # check all instances
pm2 logs predictvilla         # tail logs
pm2 restart predictvilla      # rolling restart (no downtime in cluster mode)
pm2 stop predictvilla
pm2 delete predictvilla
```

## Cron Jobs (automatic)

All 9 jobs run automatically in PM2 cluster mode (only instance `pm_id === '0'` runs them):

| Time | Job |
|---|---|
| 06:00 daily | Sync fixtures (3 days ahead) + run Intelligence Engine |
| 23:30 daily | Sync yesterday's results + grade predictions |
| 00:00 daily | Log untracked predictions to accuracy log |
| 02:00 daily | Recalculate accuracy stats |
| 03:00 daily | Reset Odds API daily counter |
| Every hour | Check subscription expiries, send reminder emails |
| 07:30 daily | Re-score morning fixtures with fresh odds |
| Every 20 min | Grade any newly set results |
| Every 30 min | Sync live odds for today's fixtures |

## Architecture

```
server.js                  Express 5 entry point
config/
  db.js                    MySQL2 connection pool
  migrate.js               20-table schema + seeds
services/
  intelligence.js          Poisson score matrix + market selection
  confidence.js            5-factor confidence scorer (Bayesian)
  accuracy.js              Result grading + learning feedback loop
  statistics.js            Pre-computed stat queries
  scheduler.js             9 node-cron jobs
  apiFootball.js           API-Football v3 sync
  oddsApi.js               The Odds API sync
controllers/               Express route handlers
routes/                    Express routers
middleware/                auth.js, validate.js
utils/                     helpers.js, jwt.js, email.js
public/                    Static frontend (HTML + CSS + JS)
  admin/                   Admin panel
```

## Intelligence Engine

The engine scores each fixture using a Poisson probability model (score matrix up to k=6 goals), then selects the best market by:

1. Probability > 0.52
2. Value gap vs implied odds > 5%
3. Market-specific thresholds (BTTS, O/U, 1X2)

Confidence is calculated from 5 weighted factors (loaded from DB at query time):

- **Form** (default 0.30) — venue-specific last 6 results
- **H2H** (0.20) — head-to-head history
- **Odds** (0.20) — implied probability from bookie odds
- **Market** (0.15) — market-specific reliability coefficient
- **League** (0.15) — league tier coefficient

A Bayesian learning loop adjusts confidence based on real outcomes stored in `intelligence_outcomes`.

## VIP Gating

VIP content is gated **at the controller level** — non-VIP API responses return `tip: "🔒 VIP Pick"`, `analysis: null`, `odds: null`. Real data never reaches the client.

## Paystack Integration

- Frontend uses `PaystackPop.setup()` inline popup (CDN `https://js.paystack.co/v2/inline.js`)
- Backend verifies payment via Paystack API after popup callback
- Webhook (`POST /api/webhooks/paystack`) handles `charge.success` and `subscription.disable` with HMAC-SHA-512 signature verification

## Support

Open an issue or contact via the site's Contact page.
