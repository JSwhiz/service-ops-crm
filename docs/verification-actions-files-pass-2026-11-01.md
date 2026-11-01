# Проход действий и файлов — фактическая проверка

Контракт: [ACTIONS_FILES_PASS_2026-11-01.md](ui/ACTIONS_FILES_PASS_2026-11-01.md). Baseline `6d59afa5d09fd99d197e955073e677f1f27aaa8a`.

**Итог:** реализация текущего прохода завершена, перечисленные локальные сценарии приняты. Полная ролевая/устройственная R0-приёмка не закрыта. Итоговый раздел имеет приоритет над промежуточными статусами хронологического журнала ниже.

- [x] Текущая реализация сохранена отдельным коммитом; дерево чистое после snapshot.
- [x] A — таблица/общие действия.
- [x] B — файлы/preview, финальный small-XLSX LIVE и функциональный oversizedscan.
- [x] C — быстрый просмотр, реальные edit/section/focus переходы.
- [x] D — source inventory/точечные потребители и подтверждённые мобильные исправления.
- [x] E — независимая проверка/сборка.
- [x] Terra — одно финальное review, единственный P2 исправлен и адресно перепроверен E.
- [x] Итоговая browser/action matrix, ограничения записаны; не all-actions/all-roles certification.

Main — единственный browser operator. Previous screenshots/findings являются исходными дефектами, не доказательством исправления. Промежуточные failures ниже исправлены только там, где есть явно указанный повтор PASS.

## Финальный итог

- Сохранён отдельный checkpoint `6d59afa` до новых изменений; commit224files содержит предыдущие формы/тесты/доказательства. Новые изменения этого прохода после checkpoint НЕ закоммичены, не отправлены и не опубликованы.
- Выровнены строки разовых, вложенные действия отделены от row click; общий OverflowMenu учитывает clipping bounds. Toolbar на390 переносится, shared icon targets44×44 на mobile/touch; точечно исправлены approval action groups и task close icon.
- Quick preview перестроен с execution-first hierarchy, collapsible review/comment drafts, понятными payment conditions и настоящим edit entry. ТЗ/задачи ведут к отдельным фокусируемым anchors с видимыми заголовками ниже fixed header. Нет N+1-загрузок или выдуманных данных о полученных деньгах.
- Единая скрепка стала default legacy-consumers. Файлы показывают формат/размер вместо MIME. Local PDF.js6.4.299 рендерит PDF-представление Office без внешнего сервиса; zoom/fit, loading/error/retry/download, ограничения input/output/deadline и cancel. Backend/CSP/ACL/schema не изменены. Малый XLSX, TXT и JPG проверены MAIN; большой синтетический scan отдельно проверен реальным parser/pixel-render тестом.
- Финально E: **33/33 tests PASS; fullfrontend typecheck PASS; scopedESLint12files PASS; gitdiffcheck PASS**. Общий CSSaudit не объявлен PASS: unusedclasses в четырёх unchangedstylesheets. Блокирующих новых CSS/token ошибок нет.
- Production build **exit0**, **61route**, **50/50staticpages**, snapshot `/tmp/crm-actions-e-final.hvBIoc`, onecpu/988MiBheap perprocess. Localworker emitted1182501bytes. Все497source/config fingerprints совпали до/после; liveconfig/cache не менялись сборкой. [Лог](verification/actions-files-2026-11-01/e-build.log), [метаданные](verification/actions-files-2026-11-01/e-build-result.json), [обзор E](verification/actions-files-2026-11-01/e-review.md), [source inventory](verification/actions-files-2026-11-01/source-action-inventory.md).
- Terra high выполнила одно source-only review; единственный P2 о skippedbigimages исправлен и проверен E. Все исполнители/проверяющие завершены.
- При передаче frontendHTTP200/backendhealthok, авторизованный fileviewer открыт. Один обоснованный frontend restart был связан с pnpm dependency symlinks; backend/DB/прочие проекты не перезапускались. Новых uploads/records/денег/approval-решений/прав/складских операций не создавалось.
- **Не подтверждены:** realzoom200%, реальный touch/keyboard, вся ролевая/mutation матрица, все поддерживаемые/ошибочные форматы/сеть и абсолютный workerRSS-bound.23routes geometry и выборочные действия не означают проверку каждой кнопки в каждом состоянии. Это явные границы, а не скрытый PASS.

## Текущие подтверждения

