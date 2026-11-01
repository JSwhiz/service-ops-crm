# Действия, таблицы, быстрый просмотр и файлы — утверждённый проход

## Основание и контрольная точка

Пользователь 01.11.2026 утвердил реализацию и состав агентов. Перед любыми изменениями создан коммит `6d59afa5d09fd99d197e955073e677f1f27aaa8a` — `feat(ui): migrate creation forms to contextual dialogs`; после него дерево чистое. Это код/документация, не бэкап БД или файлов. Предыдущая точка до форм `051fccc` сохранена. Push/deploy не разрешены этим проходом.

В checkpoint зафиксированы четыре существующие лишние пустые строки EOF: object-create-dialog, one-time-order-create-dialog, create-draft-provider, form-dialog. Предварительный unstaged diff check их не видел; staged check выявил. Контрольная точка сохранена без изменения поведения. Новый проход проверяется относительно этого HEAD.

## Объём

1. Таблица разовых: сохранить table-cell, обрезание адреса внутри элемента; цельные границы/фон строки; вложенные кнопки не открывают строку одновременно.
2. Общие действия: основные создать/сохранить/завершить с текстом; редактирование/скачивание/закрытие — существующие иконки там, где однозначно; опасные действия в понятном меню. Не смешивать удаление файла, отвязку и архив.
3. Меню: границы viewport и scroll-контейнера, flip/clamp/scroll, keyboard/Escape/return focus; включая вложенные overlays. Не заменять каждый контрол новым набором компонентов.
4. Быстрый просмотр заказа: identity/status/dates/warnings → address/contact → managers/object → execution/tasks and direct section links → recent permitted materials/comments → compact payment conditions. Отзыв раскрывается отдельно. Edit must really activate editing. Financial completion stays full-card.
5. Файлы: установить причину blank XLSX; устойчивые loading/error/unsupported states и download original; короткий формат/size без raw MIME; единая скрепка в оставшихся редакторах. Не отправлять файлы внешним сервисам. Сохранить ACL/links/аудит и staged report removals.
6. Сквозной аудит потребителей: objects, counterparties, orders, tasks, employees, candidates, inventory, equipment, mats, timesheet, calendars, approvals, accountability, chats, settings, dashboard, visit plans, substitutions. Отмечать фактически проверенные actions/paths, не обещать all-buttons pass по source grep.

## Организация

Main — решения, docs, browser/integration. A Luna high — common actions/table; B Luna high — files; затем C Luna medium — order preview, D Luna medium — other consumers (последовательное переиспользование workers). E Luna high независим от авторов. Terra high одно финальное read-only review. Максимум2 активных agents, один владелец файла. Heavy checks последовательно; сервисы без причины не перезапускать.

## Приёмка

Matrix entries include screen/action, style/location, result, pending/error/permissions, nested click, keyboard/return focus, viewport and evidence. Desktop1280/1440, medium1024/768, mobile390; реальный zoom200% отдельно, не подменять resize. File image/PDF/TXT/XLSX/DOCX/unsupported and403/404 checked only where безопасные fixtures доступны. Указать unavailable вместо выдуманного PASS. No working mutations/rights/money/deletion during read-only tests. User synthetic attachment approval from prior pass not blanket new uploads.

## Статус

Checkpoint выполнен. A/B/C/D реализованы; E проверки33tests/typecheck/scopedlint и isolatedproductionbuild PASS; одно Terrareview завершено, P2 исправлен. MAIN подтвердил перечисленные LIVE-сценарии. Полная R0/allroles/realtouch/zoom200% остаётся открытой, не подменяется геометрической матрицей. Новые изменения после checkpoint не закоммичены/не опубликованы. Журнал: `docs/verification-actions-files-pass-2026-11-01.md`.
