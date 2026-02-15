import type { ApiResponse } from "./types";

/**
 * Consistent success response
 */
export function success<T>(data: T, meta?: ApiResponse["meta"]): ApiResponse<T> {
  return { success: true, data, ...(meta && { meta }) };
}

/**
 * Consistent error response
 */
export function error(message: string): ApiResponse {
  return { success: false, error: message };
}

/**
 * Generate a unique order number.
 * Format: ORD-YYYYMMDD-XXXXX (e.g., ORD-20250208-A3F7K)
 */
export function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

/**
 * Extract structured patient fields from the raw Metform webhook data.
 *
 * Metform field names are based on what you name them in the form builder.
 * Add or adjust the keys below to match YOUR actual Metform field names/IDs.
 *
 * Example: if your "Patient Name" field in Metform has the name attribute
 * "mf-patient-name", add that to the nameKeys array.
 */
export function extractPatientFields(formData: Record<string, unknown>) {
  const find = (keys: string[]): string | null => {
    for (const key of keys) {
      const val = formData[key];
      if (val && typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
    return null;
  };

  // ── Map your Metform field names here ──────────────────
  // Add whatever your actual Metform field names are.

  const patientName = find([
    "mf-patient-name", "patient_name", "patient-name",
    "full_name", "name", "mf-name",
  ]);

  const patientDob = find([
    "mf-patient-dob", "patient_dob", "patient-dob",
    "date_of_birth", "dob", "mf-dob", "patient_date_of_birth",
  ]);

  const patientPhone = find([
    "mf-patient-phone", "patient_phone", "patient-phone",
    "contact_number", "phone", "mf-phone", "patient_contact_number",
  ]);

  const patientSecondaryPhone = find([
    "secondary_phone", "secondary-phone", "alt_phone",
    "patient_secondary_phone", "mf-secondary-phone",
  ]);

  const patientAddress = find([
    "patient_address", "patient-address", "address",
    "mf-address", "full_address",
  ]);

  const physicianName = find([
    "mf-physician-name", "physician_name", "physician-name",
    "doctor_name", "doctor", "mf-doctor-name",
  ]);

  const clinicAddress = find([
    "mf-clinic-address", "clinic_address", "clinic-address",
    "clinic", "mf-clinic",
  ]);

  const scheduleDate = find([
    "mf-select-date", "schedule_date", "schedule-date",
    "appointment_date", "mf-schedule-date", "date",
  ]);

  const scheduleTime = find([
    "mf-available-slots", "schedule_time", "schedule-time",
    "appointment_time", "mf-schedule-time", "time", "time_slot",
  ]);

  const dateOfOrder = find([
    "mf-date-of-order", "date_of_order", "date-of-order",
    "order_date",
  ]);

  // ── Tests can come as comma-separated string, JSON array, or repeated fields ──
  const testsRaw = formData["mf-tests-selection"]
    || formData["tests"]
    || formData["selected_tests"]
    || formData["mf-tests"]
    || formData["test_names"]
    || null;

  let testNames: string[] = [];
  if (typeof testsRaw === "string") {
    testNames = testsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  } else if (Array.isArray(testsRaw)) {
    testNames = testsRaw.map(String).filter(Boolean);
  }

  const category = find(["mf-test-category-name", "category", "test_category"]);

  return {
    patientName,
    patientDob,
    patientPhone,
    patientSecondaryPhone,
    patientAddress,
    physicianName,
    clinicAddress,
    scheduleDate,
    scheduleTime,
    dateOfOrder,
    testNames,
    category,
  };
}

/**
 * Normalize a form slug from the form ID or name
 */
export function normalizeFormSlug(raw: string | number | undefined): string {
  if (!raw) return "unknown-form";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Validate a time slot string matches 20-min interval pattern
 */
export function isValidTimeSlot(time: string): boolean {
  const validSlots = new Set([
    "09:00", "09:20", "09:40",
    "10:00", "10:20", "10:40",
    "11:00", "11:20", "11:40",
    "12:00", "12:20", "12:40",
    "13:00", "13:20", "13:40",
    "14:00", "14:20", "14:40",
    "15:00", "15:20", "15:40",
    "16:00", "16:20", "16:40",
  ]);
  return validSlots.has(time);
}