- A завершил source/table foundation: 5 targeted tests, lint, typecheck PASS по агенту. MAIN LIVE1280: все видимые ячейки первых трёх строк имеют table-cell и одинаковую высоту внутри строки (86/68/68px); адрес больше не отделён от row borders. Раскрытие полного имени менеджера оставляет 0 dialogs и не открывает quick preview.
- C завершил панель: 3 targetedtests и scopedlint PASS, E подтвердил соответствие section/edit ссылок карточке, сохранение ACL и controlled drafts. LIVE новой панели ещё не принято.
- D source inventory сохранён отдельно; две исходные правки — approval actions wrap и task close icon. Это не подтверждение всех кнопок. MAIN/E нашли ещё toolbar-clipping при390 и touch target36px; D возобновлён на точные исправления.
- E первый независимый read-only проход A/C/D:8 testsPASS; два P2 выше переданы владельцу. B не включался, пока меняется.
- XLSX после первой попытки B по-прежнему показывал тёмный iframe. Предположение о CSP не считается установленной причиной; удаление sandbox не принято как решение и возвращено. Решено локальное PDF-отображение maintained pdfjs-dist без внешних сервисов, с исходной политикой безопасности. Зависимость/worker должны быть доступны в Linux runtime, не только host. До завершения B браузер показал module-not-found pdf.worker; эти промежуточные маршруты/снимки НЕ засчитаны как PASS. Сервис не перезапускался.
- Mobile screenshot inspection: visit plans/equipment/timesheet/counterparties/order list; отдельный header badge scrollWidth не трактуется как текстовое clipping. Реальный zoom200% средствами текущего IAB не установлен и не засчитывается.

## LIVE после адресных исправлений

- D при390: toolbar links реально перенесены: CatalogTZ x70–173, Calendar x181–305, Create на следующей строке x70–219. Все в доступной ширине; document390. Header icon buttons measured44×44; profile/search/create/notifications доступны без взаимного перекрытия. Снимок `orders-toolbar-fixed-390.png`.
- C: новая иерархия подтверждена DOM: Заказ → Выполнение → Быстрое действие → Комментарии → Условия оплаты → Отзыв. Последние материалы не выдумываются, только корректный переход в разрешённый media section. Отзыв раскрывается/сворачивается без потери тестового текста; текст затем очищен без POST. Edit link реально открывает existing form (edit=1, canEditOperationalFields).
- C: переход ТЗ сначала помещал heading под fixed header; исправлено scoped scroll-margin. Повтор MAIN: focus=`one-time-order-specification`, top79.89 при header64, heading видим. Tasks link при390 фокусирует `one-time-order-tasks`, target целиком в viewport; query section execution сохранён. Screenshots anchors приложены.
- Общий image viewer: qa-photo04 → оригинал1:1 → fit → следующий qa-photo01; 2из8 и реальная картинка. Shift+F10 на миниатюре открывает то же меню; rect x81–313/y675–757 внутри1280×844. Escape удаляет меню и возвращает focus на его trigger. Файлы/связи не менялись.
- TXT canonical route показывает исходный синтетический текст и короткий TXT/size, download icon доступен. Новых файлов/записей в этом проходе не создавалось.
- Один justified restart только frontend после изменения pnpm symlinks: оба missing loader/pdfworker файла уже проверены существующими внутри контейнера, старый Next resolver оставался stale. Backend/DB не перезапускались. После restart UI и сессия восстановились.
- Изолированные промежуточные ошибки loader/worker и четыре mobile captures с0buttons не засчитываются. Геометрическая матрица содержит исходные и итоговые замеры; не является all-actions/mutations PASS. Принимаются только наблюдения на загруженном UI.
- XLSX первая pdfjs-реализация реально показывала таблицу; после дополнительных cleanup/limit правок последняя проверка directroute выявила render error. B возобновлён; прежний успешный снимок не закрывает текущий дефект.

## Финальный LIVE файлов и навигации

