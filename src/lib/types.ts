import { z } from "zod";

// ─── Auth ────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// ─── Staff ───────────────────────────────────────────────

export const createStaffSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "staff"]).default("staff"),
});

export const updateStaffSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  email: z.email().optional(),
  role: z.enum(["admin", "staff"]).optional(),
  isActive: z.boolean().optional(),
});

// ─── Valid schedule time slots (20-min intervals, 9 AM to 5 PM) ──

export const VALID_TIME_SLOTS = [
  "09:00", "09:20", "09:40",
  "10:00", "10:20", "10:40",
  "11:00", "11:20", "11:40",
  "12:00", "12:20", "12:40",
  "13:00", "13:20", "13:40",
  "14:00", "14:20", "14:40",
  "15:00", "15:20", "15:40",
  "16:00", "16:20", "16:40",
] as const;

// ─── Order Statuses ──────────────────────────────────────

export const ORDER_STATUSES = [
  "pending",
  "completed",
  "cancelled",
] as const;

export const TEST_CATEGORIES = [
  "medical_testing_and_panels",
  "std_testing",
  "drug_testing",
  "respiratory_testing",
  "uti_testing",
  "wound_testing",
  "gastrointestinal_testing",
] as const;

// ─── Order Updates ───────────────────────────────────────

export const updateOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  assignedTo: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  comment: z.string().optional(),
});

// ─── Order Filters (dashboard query params) ──────────────

export const orderFilterSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  formSlug: z.string().optional(),
  category: z.enum(TEST_CATEGORIES).optional(),
  assignedTo: z.coerce.number().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  scheduleDate: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(["submittedAt", "updatedAt", "status", "patientName", "scheduleDate", "totalAmount"]).default("submittedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Webhook Payload (from Metform) ──────────────────────
// Metform wraps form fields inside an "entries" object.
// Top-level keys like form_id, entry_id are also present.

export const webhookPayloadSchema = z.object({
  entries: z.record(z.string(), z.any()).optional(),
  form_id: z.union([z.string(), z.number()]).optional(),
  form_name: z.string().optional(),
  entry_id: z.union([z.string(), z.number()]).optional(),
  file_uploads: z.any().optional(),
  webhook_secret: z.string().optional(),
}).passthrough();

// ─── Test Catalog ────────────────────────────────────────

export const updateTestSchema = z.object({
  testName: z.string().min(2).max(255).optional(),
  category: z.enum(TEST_CATEGORIES).optional(),
  price: z.string().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createTestSchema = z.object({
  testName: z.string().min(2).max(255),
  category: z.enum(TEST_CATEGORIES),
  price: z.string(),
  description: z.string().nullable().optional(),
});

// ─── Schedule Availability Query ─────────────────────────

export const scheduleQuerySchema = z.object({
  date: z.string(), // YYYY-MM-DD
});

// ─── JWT ─────────────────────────────────────────────────

export interface JWTPayload {
  id: number;
  email: string;
  role: "admin" | "staff";
  iat?: number;
  exp?: number;
}

// ─── API Response ────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
