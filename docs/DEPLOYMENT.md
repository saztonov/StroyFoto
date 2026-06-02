# Развёртывание StroyFoto на VPS `hub` (stroyfoto.su10.ru)

> Ops-инструкция по **фактической** установке в проде. Отличается от обобщённого
> деплоя в `README.md` (там Netlify/S3 + отдельная VM). Здесь — реальная схема на
> общем сервере, где рядом работают ещё несколько сайтов.
>
> 🔴 **Главный принцип: не навреди соседям.** На `hub` один общий nginx, общий
> apache2, общий certbot и панель ISPmanager. Любое действие по StroyFoto должно
> затрагивать **только** артефакты StroyFoto. Перечень «что можно трогать» — в
> разделе [3](#3-соседи-и-изоляция). Перед каждым изменением сверяйся с
> чеклистом в разделе [5](#5-правила-безопасности-для-соседей).

---

## 0. Шпаргалка (частые операции)

```bash
# --- ОБНОВИТЬ БЭКЕНД ---
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run server:build'
systemctl restart stroyfoto-api               # перезапускается ТОЛЬКО наш сервис
curl -fsS http://127.0.0.1:4000/api/health    # ждём {"ok":true,...}

# --- ОБНОВИТЬ ФРОНТЕНД ---
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run build'
ts=$(date +%F_%H-%M-%S)
cp -a /srv/sites/stroyfoto.su10.ru/public "/srv/sites/stroyfoto.su10.ru/public.bak.$ts"
rsync -a --delete /opt/stroyfoto-api/dist/ /srv/sites/stroyfoto.su10.ru/public/
chown -R www-data:www-data /srv/sites/stroyfoto.su10.ru/public
# nginx перезагружать НЕ нужно — это статика

# --- ПРАВКА NGINX (если действительно нужно) ---
nano /etc/nginx/snippets/stroyfoto-api-proxy.conf   # или sites-available/stroyfoto.su10.ru
nginx -t && systemctl reload nginx                  # reload, НЕ restart
```

---

## 1. Обзор

- **Сервер:** `hub`, Ubuntu, общий для нескольких сайтов зоны `*.su10.ru`.
- **Домен:** `https://stroyfoto.su10.ru`.
- **Тип приложения:** статический фронтенд (Vite/React PWA) + собственный
  бэкенд (Node + Fastify) + Yandex Managed PostgreSQL + Cloud.ru Object Storage.

```
Браузер / PWA
   │  HTTPS
   ▼
nginx (общий, vhost stroyfoto.su10.ru, TLS)
   ├─ /            → статика из /srv/sites/stroyfoto.su10.ru/public
   │                 (SPA-fallback: try_files $uri $uri/ /index.html)
   └─ /api/        → proxy_pass http://127.0.0.1:4000   (Fastify)
                        │
                        ├─► Yandex Managed PostgreSQL  (pg pool, TLS verify-full)
                        └─► POST /api/storage/presign → Cloud.ru S3 (SigV4)

Браузер ── PUT/GET по presigned URL ──► https://s3.cloud.ru/<bucket>/...
```

Фронт ходит только в `/api/*` (same-origin, `VITE_API_URL=/api`). Секреты БД и
Cloud.ru живут только в `server/.env` и в клиент не попадают.

---

## 2. Карта артефактов на сервере

| Что | Путь | Владелец | Примечание |
|-----|------|----------|------------|
| Web-root фронта | `/srv/sites/stroyfoto.su10.ru/public` | `www-data:www-data` | **реальная папка**, не симлинк; сюда копируется собранный `dist/` |
| Логи nginx сайта | `/var/log/nginx/stroyfoto.su10.ru.{access,error}.log` | — | |
| Исходники + сборка | `/opt/stroyfoto-api` | `stroyfoto:stroyfoto` | git-репо; и фронт, и `server/` в одном проекте |
| Собранный фронт | `/opt/stroyfoto-api/dist/` | `stroyfoto` | результат `npm run build` |
| Собранный бэк | `/opt/stroyfoto-api/server/dist/server.js` | `stroyfoto` | результат `npm run server:build` |
| Env бэкенда | `/opt/stroyfoto-api/server/.env` | `stroyfoto` | секреты (DB, JWT, Cloud.ru) |
| Env фронта | `/opt/stroyfoto-api/.env.production` | `stroyfoto` | `VITE_API_URL=/api` |
| systemd-сервис | `/etc/systemd/system/stroyfoto-api.service` | `root` | `User=stroyfoto`, порт 4000 |
| nginx vhost | `/etc/nginx/sites-available/stroyfoto.su10.ru` (+ symlink в `sites-enabled/`) | `root` | |
| nginx proxy-сниппет | `/etc/nginx/snippets/stroyfoto-api-proxy.conf` | `root` | `location /api/` → :4000 |
| TLS-сертификат | `/etc/letsencrypt/live/garant.su10.ru/` | `root` | ⚠️ **общий** с garant (см. ниже) |
| Схема БД (снапшот) | `/opt/stroyfoto-api/database/stroyfoto.schema.sql` | `stroyfoto` | дамп текущей схемы Yandex MDB |

### Бэкенд-сервис (`stroyfoto-api.service`)

```ini
[Service]
Type=simple
User=stroyfoto
Group=stroyfoto
WorkingDirectory=/opt/stroyfoto-api
EnvironmentFile=/opt/stroyfoto-api/server/.env
ExecStart=/usr/bin/node /opt/stroyfoto-api/server/dist/server.js
Restart=always
RestartSec=5
```

Слушает `127.0.0.1:4000` (наружу не торчит — только через nginx).
`server/.env` читается дважды: systemd (`EnvironmentFile`) и сам код через
`dotenv` (`server/src/config.ts`). Достаточно отредактировать один файл.

### nginx proxy-сниппет

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

### Ключи `server/.env`

`NODE_ENV`, `HOST`, `PORT` (4000), `LOG_LEVEL`, `DATABASE_URL`, `PGSSLROOTCERT`,
`JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `CORS_ORIGINS`,
`CLOUDRU_TENANT_ID`, `CLOUDRU_KEY_ID`, `CLOUDRU_KEY_SECRET`, `CLOUDRU_BUCKET`,
`CLOUDRU_ENDPOINT`, `CLOUDRU_REGION`.

### База данных

**Yandex Managed PostgreSQL.** Подключение через `DATABASE_URL`:

```
host: c-c9qmbgvs6rit4qfe0dni.rw.mdb.yandexcloud.net : 6432   (6432 = пулер, .rw. = мастер)
db:   stroyfoto
TLS:  sslmode=verify-full + CA из PGSSLROOTCERT (root.crt)
```

CA-сертификат Yandex MDB обязателен — путь к нему задаёт `PGSSLROOTCERT` в
`server/.env` (см. логику в `server/src/db.ts`).

---

## 3. Соседи и изоляция

На `hub` крутятся ещё сайты и сервисы. **Их трогать нельзя.**

**Другие сайты (nginx vhosts, web-root `/srv/sites/<домен>/public`):**
`cards.su10.ru`, `fot.su10.ru`, `garant.su10.ru`, `let.su10.ru`,
`payhub.su10.ru`, `refhub.su10.ru`, `tender.su10.ru`.

**Соседние backend-сервисы (НЕ перезапускать, НЕ останавливать):**
`cards-api.service`, `garanthub-backend.service`, `hubtender-bff.service`,
`payhub-bff.service`. Слушают свои порты (`127.0.0.1:3000/3001/3005/8090`).
StroyFoto — это `stroyfoto-api.service` на **:4000**, и только он наш.

**Общая инфраструктура (трогать только осознанно и точечно):**

- **nginx** — один инстанс на все сайты. Свой конфиг StroyFoto — только
  `sites-available/stroyfoto.su10.ru` + `snippets/stroyfoto-api-proxy.conf`.
  Никогда не редактируй `nginx.conf`, `conf.d/*` или vhost'ы соседей.
- **apache2** — тоже общий (обслуживает часть сайтов). StroyFoto его не
  использует — не трогать вообще.
- **ISPmanager** установлен (`/usr/local/mgr5`). ⚠️ Панель умеет
  **перегенерировать** общие конфиги nginx/apache. Если правишь конфиг StroyFoto
  вручную — знай, что операции через панель потенциально могут затереть правки;
  держи бэкап своего vhost (см. раздел 4.4).
- **TLS-сертификат общий:** vhost `stroyfoto.su10.ru` использует
  `/etc/letsencrypt/live/garant.su10.ru/`. ⚠️ **Не перевыпускай и не удаляй**
  этот сертификат «ради StroyFoto» — на нём завязан и garant. Продление —
  штатным `certbot.timer`, руками не вмешиваться.

---

## 4. Процедуры обновления

> Все сборочные команды — под пользователем `stroyfoto` (репо принадлежит ему;
> `git` под `root` выдаёт «dubious ownership»). `systemctl` и копирование в
> `/srv` — под `root`.

### 4.1. Обновление фронтенда

Фронт — статика; сервис и nginx при этом не трогаются.

```bash
# 1. Подтянуть код и собрать (под stroyfoto)
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run build'

# 2. Бэкап текущего public (для отката)
ts=$(date +%F_%H-%M-%S)
cp -a /srv/sites/stroyfoto.su10.ru/public "/srv/sites/stroyfoto.su10.ru/public.bak.$ts"

# 3. Залить новую сборку (--delete убирает устаревшие файлы)
rsync -a --delete /opt/stroyfoto-api/dist/ /srv/sites/stroyfoto.su10.ru/public/
chown -R www-data:www-data /srv/sites/stroyfoto.su10.ru/public
```

PWA настроена на `autoUpdate` (skipWaiting + clientsClaim) — открытые вкладки
подхватят новую версию сами. nginx перезагружать **не нужно**.

### 4.2. Обновление бэкенда

```bash
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run server:build'

systemctl restart stroyfoto-api          # перезапускается ТОЛЬКО stroyfoto-api
systemctl status stroyfoto-api --no-pager
curl -fsS http://127.0.0.1:4000/api/health    # {"ok":true,"service":"stroyfoto-api"}
```

Если меняли и фронт, и бэк — соберите оба (`npm run build` + `npm run
server:build`), затем выполните копирование из 4.1 и `restart` из 4.2.

### 4.3. Изменения схемы БД (Yandex MDB)

🔴 **Опасная зона.** Перед любыми DDL — резервная копия (у Yandex MDB есть
автобэкапы в консоли; для точечной — `pg_dump`). Сначала прогоняй на тестовой
БД/ветке, в прод — только проверенное.

- Актуальный снапшот схемы: `/opt/stroyfoto-api/database/stroyfoto.schema.sql`
  (выгружается из живой БД через `npm run db:schema:pull`). Это **снимок для
  справки/первичного развёртывания**, а не «накатить на прод повторно».
- Скрипт `scripts/db/apply-migrations.sh` (он же `npm run migrate:db`) применяет
  `*.sql` из каталога `db/migrations/` по алфавиту, каждую в одной транзакции с
  `ON_ERROR_STOP`. На данный момент каталога `db/migrations/` в репо нет —
  автопайплайна миграций ещё нет, изменения накатываются вручную.

Применение конкретного SQL к Yandex MDB (TLS-CA подхватывается из `.env`):

```bash
sudo -u stroyfoto bash -lc '
  set -a; . /opt/stroyfoto-api/server/.env; set +a
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction -f /путь/к/change.sql
'
```

Если/когда появятся миграции в `db/migrations/`:

```bash
sudo -u stroyfoto bash -lc '
  set -a; . /opt/stroyfoto-api/server/.env; set +a
  cd /opt/stroyfoto-api && npm run migrate:db -- --dry-run   # сперва посмотреть список
  cd /opt/stroyfoto-api && npm run migrate:db                # затем применить
'
```

### 4.4. Правка nginx

Редактируй **только** свои файлы:

```bash
# бэкап своего vhost (на случай перегенерации ISPmanager)
cp /etc/nginx/sites-available/stroyfoto.su10.ru \
   "/etc/nginx/sites-available/stroyfoto.su10.ru.bak.$(date +%F_%H-%M-%S)"

nano /etc/nginx/sites-available/stroyfoto.su10.ru      # или:
nano /etc/nginx/snippets/stroyfoto-api-proxy.conf

nginx -t                       # ОБЯЗАТЕЛЬНО до перезагрузки
systemctl reload nginx         # reload (graceful), НЕ restart — соседи не падают
```

Никогда: `systemctl restart nginx`, правки `nginx.conf` / `conf.d/*` / чужих
vhost'ов, ручной перевыпуск общего сертификата `garant.su10.ru`.

### 4.5. Изменение переменных окружения

```bash
sudo -u stroyfoto nano /opt/stroyfoto-api/server/.env
systemctl restart stroyfoto-api
curl -fsS http://127.0.0.1:4000/api/db-health   # если меняли DATABASE_URL/TLS
```

`CORS_ORIGINS` должен включать `https://stroyfoto.su10.ru`. При смене
`CLOUDRU_*` — проверь, что в Cloud.ru настроен CORS бакета на этот origin.

---

## 5. Правила безопасности для соседей (чеклист)

Перед изменением — пройди по списку:

- [ ] Я правлю только: `/opt/stroyfoto-api/**`,
      `/srv/sites/stroyfoto.su10.ru/**`,
      `sites-available/stroyfoto.su10.ru`, `snippets/stroyfoto-api-proxy.conf`,
      `stroyfoto-api.service`.
- [ ] Перезапускаю/останавливаю **только** `stroyfoto-api.service`
      (никогда не `restart nginx`/`apache2`, никогда не чужие `*-api`/`*-bff`/`*-backend`).
- [ ] Для nginx: сделал `nginx -t`, использую `reload`, а не `restart`.
- [ ] Не трогаю общий сертификат `garant.su10.ru` и `certbot.timer`.
- [ ] Не редактирую глобальные `nginx.conf` / `conf.d/*` / vhost'ы соседей.
- [ ] git-команды и сборку запускаю под `stroyfoto`, копирование в `/srv` — под root.
- [ ] Перед заменой фронта/конфига сделал бэкап (`public.bak.*` / `*.bak.*`).
- [ ] DDL к БД — только с бэкапом и после прогона на тесте.

---

## 6. Откат (rollback)

**Фронтенд** — вернуть прошлую сборку из бэкапа:

```bash
ls -d /srv/sites/stroyfoto.su10.ru/public.bak.*      # выбрать нужный
rsync -a --delete /srv/sites/stroyfoto.su10.ru/public.bak.<ts>/ \
                  /srv/sites/stroyfoto.su10.ru/public/
chown -R www-data:www-data /srv/sites/stroyfoto.su10.ru/public
```

**Бэкенд** — откатить код и пересобрать:

```bash
sudo -u stroyfoto git -C /opt/stroyfoto-api log --oneline -5
sudo -u stroyfoto git -C /opt/stroyfoto-api checkout <предыдущий-commit>
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run server:build'
systemctl restart stroyfoto-api
journalctl -u stroyfoto-api -n 50 --no-pager
curl -fsS http://127.0.0.1:4000/api/health
```

**nginx** — вернуть сохранённый `.bak` своего vhost, затем `nginx -t && systemctl
reload nginx`.

---

## 7. Диагностика

```bash
# Сервис и порт
systemctl status stroyfoto-api --no-pager
journalctl -u stroyfoto-api -f                 # живые логи (pino JSON)
journalctl -u stroyfoto-api -n 200 --no-pager  # последние строки
ss -tlnp | grep 4000                           # слушает ли бэкенд

# Здоровье приложения
curl -fsS http://127.0.0.1:4000/api/health      # {"ok":true,"service":"stroyfoto-api"}
curl -fsS http://127.0.0.1:4000/api/db-health   # проверка связи с Yandex MDB (503 = БД недоступна)
curl -fsS https://stroyfoto.su10.ru/api/health  # сквозная проверка через nginx

# Прямой тест подключения к БД (TLS-CA берётся из .env)
sudo -u stroyfoto bash -lc 'set -a; . /opt/stroyfoto-api/server/.env; set +a; psql "$DATABASE_URL" -c "select 1"'

# Логи nginx сайта
tail -n 100 /var/log/nginx/stroyfoto.su10.ru.error.log
tail -n 100 /var/log/nginx/stroyfoto.su10.ru.access.log

# Проверка конфига nginx без применения
nginx -t
```

Типовые причины проблем:

- **502/504 на `/api/`** — упал/не слушает бэкенд: `systemctl status
  stroyfoto-api`, `journalctl -u stroyfoto-api`, `ss -tlnp | grep 4000`.
- **`/api/db-health` → 503** — недоступна Yandex MDB: проверь `DATABASE_URL`,
  `PGSSLROOTCERT` (есть ли файл CA), сеть до `*.mdb.yandexcloud.net:6432`,
  правила безопасности облака.
- **Белый экран / 404 на ассетах** — кривая выкладка фронта: проверь
  `/srv/sites/stroyfoto.su10.ru/public` (есть `index.html` и `assets/`),
  владельца `www-data`.
- **CORS-ошибки** — `CORS_ORIGINS` в `server/.env` не содержит текущий origin.
- **Внезапно слетел vhost/правки** — мог вмешаться ISPmanager: восстанови из
  `*.bak.*`, затем `nginx -t && systemctl reload nginx`.

---

## 8. Кратко: чем это отличается от README

`README.md` описывает обобщённый деплой (статик-хостинг + отдельная VM/контейнер,
reverse proxy «вообще»). Реальная установка на `hub`:

- фронт и бэк лежат в **одном** каталоге `/opt/stroyfoto-api` (монорепо);
- бэкенд — systemd-сервис на `127.0.0.1:4000`, а не контейнер;
- фронт раздаётся **общим** nginx как статика из `/srv/sites/.../public`;
- БД — **Yandex Managed PostgreSQL** (не Supabase, не локальный Postgres);
- хранилище — **Cloud.ru Object Storage** (S3-совместимое), presign на бэкенде.