- B установил конкретную причину render-регрессии: оставшаяся ссылка `page.getViewport()` после rename в `pageProxy`. Исправлено;4 функциональных теста проходят, old-error mutation в памяти ломает тест. MAIN после fix: прямой XLSX route реально показывает таблицу, увеличение125%, возврат «По ширине» и reload PASS. Фотография успешного документа — `xlsx-reload-final-1280.png`, zoom — `xlsx-zoom-final-1280.png`. Это предпросмотр сохранённого PDF-представления Office, не редактирование workbook и не гарантия всех листов/форматов.
- Новый PDF viewer использует local bundled worker pdfjs-dist6.4.299, не сторонний сервис. Исходная серверная CSP сохранена; backend diff отсутствует. B добавил ограничение decoded images16MP/32MiB resize budget, outputcanvas cap, postimport cancellation/pagecleanup. Source/security проверяют E/Terra; MAIN не проверял стресс огромным/повреждённым PDF.
- MAIN390: файловое меню целиком x106–338/y680–778, скрепка x83–307/y666–808; все действия видимы. Скрепка единая и в ранее legacy объектных материалах. Escape закрывает вложенное меню. Photo/PDF/TXT downloads остаются иконками с accessible label; скачивание XLSX оригинала подтверждено предыдущим аудитом (не повторялось в этом проходе).
- Подтверждение переходов C после tiny scopedmargin: ТЗ focus+top80 нижеheader, задачи focus+visibleпри390. Порядок исполнения выше review/payment подтверждён и на390, и наdesktop; finalquickpreview screenshots сохранены.
- Геометрическая матрица охватывает23 разных маршрута, несколько повторов и размеров. Это проверка загруженных экранов и выборочных действий, а не всех операций всех ролей. Approvals request opened read-only, решение не принималось. Settings честно unavailable state. Backend/DB/права/деньги/склад/рабочие записи не менялись.

## Остающиеся границы приёмки

- Реальный browser zoom200%, touch device/экранная клавиатура, полная ролевая матрица и выполнение каждой mutation не подтверждены.
- Из файлов LIVE подтверждены существующие JPG, TXT и XLSX через PDF-представление; отдельные DOCX/unsupported403/404/многостраничный стресс в браузере не выполнялись. Новые uploads не делались.
- До получения финальных E/Terra результатов пакет не объявлять принятым. Новые изменения после checkpoint не закоммичены и не опубликованы.

## Одно финальное ревью Terra

Terra/gpt-6.1-terra high выполнила source-only review и нашла один P2: PDF.js `maxImageSize16MP` может молча удалить слишком большой embedded scan и вернуть страницу как успешную. Само наличие memory limit не оправдывает пустую/неполную страницу без предупреждения. B возобновлён на supported bounded rendering либо надёжное явное failure/download; E проверяет механизм и повторяет финальные проверки на новом состоянии. Дополнительный полный Terra-аудит не запускается. Browser стресс oversizedscan не выполнен, поэтому требуется функциональное доказательство этого условия.

E воспроизвёл этот P2 offline-синтетическим PDF с grayscale изображением4001×4000; stopAtErrors не считается исправлением без доказанного сигнала. До finalfix:28/28 integrated targetedtests PASS, fulltypecheck PASS, scoped ESLint12filesPASS, fingerprintsunchanged. Fullfrontend lint не объявляется PASS: CSSaudit сообщает unusedclasses четырёх неизменённыхstylesheets. Первая изолированная build-copy попытка не принята из-за macOS `._*.tsx` metadata в staging, не из-за исходного кода; следующая должна исключить metadata. Эти промежуточные результаты не заменяют финальную сборку.

### Исправление единственного замечания Terra

B применил supported resize, отключив silently-dropping `maxImageSize` (`-1`); сохранены resize threshold32MiB, outputcanvas16MP, streamedinput25MiB,45s deadlines, abort и явный download fallback для неподдерживаемого окружения. Resize threshold НЕ является жёстким потолком памяти worker. В pinned PDF.js6.4.299 нет опции isEvalSupported; не добавлялась выдуманная настройка. Backend/CSP без изменений.

B9/9functional tests включают настоящий PDF.js rendering искусственного scan4001×4000: image paint operators сохраняются, scan pixels присутствуют, output bounded. Это не общее stress/security certification. E выполняет независимую адресную сверку и финальные проверки.

MAIN на окончательном frozen B: реальный исходный XLSX снова отображён,125%zoom/fitPASS, без rendererror; снимок `xlsx-accepted-final-1280.png`. Не используется прежний снимок вместо повторной проверки. Browser viewport reset, проверенный file route оставлен доступным пользователю.

### Финальные проверки перед сборкой

E:33/33 targeted tests PASS; fullfrontend typecheck PASS; scopedESLint12changed/newTS/TSXfilesPASS. Независимый offlineprobe PDF.js6.4.299 подтвердил `paintImageXObject` и чёрный pixel scan4001×4000 в canvas200×200 с maxImageSize-1. Доказательство — [e-pdf-fixture-result.json](verification/actions-files-2026-11-01/e-pdf-fixture-result.json); оно не подменяет browserOffscreenCanvas стресс или RSS-bound. Логи/fingerprints — `e-checks-result.json` и соответствующие `.log`. Финальная production-сборка ожидается; исходники заморожены, main меняет только документы.
