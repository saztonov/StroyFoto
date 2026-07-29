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
# --- ОБНОВИТЬ ВСЁ (фронт + бэк) ---
bash /opt/stroyfoto-api/scripts/deploy.sh --dry-run   # посмотреть план
bash /opt/stroyfoto-api/scripts/deploy.sh             # выполнить

# --- ТОЛЬКО ОДИН КОМПОНЕНТ ---
bash /opt/stroyfoto-api/scripts/deploy.sh --api-only
bash /opt/stroyfoto-api/scripts/deploy.sh --front-only

# --- МИГРАЦИИ БД (отдельно, ДО деплоя кода) ---
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && \
  bash scripts/db/apply-migrations.sh --env-file server/.env --status'
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && \
  bash scripts/db/apply-migrations.sh --env-file server/.env'
bash /opt/stroyfoto-api/scripts/deploy.sh --ack-migrations-applied

# --- ПРАВКА NGINX (если действительно нужно) ---
nano /etc/nginx/snippets/stroyfoto-api-proxy.conf   # или sites-available/stroyfoto.su10.ru
nginx -t && systemctl reload nginx                  # reload, НЕ restart
```

`deploy.sh` запускается **под root на самом hub**, к БД не подключается и трогает ровно
один сервис — `stroyfoto-api`. Что он делает по шагам — раздел [4](#4-процедуры-обновления);
разовая подготовка сервера — раздел [9](#9-bootstrap-разовая-подготовка).

> Первый запуск невозможен без bootstrap: скрипт опирается на файлы состояния в
> `/var/lib/stroyfoto-deploy/` и без них останавливается с инструкцией.

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

### 4.0. Что делает `scripts/deploy.sh`

Штатный путь обновления. Под root на hub, к БД не подключается:

1. **Preflight** — root, наличие утилит, каталогов и юнита; общий `flock` с мигратором;
   проверка, что `origin` — именно `saztonov/StroyFoto`, ветка `main`, не detached HEAD,
   рабочее дерево чисто. Все git-команды — под `stroyfoto`.
2. **`git pull --ff-only origin main`.**
3. **Re-exec**, если обновился сам `scripts/deploy.sh` (bash дочитывает файл по ходу
   выполнения, иначе доработал бы старой версией).
4. **Гейт миграций** — если приехали новые файлы в `db/migrations/`, останавливается
   и печатает команды. Продолжить после применения: `--ack-migrations-applied`.
5. **Сборка обоих компонентов** до любой выкладки: `npm run build:front` и `tsc` в
   `server/dist.new.*`. Перед каждой проверяется свободное место — staged-выкладка
   временно держит две копии каталога, а диск на hub общий с соседними сайтами.
6. **Сначала бэкенд** — подмена `server/dist`, `systemctl restart stroyfoto-api`,
   health-check `/api/health` и `/api/db-health` с ретраями.
7. **Потом фронт** — сборка в `public.new.*`, проверка `index.html`+`assets`, `chown`,
   подмена каталога. Предыдущая версия становится `public.bak.<ts>`.

Порядок «API → фронт» намеренный: новый фронт при сломанном API хуже, чем обратное.
Из этого следует требование — **новый API должен быть совместим с предыдущим фронтом**
на время выкладки.

Состояние развёрнутого хранится в `/var/lib/stroyfoto-deploy/last-{api,front}-sha` и
пишется только после успеха шага. Именно поэтому повторный запуск после остановки на
миграциях корректно доводит деплой до конца.

### 4.1. Обновление фронтенда

Фронт — статика; сервис и nginx при этом не трогаются. PWA настроена на `autoUpdate`
(skipWaiting + clientsClaim) — открытые вкладки подхватят новую версию сами.

```bash
bash /opt/stroyfoto-api/scripts/deploy.sh --front-only
```

<details>
<summary>Аварийный ручной путь (если скрипт недоступен)</summary>

```bash
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only origin main
# ВАЖНО: build:front, а не build — обычный `npm run build` через корневые references
# собирает и server/, перезаписывая живой server/dist.
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run build:front'

