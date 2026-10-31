BEGIN;

CREATE TABLE "one_time_order_specification_catalog_items" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "one_time_order_specification_catalog_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "one_time_order_specification_catalog_items_isArchived_sortOrder_title_idx"
  ON "one_time_order_specification_catalog_items"("isArchived", "sortOrder", "title");

CREATE TABLE "one_time_order_specification_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "one_time_order_specification_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "one_time_order_specification_templates_name_key"
  ON "one_time_order_specification_templates"("name");
CREATE INDEX "one_time_order_specification_templates_isArchived_name_idx"
  ON "one_time_order_specification_templates"("isArchived", "name");

CREATE TABLE "one_time_order_specification_template_items" (
  "templateId" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "one_time_order_specification_template_items_pkey" PRIMARY KEY ("templateId", "catalogItemId"),
  CONSTRAINT "one_time_order_specification_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "one_time_order_specification_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "one_time_order_specification_template_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "one_time_order_specification_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "one_time_order_specification_template_items_catalogItemId_idx"
  ON "one_time_order_specification_template_items"("catalogItemId");

WITH source(template_code, ordinal, title) AS (VALUES
  ('wet', 1, 'Пылесос, мытье пола и плинтусов (без перемещения тяжелой мебели)'),
  ('wet', 2, 'Влажная протирка подоконников'),
  ('wet', 3, 'Влажная протирка батарей'),
  ('wet', 4, 'Протирка свободных горизонтальных поверхностей'),
  ('wet', 5, 'Протирка от пыли шкафов сверху (если есть зазор между потолком и мебелью)'),
  ('wet', 6, 'Протирка полок в шкафах - если они пустые'),
  ('wet', 7, 'Удаление локальных загрязнений на стенах и дверях, дверных ручках'),
  ('wet', 8, 'Мытьё зеркал'),
  ('wet', 9, 'Протирка от пыли осветительных приборов (если простые плафоны, без разбора)'),
  ('wet', 10, 'Мытьё плитки на стенах и полу в санузле и ванной'),
  ('wet', 11, 'Чистка сантехники, хромированных элементов, протирка свободных поверхностей'),
  ('wet', 12, 'Мытьё фартука на кухне и наружных фасадов шкафчиков'),
  ('wet', 13, 'Мытье раковины на кухне'),
  ('wet', 14, 'Мытье техники снаружи'),
  ('wet', 15, 'Удаление локальных загрязнений на стенах (если позволяет покрытие)'),
  ('wet', 16, 'Сбор и вынос легкого мусора (до 2-3 пакетов)'),
  ('wet', 17, 'Мытье окон'),
  ('wet', 18, 'Мытье остекления балкона'),
  ('wet', 19, 'Химчистка мебели'),
  ('wet', 20, 'Мытье кухонной техники внутри'),
  ('wet', 21, 'Мытьё кухонного гарнитура внутри'),
  ('wet', 22, 'Мойка потолка'),
  ('wet', 23, 'Удаление плёнки с оконных рам'),
  ('dust', 1, 'Обеспыливание пола (пылесос, мытье пола и плинтусов)'),
  ('dust', 2, 'Обеспыливание батарей'),
  ('dust', 3, 'Обеспыливание свободных горизонтальных поверхностей'),
  ('dust', 4, 'Обеспыливание стен, дверей, дверных ручек'),
  ('dust', 5, 'Мытьё зеркал'),
  ('dust', 6, 'Обеспыливание осветительных приборов (если простые плафоны, без разбора)'),
  ('dust', 7, 'Обеспыливание сантехники, хромированных элементов'),
  ('dust', 8, 'Мытьё плитки на стенах и полу в санузле'),
  ('dust', 9, 'Обеспыливание стен'),
  ('dust', 10, 'Обеспыливание потолка'),
  ('dust', 11, 'Сбор и вынос легкого мусора (до 2-3 пакетов)'),
  ('dust', 12, 'Мытье окон'),
  ('dust', 13, 'Мытье остекления балкона'),
  ('dust', 14, 'Химчистка мебели'),
  ('dust', 15, 'Удаление плёнки с оконных рам')
)
INSERT INTO "one_time_order_specification_catalog_items"
  ("id", "title", "isArchived", "sortOrder", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
SELECT md5('one-time-specification-catalog-item:' || template_code || ':' || ordinal), title, false, ordinal,
       NULL, NULL, NOW(), NOW()
FROM source
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "one_time_order_specification_templates"
  ("id", "name", "isArchived", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
SELECT md5('one-time-specification-template:wet'), 'Влажная уборка', false, NULL, NULL, NOW(), NOW()
FROM (SELECT 1) seed
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "one_time_order_specification_templates"
  ("id", "name", "isArchived", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
SELECT md5('one-time-specification-template:dust'), 'Обеспыливание', false, NULL, NULL, NOW(), NOW()
FROM (SELECT 1) seed
ON CONFLICT ("id") DO NOTHING;

WITH source(template_code, ordinal) AS (VALUES
  ('wet', 1), ('wet', 2), ('wet', 3), ('wet', 4), ('wet', 5), ('wet', 6), ('wet', 7), ('wet', 8),
  ('wet', 9), ('wet', 10), ('wet', 11), ('wet', 12), ('wet', 13), ('wet', 14), ('wet', 15), ('wet', 16),
  ('wet', 17), ('wet', 18), ('wet', 19), ('wet', 20), ('wet', 21), ('wet', 22), ('wet', 23),
  ('dust', 1), ('dust', 2), ('dust', 3), ('dust', 4), ('dust', 5), ('dust', 6), ('dust', 7), ('dust', 8),
  ('dust', 9), ('dust', 10), ('dust', 11), ('dust', 12), ('dust', 13), ('dust', 14), ('dust', 15)
)
INSERT INTO "one_time_order_specification_template_items" ("templateId", "catalogItemId", "sortOrder")
SELECT md5('one-time-specification-template:' || template_code),
       md5('one-time-specification-catalog-item:' || template_code || ':' || ordinal), ordinal
FROM source
ON CONFLICT ("templateId", "catalogItemId") DO NOTHING;

COMMIT;
