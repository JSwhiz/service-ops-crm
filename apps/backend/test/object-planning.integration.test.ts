import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { ObjectPlanningService } from "../src/modules/objects/object-planning.service";
import {
  annualSeason,
  moscowMonthWindow,
  validAnnualDate,
} from "../src/modules/objects/utils/object-season.util";
import { loginAndGetCookieHeader } from "./helpers/auth";
import { createTestApp } from "./helpers/create-test-app";

test(
  "roadmap: candidate access, object contacts, monthly budget and annual seasons",
  { timeout: 120_000 },
  async (t) => {
    assert.equal(process.env.TEST_ISOLATED_DATABASE, "true");
    const prisma = new PrismaClient();
    const { app, baseUrl } = await createTestApp();
    t.after(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    const planner = app.get(ObjectPlanningService);
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    for (const [login, password] of [
      ["founder", "founder123"],
      ["hr1", "hr123"],
      ["manager1", "manager123"],
      ["manager2", "manager123"],
      ["stepanova", "stepanova123"],
      ["nikitina", "nikitina123"],
    ] as const) {
      cookies.set(
        login,
        await loginAndGetCookieHeader({ baseUrl, login, password }),
      );
      ids.set(
        login,
        (await prisma.user.findUniqueOrThrow({ where: { login } })).id,
      );
    }
    const object = await prisma.object.create({
      data: {
        name: "Проверка бюджета и сезонов",
        address: "Изолированный тест",
        status: "active",
        createdByUserId: ids.get("founder")!,
        dailyRate: 1000,
        summerDailyRate: 1200,
        winterDailyRate: 2000,
        baseCompensationProfile: {
          paymentType: "daily",
          dailyRate: 1000,
          monthlySalary: 0,
          paymentScheduleCode: null,
          paymentScheduleWeekdays: [],
          paymentScheduleCycleStartDate: null,
        },
        assignments: {
          create: {
            userId: ids.get("manager1")!,
            assignmentRoleCode: "manager",
          },
        },
      },
    });
    await prisma.objectAssignment.create({
      data: {
        objectId: object.id,
        userId: ids.get("founder")!,
        assignmentRoleCode: "responsible",
      },
    });
    const request = (
      login: string,
      path: string,
      method = "GET",
      body?: unknown,
    ) =>
      fetch(`${baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Cookie: cookies.get(login)!,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async <T>(response: Response, status = 200): Promise<T> => {
      const body = await response.text();
      assert.equal(response.status, status, body);
      return JSON.parse(body) as T;
    };
    const root = `/objects/${object.id}`;

    await t.test(
      "all-candidate access is explicit in the registry and denied accounts have no read or mutation paths",
      async () => {
        const candidate = await json<{ id: string; fullName: string }>(
          await request("hr1", "/candidates", "POST", {
            fullName: "Roadmap visibility candidate",
            phone: "+79991112233",
            candidateType: "reserve",
          }),
          201,
        );
        const mine = await json<{ items: { id: string }[] }>(
          await request("manager1", `/candidates?q=${candidate.fullName}`),
        );
        assert.equal(
          mine.items.some((row) => row.id === candidate.id),
          false,
        );
        const all = await json<{ items: { id: string }[] }>(
          await request(
            "manager1",
            `/candidates?scope=all&q=${candidate.fullName}`,
          ),
        );
        assert.equal(
          all.items.some((row) => row.id === candidate.id),
          true,
        );
        assert.equal(
          (await request("manager1", `/candidates/${candidate.id}`)).status,
          200,
        );
        assert.equal(
          (
            await request(
              "manager1",
              `/candidates/${candidate.id}/responses`,
              "POST",
              { text: "Чужое назначение не даёт права отвечать" },
            )
          ).status,
          403,
        );
        for (const login of ["stepanova", "nikitina"]) {
          for (const [path, method, body] of [
            [`/candidates?scope=all`, "GET", undefined],
            [`/candidates/${candidate.id}`, "GET", undefined],
            [
              "/candidates",
              "POST",
              {
                fullName: "Denied candidate",
                phone: "+79999999999",
                candidateType: "reserve",
              },
            ],
            [
              `/candidates/${candidate.id}/responses`,
              "POST",
              { text: "denied" },
            ],
          ] as const)
            assert.equal(
              (await request(login, path, method, body)).status,
              403,
            );
          const search = await json<{ items: { type: string }[] }>(
            await request(
              login,
              `/search?q=${encodeURIComponent(candidate.fullName)}`,
            ),
          );
          assert.equal(
            search.items.some((row) => row.type === "candidate"),
            false,
          );
          const recent = await json<unknown[]>(
            await request(login, "/search/recent", "POST", {
              refs: [{ type: "candidate", id: candidate.id }],
            }),
          );
          assert.deepEqual(recent, []);
          const me = await json<{
            capabilities: { canAccessCandidates: boolean };
          }>(await request(login, "/auth/me"));
          assert.equal(me.capabilities.canAccessCandidates, false);
        }
      },
    );
    await t.test(
      "contacts preserve separate fields, enforce scope and reject stale updates",
      async () => {
        const created = await json<{ id: string; version: number }>(
          await request("founder", `${root}/contacts`, "POST", {
            name: "Ответственный клиент",
            phones: ["+79990000001", "+79990000002"],
            emails: ["client@example.com"],
            links: ["https://example.com/contact"],
          }),
          201,
        );
        assert.equal(
          (await request("manager1", `${root}/contacts`)).status,
          200,
        );
        assert.equal(
          (
            await request("manager1", `${root}/contacts`, "POST", {
              name: "Forbidden",
            })
          ).status,
          403,
        );
        assert.equal(
          (await request("manager2", `${root}/contacts`)).status,
          404,
        );
        assert.equal(
          (
            await request("founder", `${root}/contacts`, "POST", {
              name: "Bad link",
              links: ["javascript:alert(1)"],
            })
          ).status,
          400,
        );
        const edited = await json<{ version: number }>(
          await request("founder", `${root}/contacts/${created.id}`, "PATCH", {
            name: "Обновлённое имя",
            expectedVersion: created.version,
          }),
        );
        assert.equal(edited.version, created.version + 1);
        assert.equal(
          (
            await request(
              "founder",
              `${root}/contacts/${created.id}`,
              "PATCH",
              { name: "Stale", expectedVersion: created.version },
            )
          ).status,
          409,
        );
        await json(
          await request("founder", `${root}/contacts/${created.id}`, "DELETE", {
            expectedVersion: edited.version,
          }),
        );
        assert.equal(
          await prisma.auditEvent.count({
            where: { entityId: object.id, action: "object.contact.deleted" },
          }),
          1,
        );
      },
    );
    await t.test(
      "budget uses approved snapshot amounts, subtracts returns and deduplicates leadership alerts",
      async () => {
        await json(
          await request("founder", `${root}/planning`, "PATCH", {
            expectedVersion: 0,
            monthlyBudget: 100,
          }),
        );
        assert.equal(
          (
            await request("manager1", `${root}/planning`, "PATCH", {
              expectedVersion: 1,
              monthlyBudget: 1,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("founder", `${root}/planning`, "PATCH", {
              expectedVersion: 0,
              monthlyBudget: 1,
            })
          ).status,
          409,
        );
        const item = await prisma.inventoryItem.create({
          data: {
            name: "Тестовый расходник",
            category: "cleaning",
            unit: "шт",
            createdByUserId: ids.get("founder")!,
          },
        });
        const movement = async (
          amount: number,
          type = "issue_to_object",
          overrides = {},
        ) =>
          prisma.inventoryMovement.create({
            data: {
              inventoryItemId: item.id,
              createdByUserId: ids.get("founder")!,
              relatedObjectId: object.id,
              movementType: type,
              quantity: 1,
              unitPriceSnapshot: amount,
              totalAmountSnapshot: amount,
              ...overrides,
            },
          });
        await movement(150);
        await movement(500, "issue_to_object", { status: "pending_approval" });
        await movement(700, "issue_to_object", {
          requiresApprovalBridge: true,
        });
        const previous = moscowMonthWindow().start;
        await movement(900, "issue_to_object", {
          createdAt: new Date(previous.getTime() - 1),
        });
        await Promise.all([
          planner.evaluateBudget(object.id),
          planner.evaluateBudget(object.id),
        ]);
        assert.equal(
          await prisma.objectBudgetAlert.count({
            where: { objectId: object.id },
          }),
          1,
        );
        const first = await json<{
          actualAmount: number;
          excessAmount: number;
        }>(await request("manager1", `${root}/planning`));
        assert.equal(first.actualAmount, 150);
        assert.equal(first.excessAmount, 50);
        await movement(30, "return");
        await planner.evaluateBudget(object.id);
        assert.equal(
          await prisma.objectBudgetAlert.count({
            where: { objectId: object.id },
          }),
          1,
        );
        await movement(10);
        await planner.evaluateBudget(object.id);
        assert.equal(
          await prisma.objectBudgetAlert.count({
            where: { objectId: object.id },
          }),
          2,
        );
        await planner.deliverBudgetAlerts();
        await planner.deliverBudgetAlerts();
        const alerts = await prisma.objectBudgetAlert.findMany({
          where: { objectId: object.id },
        });
        assert.equal(
          await prisma.chatMessage.count({
            where: {
              systemEventKey: {
                in: alerts.map((alert) => `object-budget:${alert.id}`),
              },
            },
          }),
          2,
        );
        assert.ok(
          (await prisma.notification.count({
            where: { entityId: object.id, type: "object.budget_exceeded" },
          })) > 0,
        );
        await json(
          await request("founder", "/inventory/movements", "POST", {
            inventoryItemId: item.id,
            movementType: "receipt",
            quantity: 100,
            unitPrice: 10,
          }),
          201,
        );
        const issue = await json<{ id: string }>(
          await request("founder", "/inventory/movements", "POST", {
            inventoryItemId: item.id,
            movementType: "issue_to_object",
            quantity: 1,
            relatedObjectId: object.id,
          }),
          201,
        );
        const { InventoryService } =
          await import("../src/modules/inventory/inventory.service");
        await prisma.$transaction((tx) =>
          app
            .get(InventoryService)
            .applyInventoryExceptionApprovalDecision(tx, {
              movementId: issue.id,
              actorUserId: ids.get("founder")!,
            }),
        );
        assert.equal(
          await prisma.objectBudgetAlert.count({
            where: { objectId: object.id },
          }),
          3,
          "approval records the budget increase atomically, without waiting for polling",
        );
        assert.equal(
          annualSeason("04-01", "10-01", new Date("2026-09-30T21:00:00Z")),
          "winter",
        );
      },
    );
    await t.test(
      "annual and manual modes preserve independent base rates and reject invalid dates",
      async () => {
        assert.equal(validAnnualDate("02-29"), false);
        assert.equal(validAnnualDate("04-31"), false);
        assert.equal(
          annualSeason("10-01", "04-01", new Date("2026-12-01T00:00:00Z")),
          "summer",
        );
        assert.equal(
          (
            await request("founder", `${root}/planning`, "PATCH", {
              expectedVersion: 1,
              automaticSeasons: true,
              summerStartsOn: "04-01",
              winterStartsOn: "04-01",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("manager1", `${root}/planning`, "PATCH", {
              expectedVersion: 1,
              automaticSeasons: true,
            })
          ).status,
          403,
        );
        await json(
          await request("founder", root, "PATCH", {
            seasonMode: "summer",
            dailyRate: 1100,
            summerDailyRate: 1300,
          }),
        );
        let saved = await prisma.object.findUniqueOrThrow({
          where: { id: object.id },
        });
        assert.equal(saved.dailyRate, 1300);
        assert.equal(
          (saved.baseCompensationProfile as { dailyRate: number }).dailyRate,
          1100,
        );
        await json(
          await request("founder", root, "PATCH", { seasonMode: null }),
        );
        saved = await prisma.object.findUniqueOrThrow({
          where: { id: object.id },
        });
        assert.equal(saved.dailyRate, 1100);
        await json(
          await request("founder", `${root}/planning`, "PATCH", {
            expectedVersion: 1,
            automaticSeasons: true,
            summerStartsOn: "04-01",
            winterStartsOn: "10-01",
          }),
        );
        await planner.applySeason(object.id, new Date("2027-04-01T00:00:00Z"));
        saved = await prisma.object.findUniqueOrThrow({
          where: { id: object.id },
        });
        assert.equal(saved.seasonMode, "summer");
        assert.equal(saved.dailyRate, 1300);
        await planner.applySeason(object.id, new Date("2027-10-01T00:00:00Z"));
        saved = await prisma.object.findUniqueOrThrow({
          where: { id: object.id },
        });
        assert.equal(saved.seasonMode, "winter");
        assert.equal(saved.dailyRate, 2000);
        assert.ok(
          (await prisma.auditEvent.count({
            where: { entityId: object.id, action: "object.season.activated" },
          })) >= 2,
        );
        await json(
          await request("founder", `${root}/planning`, "PATCH", {
            expectedVersion: 2,
            automaticSeasons: false,
          }),
        );
        await planner.applySeason(object.id, new Date("2028-04-01T00:00:00Z"));
        assert.equal(
          (await prisma.object.findUniqueOrThrow({ where: { id: object.id } }))
            .seasonMode,
          "winter",
        );
      },
    );
  },
);