ts=$(date +%F_%H-%M-%S)
rsync -a /opt/stroyfoto-api/dist/ "/srv/sites/stroyfoto.su10.ru/public.new.$ts/"
chown -R www-data:www-data "/srv/sites/stroyfoto.su10.ru/public.new.$ts"
mv /srv/sites/stroyfoto.su10.ru/public "/srv/sites/stroyfoto.su10.ru/public.bak.$ts"
mv "/srv/sites/stroyfoto.su10.ru/public.new.$ts" /srv/sites/stroyfoto.su10.ru/public
```

</details>

### 4.2. Обновление бэкенда

```bash
bash /opt/stroyfoto-api/scripts/deploy.sh --api-only
```

<details>
<summary>Аварийный ручной путь</summary>

```bash
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only origin main
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && npm ci && npm run server:build'
systemctl restart stroyfoto-api          # перезапускается ТОЛЬКО stroyfoto-api
curl -fsS http://127.0.0.1:4000/api/health    # {"ok":true,"service":"stroyfoto-api"}
```

</details>

Если меняли и фронт, и бэк — просто `deploy.sh` без флагов.

### 4.3. Изменения схемы БД (Yandex MDB)

🔴 **Опасная зона.** Перед любыми DDL — резервная копия (у Yandex MDB есть автобэкапы
в консоли; для точечной — `pg_dump`). Сначала прогоняй на тестовой БД, в прод — только
проверенное.

Схема ведётся миграциями в `db/migrations/` с журналом `public.schema_migrations`.
Правила именования, expand/contract и порядок для нетранзакционных DDL —
в [`db/migrations/README.md`](../db/migrations/README.md).

```bash
# 1. посмотреть, что применено и что ждёт (БД не изменяется)
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && \
  bash scripts/db/apply-migrations.sh --env-file server/.env --status'

# 2. применить (каждая миграция + запись в журнал — в одной транзакции)
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && \
  bash scripts/db/apply-migrations.sh --env-file server/.env'

# 3. затем выложить код
bash /opt/stroyfoto-api/scripts/deploy.sh --ack-migrations-applied
```

**Порядок всегда: миграции → код.** Для разрушающих изменений (drop/rename колонки)
одной миграции перед деплоем недостаточно — нужен expand/contract, иначе ещё работающий
старый API сломается в момент применения.

Свойства мигратора, на которые можно опираться:

- каждый файл применяется **ровно один раз** (журнал + `sha256`);
- правка применённого файла и пропажа файла с диска — ошибка, применение останавливается;
- падение миграции откатывает и её саму, и запись в журнал;
- `--status` / `--dry-run` не создают журнал и вообще ничего не пишут в БД;
- параллельный запуск отсекается `flock` (один сервер) и `pg_advisory_xact_lock`
  (между машинами) — двойного применения не будет, второй процесс упадёт с откатом.

`database/stroyfoto.schema.sql` (`npm run db:schema:pull`) — **информационный** снапшот.
Исполнять его нельзя: UNIQUE-constraint'ы дублируются одноимёнными `CREATE UNIQUE INDEX`,
а триггеры объявлены раньше функции. Роль начального состояния играет
`db/migrations/000000000000_baseline.sql`, снятый через `pg_dump --schema-only`.
После изменения схемы снапшот стоит обновить и закоммитить.

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

🔴 При откате возвращайте **и каталог, и файл состояния**. Если этого не сделать,
следующий `deploy.sh` решит, что новая версия уже развёрнута, и не станет её выкладывать.
Готовые команды с подставленными путями печатает сам `deploy.sh` в конце работы.

```bash
ls -d /srv/sites/stroyfoto.su10.ru/public.bak.*      # выбрать нужный
rm -rf /srv/sites/stroyfoto.su10.ru/public
mv /srv/sites/stroyfoto.su10.ru/public.bak.<ts> /srv/sites/stroyfoto.su10.ru/public
printf '%s\n' <sha-предыдущей-версии> > /var/lib/stroyfoto-deploy/last-front-sha
```

**Бэкенд** — вернуть предыдущую сборку (без пересборки, она уже лежит рядом):

```bash
ls -d /opt/stroyfoto-api/server/dist.bak.*
rm -rf /opt/stroyfoto-api/server/dist
mv /opt/stroyfoto-api/server/dist.bak.<ts> /opt/stroyfoto-api/server/dist
systemctl restart stroyfoto-api
printf '%s\n' <sha-предыдущей-версии> > /var/lib/stroyfoto-deploy/last-api-sha
journalctl -u stroyfoto-api -n 50 --no-pager
curl -fsS http://127.0.0.1:4000/api/health
```

**Откат самого кода** — `git revert` нужного коммита в репозитории и обычный деплой.
`git checkout <sha>` для этого **не используем**: он оставляет репозиторий в detached HEAD,
после чего preflight следующего деплоя откажется работать, а `git pull --ff-only` перестанет
обновлять ветку.

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

---

## 9. Bootstrap (разовая подготовка)

Выполняется **один раз**, до первого запуска `deploy.sh`. Порядок важен: SHA работающей
версии нужно зафиксировать **до** первого `git pull` — после него он уже не восстановим.

```bash
# --- под root на hub ---
install -d -o stroyfoto -g stroyfoto -m 0775 /var/lib/stroyfoto-deploy

