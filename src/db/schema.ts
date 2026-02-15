import {
  pgTable,
  serial,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
  pgEnum,
  date,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────

export const staffRoleEnum = pgEnum("staff_role", ["admin", "staff"]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",       // just submitted from WordPress
  "completed",     // all tests done, results ready
  "cancelled",     // patient or admin cancelled
]);

export const testCategoryEnum = pgEnum("test_category", [
  "medical_testing_and_panels",
  "std_testing",
  "drug_testing",
  "respiratory_testing",
  "uti_testing",
  "wound_testing",
  "gastrointestinal_testing",
]);

// ─── Staff Table ─────────────────────────────────────────

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: staffRoleEnum("role").notNull().default("staff"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Test Catalog ────────────────────────────────────────
// Master list of all available tests with current pricing.
// When a test is ordered, the price is SNAPSHOT into order_items
// so future price changes don't affect past orders.

export const testCatalog = pgTable(
  "test_catalog",
  {
    id: serial("id").primaryKey(),
    testName: varchar("test_name", { length: 255 }).notNull(),
    category: testCategoryEnum("category").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_catalog_category").on(table.category),
    index("idx_catalog_active").on(table.isActive),
    index("idx_catalog_name").on(table.testName),
  ]
);

// ─── Orders (Form Submissions from WordPress) ────────────
// Each Metform submission = one order.
// One order has one patient, one schedule slot, and 1+ tests.

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    wpEntryId: varchar("wp_entry_id", { length: 100 }).unique(),
    orderNumber: varchar("order_number", { length: 50 }).unique().notNull(),

    // ── Patient Information ──────────────────────────────
    patientName: varchar("patient_name", { length: 255 }).notNull(),
    patientDob: date("patient_dob"),
    patientPhone: varchar("patient_phone", { length: 50 }),
    patientSecondaryPhone: varchar("patient_secondary_phone", { length: 50 }),
    patientAddress: text("patient_address"),

    // ── Physician / Clinic ───────────────────────────────
    physicianName: varchar("physician_name", { length: 255 }),
    clinicAddress: text("clinic_address"),

    // ── Scheduling ──────────────────────────────────────
    // 20-min slots: "09:00", "09:20", "09:40" ... "16:40"
    scheduleDate: date("schedule_date"),
    scheduleTime: varchar("schedule_time", { length: 10 }),

    // ── Order Metadata ──────────────────────────────────
    dateOfOrder: date("date_of_order").notNull(),
    formSlug: varchar("form_slug", { length: 150 }).notNull(),
    formName: varchar("form_name", { length: 255 }),

    // ── Pricing ─────────────────────────────────────────
    totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),

    // ── Workflow ─────────────────────────────────────────
    status: orderStatusEnum("status").notNull().default("pending"),
    assignedTo: integer("assigned_to").references(() => staff.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),

    // ── Safety net: keep the raw webhook payload ────────
    rawFormData: jsonb("raw_form_data"),

    // ── Timestamps ──────────────────────────────────────
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_orders_status").on(table.status),
    index("idx_orders_form_slug").on(table.formSlug),
    index("idx_orders_submitted").on(table.submittedAt),
    index("idx_orders_schedule_date").on(table.scheduleDate),
    index("idx_orders_schedule_combo").on(table.scheduleDate, table.scheduleTime),
    index("idx_orders_assigned").on(table.assignedTo),
    index("idx_orders_patient_name").on(table.patientName),
    index("idx_orders_patient_phone").on(table.patientPhone),
    uniqueIndex("idx_orders_number").on(table.orderNumber),
    uniqueIndex("idx_orders_wp_entry").on(table.wpEntryId),
  ]
);

// ─── Order Items (Tests in an Order) ─────────────────────
// One order can have multiple tests.
// Price is snapshot at order time — immune to future catalog changes.

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    testId: integer("test_id")
      .references(() => testCatalog.id, { onDelete: "restrict" })
      .notNull(),
    testName: varchar("test_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    priceAtOrder: numeric("price_at_order", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_items_order").on(table.orderId),
    index("idx_items_test").on(table.testId),
  ]
);

// ─── Status History (Audit Trail) ────────────────────────

export const statusHistory = pgTable(
  "status_history",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: varchar("old_status", { length: 30 }),
    newStatus: varchar("new_status", { length: 30 }).notNull(),
    changedBy: integer("changed_by").references(() => staff.id, {
      onDelete: "set null",
    }),
    comment: text("comment"),
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_history_order").on(table.orderId),
    index("idx_history_changed_by").on(table.changedBy),
  ]
);

// ─── Webhook Log ─────────────────────────────────────────

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("received"),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────────

export const staffRelations = relations(staff, ({ many }) => ({
  assignedOrders: many(orders),
  statusChanges: many(statusHistory),
}));

export const testCatalogRelations = relations(testCatalog, ({ many }) => ({
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  assignedStaff: one(staff, {
    fields: [orders.assignedTo],
    references: [staff.id],
  }),
  items: many(orderItems),
  statusHistory: many(statusHistory),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  test: one(testCatalog, {
    fields: [orderItems.testId],
    references: [testCatalog.id],
  }),
}));

export const statusHistoryRelations = relations(statusHistory, ({ one }) => ({
  order: one(orders, {
    fields: [statusHistory.orderId],
    references: [orders.id],
  }),
  changedByStaff: one(staff, {
    fields: [statusHistory.changedBy],
    references: [staff.id],
  }),
}));
