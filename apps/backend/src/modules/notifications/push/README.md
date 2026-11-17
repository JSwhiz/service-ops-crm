# Web push — локальная реализация пункта 6

База задачи `f4fa23a`. Реализация и адресные проверки завершены локально.
Новое решение пользователя: в готовящемся серверном выпуске Web Push включить,
чтобы затем принять доставку на реальных iPhone и Android. Подготовка выпуска
сама по себе не означает применение конфигурации или публикацию на сервере.
Порядок выпуска: `docs/release-preparation-2026-11-18.md`.

## Поток

Настройки `/settings/notifications` доступны через меню профиля аутентифицированного User.
Страница заранее регистрирует `/push-worker.js` без запроса разрешения и без подписки.
`pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` вызывается прямо
из ручного нажатия, до любого await. Подписка отправляется в `/api/v1/auth/push/subscriptions`:
существующий refresh-cookie ограничен `/api/v1/auth`, его область не расширяется.
Мутагирующие endpoints требуют настроенный CRM Origin; JWT и актуальная активность User обязательны.

Подписка принадлежит User и конкретной цепочке ротации AuthSession. Знание endpoint
не переносит её другому User. Reconnect выполняется явно; прежние pending delivery пропускаются.
Disconnect своего устройства доступен после запрета notifications.read/realtime (пока auth.access разрешён),
гасит очередь и локальную браузерную подписку; настройка других устройств не затрагивается.
Секреты endpoint/p256dh/auth не выдаются в списки и не логируются. Сервис поддерживает
public HTTPS endpoint Apple/FCM/Mozilla, не произвольный URL для серверного HTTP.

В транзакции создания Notification добавляется отдельный enqueue. Realtime outbox/Redis,
NotificationBell и старый browser Notification flow не переписаны. Нет backfill старых
уведомлений при подключении устройства или снятии запрета. Уникальность пары subscription/notification
сохраняет один queue record на событие; explicit test имеет notificationId=null и лимит 1/минуту.

Worker забирает ограниченные batches с SKIP LOCKED/lease/token. Перед каждой отправкой
повторно проверяет consent/device, VAPID epoch, активность User/auth.access, notifications.read/realtime,
цепочку AuthSession и существующую положительную видимость источника через notificationAccessWhere.
Актор и терминальный refresh-сеанс упорядочены SHARE-lock относительно revoke/logout;
запрет/исчезновение источника, dismiss/read, disconnect и завершённый login не доставляются.
HTTP 404/410 отключает endpoint и гасит pending; временные ошибки имеют максимум 5 попыток,
bounded backoff и срок очереди 24ч. Provider TTL=60с, timeout=8с.

Push payload содержит только opaque deliveryId. Service worker игнорирует входящие title/body/URL,
всегда показывает собственный общий текст, не хранит карточки и не перехватывает fetch.
Нажатие открывает новый tab `/settings/notifications?delivery=UUID`, сохраняя draft прежней вкладки.
Серверный resolver проверяет текущего получателя/источник и версию доступа; frontend дополнительно
пропускает только существующий getSafeLocalTarget. Карточка затем проходит обычную API-проверку.
Уже принятое push-службой сообщение нельзя отозвать с телефона после revoke; оно остаётся общим.

Внешняя сеть не даёт exactly-once: crash/неопределённый ответ после приёма провайдером может повториться.
Стабильные provider topic и notification tag заменяют видимый повтор того же delivery.
Статус sent означает приём push-службой, не подтверждённое получение телефоном.
Настройки показывают безопасный результат последней ручной проверки и человеческие ошибки;
новый тест/переподключение запускаются только пользователем.

## Конфигурация

Локальный пример `.env.example` оставляет WEB_PUSH_ENABLED=false. Серверный
`.env.production.example` включает true и требует действительную VAPID-пару.
Одноразовая подготовка: `node scripts/prepare-web-push-env.mjs https://<домен> /private/path/push.env`.
Скрипт не перезаписывает существующие ключи и не меняет рабочую конфигурацию.
На уже настроенном сервере сохранять существующую действительную пару.
Проверка собранного backend с реальным production env: `node scripts/check-web-push-release.mjs`.
Private key — только backend.
Некорректная/несогласованная VAPID-пара оставляет функцию выключенной, не открывает отправку.
Секреты не записаны в исходники или доказательства. Отдельных NEXT_PUBLIC private-переменных нет.

Для реального устройства нужны разрешённый HTTPS origin, действительная VAPID-пара и явное
подключение владельцем устройства. iPhone/iPad: iOS/iPadOS >=16.4, установка на экран «Домой»,
запуск с иконки и нажатие «Подключить уведомления». Android: поддерживаемый актуальный браузер,
HTTPS и разрешение; установка иконки предлагается отдельно. Учтены secure context, отсутствие API,
permission denied, ожидание worker с timeout, pending/error и ручное отключение.

## Ограниченная проверка

Из apps/backend:
`node -r ts-node/register --test --test-concurrency=1 test/web-push.test.ts`

Main уже выполнил прежние 11 unit cases: PASS, не повторять ради отчёта. До получения сообщения
про запрет повторов был начат author run с добавленным Origin case: завершён 12/12.
Последующая backend status/deeplink/UI доработка не помечается новым прогоном старых 11.

Из apps/frontend:
`node --experimental-strip-types --test src/features/push-notifications/model/push-support.test.mjs src/features/push-notifications/model/push-worker.test.mjs`

Первые support/worker 7/7 PASS. Новый status-only case отдельно PASS, старые 7 не повторены:
`node --experimental-strip-types --test --test-name-pattern="delivery status" src/features/push-notifications/model/push-support.test.mjs`

Один новый API/DB тест подготовлен для последовательного запуска Main (НЕ автором пока chat queue занят):
из корня `pnpm --filter backend test:integration test/web-push.integration.test.ts`.
Он требует TEST_ISOLATED_DATABASE, local integration_<pid>_<n> schema через штатный runner.
Transport provider заменён fixture: публичного HTTP/реальной подписки телефона нет.
Прочие preview/realtime timers в TestingModule остановлены; настоящий push.enqueue/worker
и Auth/JWT/Origin/Notification/source transaction path остаются рабочими.
Проверяются owner/foreign/Origin/config, dedupe, queue+send, deny source+fresh deep link,
no replay on regrant, manual test rate limit, logout и disconnect. Chrome не требуется.

Снимки реально загруженных локальных настроек сняты, интеграционный API/DB сценарий прошёл;
подробности в `docs/product/customer-workflows-verification-2026-11-17.md`.
Снимок настроек, unit/mock transport или macOS не являются приёмкой доставки на телефон.
Физического iPhone/Android в этой среде нет. Реальная фоновая мобильная доставка НЕ подтверждена.

## Проверенные первичные источники

- [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers): gesture, Home Screen iOS16.4, немедленный visible notification, VAPID/TLS.
- [MDN subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe): secure context, userVisibleOnly, applicationServerKey, user gesture.
- [MDN push event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event): service-worker event/waitUntil.
- [Next manifest](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest): manifest.ts и автоматически подключаемые metadata.
- [web-push library](https://github.com/web-push-libs/web-push): encrypted aes128gcm, per-request VAPID, TTL/timeout/topic и ответы provider.