# lock-файл создаём ЯВНО с нужным владельцем: каталога 0775 недостаточно — если root
# первым откроет lock, файл станет root:root 0644, и мигратор под stroyfoto не сможет
# открыть его на запись.
install -o stroyfoto -g stroyfoto -m 0664 /dev/null /var/lib/stroyfoto-deploy/operation.lock

# 1. Убедиться, что фронт и API СЕЙЧАС собраны из одного коммита. Если есть сомнения —
#    пересобрать оба вручную (раздел 4) из текущего HEAD. Затем запомнить его:
PREV_SHA=$(sudo -u stroyfoto git -C /opt/stroyfoto-api rev-parse HEAD); echo "$PREV_SHA"

# 2. Забрать код со скриптами и baseline
sudo -u stroyfoto git -C /opt/stroyfoto-api pull --ff-only origin main

# 3. Записать состояние сохранённым SHA (скрипт спросит подтверждение)
bash /opt/stroyfoto-api/scripts/deploy.sh --init-state "$PREV_SHA"

# 4. Отметить baseline применённым БЕЗ выполнения — структура на проде уже есть.
#    Эта же команда создаёт журнал schema_migrations.
sudo -u stroyfoto bash -lc 'cd /opt/stroyfoto-api && \
  bash scripts/db/apply-migrations.sh --env-file server/.env \
       --mark-applied 000000000000_baseline.sql'
```

Baseline снимается на dev-машине `pg_dump` версии **не ниже сервера** (Yandex MDB —
PostgreSQL 17) и обязательно **до** создания журнала, иначе `schema_migrations` попадёт
в слепок. Команда — в [`db/migrations/README.md`](../db/migrations/README.md).

### Откуда прод берёт код

`deploy.sh` требует, чтобы `origin` в `/opt/stroyfoto-api` был именно
`https://github.com/saztonov/StroyFoto.git` — это защита от случайного деплоя из чужого
форка. Поток работы: правки → форк разработчика → Pull Request → merge в `saztonov` →
`deploy.sh` на hub.

### Граница доверия

`deploy.sh` запускается **root'ом из репозитория, принадлежащего `stroyfoto`**. Значит
любой, кто может писать в этот репозиторий или в ветку `main` апстрима, исполняет код от
root на общем сервере. Это принято осознанно (репозиторий и так разворачивается этим же
root'ом). Если понадобится ужесточить — вынести root-часть в отдельный root-owned launcher
вне репозитория.
