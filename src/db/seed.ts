import { db } from "./index";
import { staff, testCatalog } from "./schema";
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

  // ── 2. Seed test catalog ──────────────────────────────

  const tests = [
    // Medical Testing & Panels
    { testName: "Annual Check-Up Panel (includes CBC, Lipid Panel, CMP, TSH, A1C)", category: "medical_testing_and_panels" as const, price: "99" },
    { testName: "Female Comprehensive Panel", category: "medical_testing_and_panels" as const, price: "299" },
    { testName: "Male Comprehensive Panel", category: "medical_testing_and_panels" as const, price: "199" },
    { testName: "Hemoglobin A1c", category: "medical_testing_and_panels" as const, price: "29" },
    { testName: "Thyroid Panel", category: "medical_testing_and_panels" as const, price: "99" },
    { testName: "Lipid Panel (Cholesterol)", category: "medical_testing_and_panels" as const, price: "29" },
    { testName: "17 Food Panel", category: "medical_testing_and_panels" as const, price: "99" },
    { testName: "TB Blood Test", category: "medical_testing_and_panels" as const, price: "199" },
    { testName: "TB Quantiferon Gold", category: "medical_testing_and_panels" as const, price: "199" },
    { testName: "RA Factor (Rheumatoid)", category: "medical_testing_and_panels" as const, price: "39" },
    { testName: "Progesterone", category: "medical_testing_and_panels" as const, price: "39" },
    { testName: "PSA Total", category: "medical_testing_and_panels" as const, price: "30" },
    { testName: "Testosterone Free & Total", category: "medical_testing_and_panels" as const, price: "40" },
    { testName: "Prothrombin Time", category: "medical_testing_and_panels" as const, price: "40" },
    { testName: "Liver Function Panel", category: "medical_testing_and_panels" as const, price: "25" },
    { testName: "Comp. Metabolic Panel", category: "medical_testing_and_panels" as const, price: "29" },
    { testName: "RH Factor", category: "medical_testing_and_panels" as const, price: "29" },
    { testName: "Estradiol", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "HCG", category: "medical_testing_and_panels" as const, price: "40" },
    { testName: "Diabetes Panel", category: "medical_testing_and_panels" as const, price: "50" },
    { testName: "TSH", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Hepatitis A (HAV) Antibody", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Hepatitis B Surface Antigen", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Hepatitis C (HCV) Antibody", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Glucose", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Vitamin B12 & Folate", category: "medical_testing_and_panels" as const, price: "59" },
    { testName: "Vitamin D 25-Hydroxy", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "ESR/Sed Rate", category: "medical_testing_and_panels" as const, price: "49" },
    { testName: "Urinalysis Complete", category: "medical_testing_and_panels" as const, price: "20" },
    { testName: "CBC w/Differential", category: "medical_testing_and_panels" as const, price: "10" },

    // STD Testing
    { testName: "Basic STD Panel", category: "std_testing" as const, price: "129" },
    { testName: "Comprehensive STD Panel (Hep B & C)", category: "std_testing" as const, price: "169" },
    { testName: "HIV Screen", category: "std_testing" as const, price: "40" },
    { testName: "Trichomonas Urine", category: "std_testing" as const, price: "89" },
    { testName: "Syphilis (RPR)", category: "std_testing" as const, price: "39" },
    { testName: "Herpes Simplex 1/2 IgG", category: "std_testing" as const, price: "40" },
    { testName: "Chlamydia/Gonorrhea", category: "std_testing" as const, price: "79" },
    { testName: "Comprehensive STD Panel Plus", category: "std_testing" as const, price: "149" },

    // Drug Testing
    { testName: "Comprehensive Drug Screen", category: "drug_testing" as const, price: "140" },

    // Respiratory Testing
    { testName: "Respiratory Pathogen (Full)", category: "respiratory_testing" as const, price: "120" },
    { testName: "Respiratory Pathogen (Viral Only)", category: "respiratory_testing" as const, price: "80" },
    { testName: "Covid-19", category: "respiratory_testing" as const, price: "65" },

    // UTI Testing
    { testName: "UTI (Urinary Tract Infection)", category: "uti_testing" as const, price: "149" },

    // Wound Testing
    { testName: "Fungal Panel", category: "wound_testing" as const, price: "120" },
    { testName: "Wound Panel", category: "wound_testing" as const, price: "120" },
    { testName: "Wound and Fungal Panel", category: "wound_testing" as const, price: "180" },

    // Gastrointestinal Testing
    { testName: "GI Comprehensive Panel", category: "gastrointestinal_testing" as const, price: "150" },
    { testName: "H. pylori", category: "gastrointestinal_testing" as const, price: "75" },
  ];

  let inserted = 0;
  for (const test of tests) {
    await db
      .insert(testCatalog)
      .values(test)
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`✅ Test catalog seeded: ${inserted} tests across 7 categories\n`);

  // ── Summary ───────────────────────────────────────────
  const categories = [...new Set(tests.map((t) => t.category))];
  for (const cat of categories) {
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
