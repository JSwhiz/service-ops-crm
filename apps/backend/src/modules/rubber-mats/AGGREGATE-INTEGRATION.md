# Parent integration contract (req 13, 42, OQ-146)

Status 2026-10-26: integrated locally in migration `20261026100000_remaining_operations`; conversion, decimal totals, revisions, ACL and compatibility/410 tests pass. The following is the integration contract for future maintenance, not a pending request to create the schema again.

Parent owns Prisma schema and migration. Add these scalar models (no reverse relations needed); SQL must add foreign keys with ON DELETE RESTRICT for sizeId, objectId and non-null actorUserId to existing Size/Object/User rows.

```prisma
model RubberMatSize {
  id String @id @default(uuid())
  lengthCm Decimal @db.Decimal(10, 2)
  widthCm Decimal @db.Decimal(10, 2)
  replacementCost Decimal? @db.Decimal(14, 2)
  version Int @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([lengthCm, widthCm])
}
model RubberMatSizeChange {
  id String @id @default(uuid())
  sizeId String
  version Int
  beforeCost Decimal? @db.Decimal(14, 2)
  afterCost Decimal? @db.Decimal(14, 2)
  actorUserId String?
  source String @default("user")
  occurredAt DateTime @default(now())
  @@unique([sizeId, version])
}
model ObjectRubberMatQuantity {
  objectId String
  sizeId String
  quantity Int
  version Int @default(1)
  updatedAt DateTime @updatedAt
  @@id([objectId, sizeId])
}
model ObjectRubberMatQuantityChange {
  id String @id @default(uuid())
  objectId String
  sizeId String
  version Int
  beforeQuantity Int
  afterQuantity Int
  replacementCostSnapshot Decimal? @db.Decimal(14, 2)
  actorUserId String?
  source String @default("user")
  occurredAt DateTime @default(now())
  @@unique([objectId, sizeId, version])
}
model RubberMatAggregateMigration {
  id String @id
  completedAt DateTime @default(now())
}
```

Add CHECKs: dimensions > 0; cost NULL or >= 0; quantity >= 0; versions > 0. Dimensions identify size (length,width), intentionally ignoring legacy thickness/zone/condition. Preserve orientation rather than assuming 80x120 equals 120x80.

After table creation run the following within the migration transaction. The marker and table lock make replay safe, and the API refuses aggregate operations before the marker exists. Legacy mutation endpoints become explicitly 410 unconditionally on deployment; deploy with maintenance/write exclusion until SQL completes. Do not modify/delete any RubberMat or RubberMatEvent rows.

```sql
LOCK TABLE "rubber_mats" IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "RubberMatAggregateMigration" WHERE id = 'legacy-v1') THEN
  INSERT INTO "RubberMatSize" (id, "lengthCm", "widthCm", "replacementCost", version, "createdAt", "updatedAt")
  SELECT 'legacy-size-' || md5("lengthCm"::text || ':' || "widthCm"::text), "lengthCm", "widthCm", NULL, 1, NOW(), NOW()
  FROM "rubber_mats" GROUP BY "lengthCm", "widthCm"
  ON CONFLICT ("lengthCm", "widthCm") DO NOTHING;
  INSERT INTO "RubberMatSizeChange" (id, "sizeId", version, "beforeCost", "afterCost", "actorUserId", source, "occurredAt")
  SELECT 'legacy-size-change-' || s.id, s.id, 1, NULL, s."replacementCost", NULL, 'legacy_migration', NOW()
  FROM "RubberMatSize" s ON CONFLICT ("sizeId", version) DO NOTHING;
  INSERT INTO "ObjectRubberMatQuantity" ("objectId", "sizeId", quantity, version, "updatedAt")
  SELECT m."objectId", s.id, COUNT(*)::int, 1, NOW()
  FROM "rubber_mats" m JOIN "RubberMatSize" s ON s."lengthCm"=m."lengthCm" AND s."widthCm"=m."widthCm"
  WHERE m."objectId" IS NOT NULL AND m.condition <> 'retired'
  GROUP BY m."objectId", s.id
  ON CONFLICT ("objectId", "sizeId") DO NOTHING;
  INSERT INTO "ObjectRubberMatQuantityChange" (id, "objectId", "sizeId", version, "beforeQuantity", "afterQuantity", "replacementCostSnapshot", "actorUserId", source, "occurredAt")
  SELECT 'legacy-quantity-' || md5(q."objectId" || ':' || q."sizeId"), q."objectId", q."sizeId", q.version, 0, q.quantity, s."replacementCost", NULL, 'legacy_migration', NOW()
  FROM "ObjectRubberMatQuantity" q JOIN "RubberMatSize" s ON s.id=q."sizeId"
  ON CONFLICT ("objectId", "sizeId", version) DO NOTHING;
  INSERT INTO "RubberMatAggregateMigration" (id) VALUES ('legacy-v1');
 END IF;
END $$;
```

No sizes/prices in seed. Null means explicit cost input is pending; zero only means an explicitly entered zero. Migration source has no invented actor; user edits record authenticated actor and server time. History stores costs at quantity-change time; current totals use current catalog costs, never rewrite historical snapshots.

Object page: keep ObjectRubberMatsPanel({objectId}) and #rubber-mats anchor. It fetches server canManage and aggregate data itself; no objects.service integration needed. Any parent summaries must use GET /objects/:objectId/rubber-mats/aggregate totalReplacementCost (decimal string or null) and knownReplacementCost; never count legacy RubberMat rows as current totals. Existing GET legacy lists/history are compatibility-only. POST/PATCH legacy mutations return 410.

Aggregate endpoints: GET /rubber-mats/catalog; POST /rubber-mats/catalog; PATCH /rubber-mats/catalog/:sizeId; GET /rubber-mats/catalog/:sizeId/history; GET /objects/:objectId/rubber-mats/aggregate; PUT /objects/:objectId/rubber-mats/aggregate/:sizeId; GET /objects/:objectId/rubber-mats/aggregate/history. Quantity first write expects version 0, subsequent writes returned version; catalog update requires version. Conflicts return 409.
