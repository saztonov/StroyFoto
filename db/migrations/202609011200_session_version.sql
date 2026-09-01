-- Поколение сессий: session_version в app_users и refresh_tokens.
--
-- Зачем. Access-токен — stateless JWT, и authenticate проверяет только подпись
-- и существование пользователя. Поэтому после смены или сброса пароля отзыв
-- refresh-токенов ничего не даёт ещё до 15 минут (ACCESS_TOKEN_TTL): чужая
-- вкладка продолжает работать по уже выданному JWT. Обещание «сессии на других
-- устройствах завершены» без этой колонки было бы неправдой.
--
-- Как. Смена и сброс пароля инкрементируют app_users.session_version. JWT несёт
-- claim sv, authenticate сравнивает его с текущим значением и отвергает
-- расхождение. Проверка бесплатна: loadUser и так ходит в БД за ролью.
--
-- refresh_tokens.session_version — второй эшелон. При корректной сериализации
-- выпуска токенов строки со старой версией появиться не должно, но если она
-- всё же возникнет в гонке, refresh по ней живой сессии не даст.
--
-- Совместимость на выкладке. Миграции применяются ДО деплоя кода: в этом окне
-- старый код выпускает JWT без claim sv, а колонка уже равна 0. Новый
-- authenticate трактует отсутствующий sv как 0, поэтому массового разлогина
-- при деплое не будет. DEFAULT 0 выбран именно ради этого.
--
-- BEGIN/COMMIT не нужны: транзакцией управляет psql --single-transaction.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.app_users
  ADD COLUMN session_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.app_users.session_version IS
  'Поколение сессий. Инкрементируется при смене и сбросе пароля. Access-JWT '
  'несёт claim sv; authenticate отвергает токен при несовпадении, иначе чужая '
  'вкладка жила бы ещё до ACCESS_TOKEN_TTL после «завершения всех сессий».';

ALTER TABLE public.refresh_tokens
  ADD COLUMN session_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.refresh_tokens.session_version IS
  'Версия поколения на момент выпуска токена. refresh отвергает строку, если '
  'значение отстало от app_users.session_version.';
