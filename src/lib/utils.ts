import type { ApiResponse } from "./types";

/**
 * Normalize a test name for safe matching.
 * Strips brackets, parentheses, special chars → lowercase, spaces only.
 *
 * Examples:
 *   "RA Factor (Rheumatoid)"           → "ra factor rheumatoid"
 *   "ra-factor-rheumatoid-$39"         → "ra factor rheumatoid 39"
 *   "Comp. Metabolic Panel"            → "comp metabolic panel"
 *   "Vitamin B12 & Folate"             → "vitamin b12 folate"
 *   "CBC w/Differential"               → "cbc w differential"
 */
export function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()[\]{}]/g, "")    // strip brackets/parens
    .replace(/[&]/g, " ")         // & → space
    .replace(/[^a-z0-9\s]/g, " ") // all other special chars → space
    .replace(/\s+/g, " ")         // collapse whitespace
    .trim();
}

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

// ─── Per-category test field mapping ─────────────────────
// Each Metform checkbox group maps to one DB category.
// Multiple tests can be comma-separated within a single field.
const TEST_FIELD_MAP: { field: string; category: string }[] = [
  // Medical Testing & Panels — 4 separate fields all belong to this category
  { field: "mf-medical-tests-selection",    category: "medical_testing_and_panels" },
  { field: "mf-annual-checkup",             category: "medical_testing_and_panels" },
  { field: "mf-female-comprehensive-panel", category: "medical_testing_and_panels" },
  { field: "mf-male-comprehensive-panel",   category: "medical_testing_and_panels" },
  // Other categories — one field each
  { field: "mf-std-tests-selection",            category: "std_testing" },
  { field: "mf-drug-tests-selection",           category: "drug_testing" },
  { field: "mf-respiratory-tests-selection",    category: "respiratory_testing" },
  { field: "mf-uti-tests-selection",            category: "uti_testing" },
  { field: "mf-wound-tests-selection",          category: "wound_testing" },
  { field: "mf-gastrointestinal-tests-selection", category: "gastrointestinal_testing" },
];

/**
 * Parse mf-order-type into location + orderType.
 *   "dallas_walk_in"       → { location: "dallas",   orderType: "walk_in" }
 *   "dallas_home_collection" → { location: "dallas", orderType: "home_collection" }
 *   "houston_walk_in"      → { location: "houston",  orderType: "walk_in" }
 *   "houston_home_collection" → { location: "houston", orderType: "home_collection" }
 */
function parseOrderTypeField(raw: string | null): {
  location: "dallas" | "houston" | null;
  orderType: "walk_in" | "home_collection";
} {
  if (!raw) return { location: null, orderType: "walk_in" };

  const val = raw.toLowerCase().trim();
  const location: "dallas" | "houston" | null =
    val.startsWith("dallas_") ? "dallas" :
    val.startsWith("houston_") ? "houston" : null;

  const orderType: "walk_in" | "home_collection" =
    val.includes("home_collection") ? "home_collection" : "walk_in";

  return { location, orderType };
}

/**
 * Normalize a date string from the forms.
 * Forms send MM-DD-YYYY (e.g. "05-07-2026").
 * PostgreSQL date columns expect YYYY-MM-DD.
 * Strings already in YYYY-MM-DD pass through unchanged.
 */
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM-DD-YYYY → YYYY-MM-DD
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return raw;
}

/**
 * Extract structured patient fields from raw Metform webhook data.
 *
 * Returns tests as an array of { name, categoryHint } objects so the
 * webhook resolver can narrow catalog searches by category first.
 */
