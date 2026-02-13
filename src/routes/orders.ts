import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, asc, and, ilike, sql, gte, lte, count } from "drizzle-orm";
import { db } from "../db";
import { orders, orderItems, statusHistory } from "../db/schema";
import {
  updateOrderSchema,
  orderFilterSchema,
  scheduleQuerySchema,
  VALID_TIME_SLOTS,
} from "../lib/types";
import { success, error } from "../lib/utils";
import { authMiddleware } from "../middleware/auth";

const ordersRoute = new Hono();

// All routes require authentication
ordersRoute.use("*", authMiddleware);

// ─── GET /orders — list with filters & pagination ────────

ordersRoute.get("/", zValidator("query", orderFilterSchema), async (c) => {
  const filters = c.req.valid("query");

  const conditions = [];

  if (filters.status) {
    conditions.push(eq(orders.status, filters.status));
  }

  if (filters.formSlug) {
    conditions.push(eq(orders.formSlug, filters.formSlug));
  }

  if (filters.assignedTo) {
    conditions.push(eq(orders.assignedTo, filters.assignedTo));
  }

  if (filters.scheduleDate) {
    conditions.push(eq(orders.scheduleDate, filters.scheduleDate));
  }

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      sql`(
        ${ilike(orders.patientName, pattern)} OR
        ${ilike(orders.patientPhone, pattern)} OR
        ${ilike(orders.orderNumber, pattern)} OR
        ${ilike(orders.patientAddress, pattern)}
      )`
    );
  }

  if (filters.dateFrom) {
    conditions.push(gte(orders.submittedAt, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(orders.submittedAt, new Date(filters.dateTo)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Sort mapping
  const sortColumn = {
    submittedAt: orders.submittedAt,
    updatedAt: orders.updatedAt,
    status: orders.status,
    patientName: orders.patientName,
    scheduleDate: orders.scheduleDate,
    totalAmount: orders.totalAmount,
  }[filters.sortBy];

  const orderFn = filters.sortOrder === "asc" ? asc : desc;

  // Total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(orders)
    .where(whereClause);

  // Fetch page with related data
  const offset = (filters.page - 1) * filters.limit;

  const rows = await db.query.orders.findMany({
    where: whereClause,
    orderBy: orderFn(sortColumn),
    limit: filters.limit,
    offset,
    with: {
      assignedStaff: {
        columns: { id: true, name: true, email: true },
      },
      items: {
        columns: {
          id: true,
          testName: true,
          category: true,
          priceAtOrder: true,
        },
      },
    },
  });

  return c.json(
    success(rows, {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    })
  );
});

// ─── GET /orders/stats — dashboard summary ───────────────

ordersRoute.get("/stats", async (c) => {
  // Count by status
  const statusStats = await db
    .select({ status: orders.status, count: count() })
    .from(orders)
    .groupBy(orders.status);

  // Today's submissions
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayCount] = await db
    .select({ count: count() })
    .from(orders)
    .where(gte(orders.submittedAt, todayStart));

  // Today's scheduled appointments
  const todayStr = new Date().toISOString().slice(0, 10);
  const [todayScheduled] = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.scheduleDate, todayStr));

  // Revenue stats
  const [revenue] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      completed: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.totalAmount}::numeric ELSE 0 END), 0)`,
    })
    .from(orders);

  // Available form types
  const forms = await db
    .selectDistinct({
      formSlug: orders.formSlug,
      formName: orders.formName,
    })
    .from(orders);

  return c.json(
    success({
      byStatus: statusStats.reduce(
        (acc, row) => ({ ...acc, [row.status]: row.count }),
        {} as Record<string, number>
      ),
      todaySubmissions: todayCount.count,
      todayScheduledAppointments: todayScheduled.count,
      totalOrders: statusStats.reduce((sum, row) => sum + row.count, 0),
      revenue: {
        total: revenue.total,
        completedOnly: revenue.completed,
      },
      availableForms: forms,
    })
  );
});

// ─── GET /orders/schedule — check slot availability ──────
// Returns which time slots are taken for a given date.
// Your dashboard can use this to show available/booked slots.

ordersRoute.get(
  "/schedule",
  zValidator("query", scheduleQuerySchema),
  async (c) => {
    const { date } = c.req.valid("query");

    // Get all booked slots for this date (exclude cancelled/rejected)
    const booked = await db
      .select({
        scheduleTime: orders.scheduleTime,
        orderNumber: orders.orderNumber,
        patientName: orders.patientName,
        status: orders.status,
      })
      .from(orders)
      .where(
        and(
          eq(orders.scheduleDate, date),
          sql`${orders.status} NOT IN ('cancelled', 'rejected')`
        )
      );

    const bookedTimes = new Set(booked.map((b) => b.scheduleTime));

    const slots = VALID_TIME_SLOTS.map((time) => ({
      time,
      isBooked: bookedTimes.has(time),
      order: booked.find((b) => b.scheduleTime === time) || null,
    }));

    return c.json(
      success({
        date,
        totalSlots: VALID_TIME_SLOTS.length,
        bookedCount: bookedTimes.size,
        availableCount: VALID_TIME_SLOTS.length - bookedTimes.size,
        slots,
      })
    );
  }
);

// ─── GET /orders/:id — single order with full details ────

ordersRoute.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json(error("Invalid order ID"), 400);
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      assignedStaff: {
        columns: { id: true, name: true, email: true },
      },
      items: true,
      statusHistory: {
        orderBy: (history, { desc }) => [desc(history.changedAt)],
        with: {
          changedByStaff: {
            columns: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!order) {
    return c.json(error("Order not found"), 404);
  }

  return c.json(success(order));
});

// ─── PATCH /orders/:id — update status/assignment/notes ──

ordersRoute.patch(
  "/:id",
  zValidator("json", updateOrderSchema),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const updates = c.req.valid("json");
    const user = c.get("user");

    if (isNaN(id)) {
      return c.json(error("Invalid order ID"), 400);
    }

    const current = await db.query.orders.findFirst({
      where: eq(orders.id, id),
    });

    if (!current) {
      return c.json(error("Order not found"), 404);
    }

    // Build update object
    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.status !== undefined) updateFields.status = updates.status;
    if (updates.assignedTo !== undefined) updateFields.assignedTo = updates.assignedTo;
    if (updates.notes !== undefined) updateFields.notes = updates.notes;

    const [updated] = await db
      .update(orders)
      .set(updateFields)
      .where(eq(orders.id, id))
      .returning();

    // Audit trail for status changes
    if (updates.status && updates.status !== current.status) {
      await db.insert(statusHistory).values({
        orderId: id,
        oldStatus: current.status,
        newStatus: updates.status,
        changedBy: user.id,
        comment: updates.comment || null,
      });
    }

    return c.json(success(updated));
  }
);

// ─── DELETE /orders/:id — admin only ─────────────────────

ordersRoute.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const user = c.get("user");

  if (isNaN(id)) {
    return c.json(error("Invalid order ID"), 400);
  }

  if (user.role !== "admin") {
    return c.json(error("Admin access required"), 403);
  }

  const [deleted] = await db
    .delete(orders)
    .where(eq(orders.id, id))
    .returning({ id: orders.id, orderNumber: orders.orderNumber });

  if (!deleted) {
    return c.json(error("Order not found"), 404);
  }

  return c.json(success({ message: "Order deleted", ...deleted }));
});

export default ordersRoute;
