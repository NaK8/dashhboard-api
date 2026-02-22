import { db } from "./index";
import { staff, testCatalog, testCategories } from "./schema";
import { normalizeTestName } from "../lib/utils";
import bcrypt from "bcrypt";

async function seed() {
  console.log("🌱 Seeding database...\n");

  // ── 1. Create default admin ───────────────────────────

  const hashedPassword = await bcrypt.hash("admin123456", 12);

  await db
    .insert(staff)
    .values({
      name: "Admin",
      email: "admin@wellhealthlabs.com",
      passwordHash: hashedPassword,
      role: "admin",
    })
    .onConflictDoNothing({ target: staff.email });

  console.log("✅ Admin user created");
  console.log("   📧 Email:    admin@wellhealthlabs.com");
  console.log("   🔑 Password: admin123456");
  console.log("   ⚠️  CHANGE THIS IN PRODUCTION!\n");

  // ── 2. Seed test categories ───────────────────────────

  const categories = [
    { key: "medical_testing_and_panels", displayName: "Medical Testing & Panels", slug: "medical-testing-and-panels", iconName: "Stethoscope", sortOrder: 0 },
    { key: "std_testing", displayName: "STD Testing", slug: "std-testing", iconName: "Shield", sortOrder: 1 },
    { key: "drug_testing", displayName: "Drug Testing", slug: "drug-testing", iconName: "Pill", sortOrder: 2 },
    { key: "respiratory_testing", displayName: "Respiratory Testing", slug: "respiratory-testing", iconName: "Wind", sortOrder: 3 },
    { key: "uti_testing", displayName: "UTI Testing", slug: "uti-testing", iconName: "FlaskConical", sortOrder: 4 },
    { key: "wound_testing", displayName: "Wound Testing", slug: "wound-testing", iconName: "Heart", sortOrder: 5 },
    { key: "gastrointestinal_testing", displayName: "Gastrointestinal Testing", slug: "gastrointestinal-testing", iconName: "TestTube", sortOrder: 6 },
  ];

  for (const cat of categories) {
    await db
      .insert(testCategories)
      .values(cat)
      .onConflictDoNothing({ target: testCategories.key });
  }

  console.log(`✅ ${categories.length} test categories seeded\n`);

  // ── 3. Seed test catalog (from tests.md) ──────────────
  // Names match tests.md exactly. searchName is auto-generated
  // for fuzzy webhook matching (strips brackets, dashes, etc.)

  const tests = [
    // Medical Testing & Panels
    { testName: "Annual Check-Up Panel", category: "medical_testing_and_panels", price: "99" },
    { testName: "Female Comprehensive Panel", category: "medical_testing_and_panels", price: "299" },
    { testName: "Male Comprehensive Panel", category: "medical_testing_and_panels", price: "199" },
    { testName: "Hemoglobin A1c", category: "medical_testing_and_panels", price: "29" },
    { testName: "Thyroid Panel", category: "medical_testing_and_panels", price: "99" },
    { testName: "Lipid Panel (Cholesterol)", category: "medical_testing_and_panels", price: "29" },
    { testName: "17 Food Panel", category: "medical_testing_and_panels", price: "99" },
    { testName: "TB Blood Test", category: "medical_testing_and_panels", price: "199" },
    { testName: "TB Quantiferon Gold", category: "medical_testing_and_panels", price: "199" },
    { testName: "RA Factor (Rheumatoid)", category: "medical_testing_and_panels", price: "39" },
    { testName: "Progesterone", category: "medical_testing_and_panels", price: "39" },
    { testName: "PSA Total", category: "medical_testing_and_panels", price: "30" },
    { testName: "Testosterone Free & Total", category: "medical_testing_and_panels", price: "40" },
    { testName: "Prothrombin Time", category: "medical_testing_and_panels", price: "40" },
    { testName: "Liver Function Panel", category: "medical_testing_and_panels", price: "25" },
    { testName: "Comp. Metabolic Panel", category: "medical_testing_and_panels", price: "29" },
    { testName: "RH Factor", category: "medical_testing_and_panels", price: "29" },
    { testName: "Estradiol", category: "medical_testing_and_panels", price: "49" },
    { testName: "HCG", category: "medical_testing_and_panels", price: "40" },
    { testName: "Diabetes Panel", category: "medical_testing_and_panels", price: "50" },
    { testName: "TSH", category: "medical_testing_and_panels", price: "49" },
    { testName: "Hepatitis A (HAV) Antibody", category: "medical_testing_and_panels", price: "49" },
    { testName: "Hepatitis B Surface Antigen", category: "medical_testing_and_panels", price: "49" },
    { testName: "Hepatitis C (HCV) Antibody", category: "medical_testing_and_panels", price: "49" },
    { testName: "Glucose", category: "medical_testing_and_panels", price: "49" },
    { testName: "Vitamin B12 & Folate", category: "medical_testing_and_panels", price: "59" },
    { testName: "Vitamin D 25-Hydroxy", category: "medical_testing_and_panels", price: "49" },
    { testName: "ESR/Sed Rate", category: "medical_testing_and_panels", price: "49" },
    { testName: "Urinalysis Complete", category: "medical_testing_and_panels", price: "20" },
    { testName: "CBC w/Differential", category: "medical_testing_and_panels", price: "10" },

    // STD Testing
    { testName: "Basic STD Panel", category: "std_testing", price: "129" },
    { testName: "Comprehensive STD Panel (Hep B & C)", category: "std_testing", price: "169" },
    { testName: "HIV Screen", category: "std_testing", price: "40" },
    { testName: "Trichomonas Urine", category: "std_testing", price: "89" },
    { testName: "Syphilis (RPR)", category: "std_testing", price: "39" },
    { testName: "Herpes Simplex 1/2 IgG", category: "std_testing", price: "40" },
    { testName: "Chlamydia/Gonorrhea", category: "std_testing", price: "79" },
    { testName: "Comprehensive STD Panel Plus", category: "std_testing", price: "149" },

    // Drug Testing
    { testName: "Drug Screening and Confirmation", category: "drug_testing", price: "140" },

    // Respiratory Testing
    { testName: "Respiratory pathogens panel (Virus and Bacterial)", category: "respiratory_testing", price: "120" },
    { testName: "Respiratory Panel (Viral only)", category: "respiratory_testing", price: "80" },
    { testName: "Covid-19", category: "respiratory_testing", price: "65" },

    // UTI Testing
    { testName: "UTI (Urinary Tract Infection)", category: "uti_testing", price: "149" },

    // Wound Testing
    { testName: "Fungal Panel", category: "wound_testing", price: "120" },
    { testName: "Wound Panel", category: "wound_testing", price: "120" },
    { testName: "Wound and Fungal Panel", category: "wound_testing", price: "180" },

    // Gastrointestinal Testing
    { testName: "GI Comprehensive Panel", category: "gastrointestinal_testing", price: "150" },
    { testName: "H. pylori", category: "gastrointestinal_testing", price: "75" },
  ];

  let inserted = 0;
  for (const test of tests) {
    const searchName = normalizeTestName(test.testName);
    await db
      .insert(testCatalog)
      .values({ ...test, searchName })
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`✅ Test catalog seeded: ${inserted} tests across ${categories.length} categories\n`);

  // ── Summary ───────────────────────────────────────────
  const uniqueCategories = [...new Set(tests.map((t) => t.category))];
  for (const cat of uniqueCategories) {
    const catTests = tests.filter((t) => t.category === cat);
    console.log(`   ${cat}: ${catTests.length} tests`);
  }

  console.log("\n🎉 Seed completed!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