export function extractPatientFields(
  formData: Record<string, unknown>,
  fileUploads?: unknown,
) {
  const find = (keys: string[]): string | null => {
    for (const key of keys) {
      const val = formData[key];
      if (val && typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
    return null;
  };

  // ── Patient demographics ──────────────────────────────
  const patientName = find(["mf-patient-name", "patient_name", "patient-name", "full_name", "name"]);
  const patientDob  = normalizeDate(find(["mf-patient-dob", "patient_dob", "patient-dob", "date_of_birth", "dob"]));
  const patientPhone = find(["mf-patient-phone", "patient_phone", "contact_number", "phone"]);
  const patientSecondaryPhone = find(["mf-secondary-phone", "secondary_phone", "alt_phone"]);
  const patientAddress = find(["mf-address", "patient_address", "address", "full_address"]);

  // ── Physician / clinic (not used by current forms, kept for manual orders) ──
  const physicianName = find(["mf-physician-name", "physician_name", "doctor_name"]);
  const clinicAddress = find(["mf-clinic-address", "clinic_address", "clinic"]);

  // ── Schedule ──────────────────────────────────────────
  // Walk-in: "10:00 AM" | In-house: "11:00 AM to 01:00 PM"
  const scheduleDateRaw = find(["mf-select-date", "schedule_date", "appointment_date", "date"]);
  const scheduleDate = normalizeDate(scheduleDateRaw);
  const scheduleTime = find(["mf-available-slots", "schedule_time", "appointment_time", "time_slot"]);
  const dateOfOrder  = normalizeDate(find(["mf-date-of-order", "date_of_order", "order_date"]));

  // ── Tests — collected from all per-category fields ────
  // Each entry carries a categoryHint so the resolver can search the
  // right category first before falling back to fuzzy global matching.
  const tests: Array<{ name: string; categoryHint: string }> = [];

  for (const { field, category } of TEST_FIELD_MAP) {
    const val = formData[field];
    if (val && typeof val === "string" && val.trim()) {
      const names = val.split(",").map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        tests.push({ name, categoryHint: category });
      }
    }
  }

  // ── Extended patient fields ───────────────────────────
  const patientEmail = find(["mf-email", "patient_email", "email"]);
  const patientCity  = find(["mf-city",  "patient_city",  "city"]);
  const patientState = find(["mf-state", "patient_state", "state"]);
  const patientZipCode = find(["mf-zip-code", "mf-zip", "patient_zip_code", "zip_code", "zip"]);
  const referralSource = find(["mf-how-did-you-hear-about-us", "referral_source", "how_did_you_hear"]);

  // Combine checkbox allergy + free-text other into one string
  const allergyCheckbox = find(["mf-checkbox-allergy-information", "allergy_info"]);
  const allergyOther    = find(["mf-allergy-information-others",   "allergy_other"]);
  let allergyInfo: string | null = null;
  if (allergyCheckbox || allergyOther) {
    const parts: string[] = [];
    if (allergyCheckbox) parts.push(allergyCheckbox);
    if (allergyOther)    parts.push(`Other: ${allergyOther}`);
    allergyInfo = parts.join("; ");
  }

  // Consent checkboxes — any truthy value means agreed
  const consentData = {
    agreed: [1, 2, 3, 4, 5].map((n) => {
      const val = formData[`mf-agree-${n}`];
      return typeof val === "string" && val.trim().length > 0;
    }),
    initials: [1, 2, 3, 4, 5].map((n) => {
      const val = formData[`mf-initials-${n}`];
      return typeof val === "string" ? val.trim() : "";
    }),
  };

  // ── Order type → location + orderType ────────────────
  const rawOrderType = find(["mf-order-type", "order_type", "orderType"]);
  const { location, orderType } = parseOrderTypeField(rawOrderType);

  // ── Payment method ────────────────────────────────────
  // Some forms send mf-payment-option ("at_counter"/"online"),
  // others send mf-payment-method ("stripe").
  // Priority: mf-payment-option is more semantically meaningful for us.
  const paymentOption = find(["mf-payment-option"]);   // at_counter | online
  const paymentProcessor = find(["mf-payment-method"]); // stripe | etc.

  let paymentMethod: "online" | "at_counter" | null = null;
  if (paymentOption === "at_counter") {
    paymentMethod = "at_counter";
  } else if (paymentOption === "online" || paymentProcessor) {
    paymentMethod = "online";
  }

  // ── Signature ─────────────────────────────────────────
  // Present on all 4 form types. Large base64 PNG string.
  const signatureBase64 = find(["mf-signature-customer-or-legal-guardian"]) || null;

  // ── Driving license URL ───────────────────────────────
  // Present on in-house forms only. Arrives via file_uploads.
  let drivingLicenseUrl: string | null = null;
  if (fileUploads && typeof fileUploads === "object") {
    const uploads = fileUploads as Record<string, unknown>;
    const licenseField = uploads["mf-driving-license"];
    if (Array.isArray(licenseField) && licenseField.length > 0) {
      const first = licenseField[0] as Record<string, unknown>;
      if (first?.url && typeof first.url === "string") {
        drivingLicenseUrl = first.url;
      }
    }
  }

  return {
    patientName,
    patientDob,
    patientPhone,
    patientSecondaryPhone,
    patientAddress,
    patientEmail,
    patientCity,
    patientState,
    patientZipCode,
    referralSource,
    allergyInfo,
    consentData,
    physicianName,
    clinicAddress,
    scheduleDate,
    scheduleTime,
    dateOfOrder,
    tests,
    location,
    orderType,
    paymentMethod,
    signatureBase64,
    drivingLicenseUrl,
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
