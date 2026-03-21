import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcrypt";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // --- Storage bucket ---
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "stroyfoto";
  const { data: existingBuckets } = await supabase.storage.listBuckets();
  const bucketExists = existingBuckets?.some((b) => b.name === bucketName);
  if (!bucketExists) {
    const { error: bucketErr } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (bucketErr) {
      console.error("Failed to create storage bucket:", bucketErr.message);
    } else {
      console.log(`  Storage bucket "${bucketName}" created`);
    }
  } else {
    console.log(`  Storage bucket "${bucketName}" already exists`);
  }

  const salt = await bcrypt.genSalt(10);

  // --- Users ---
  const users = [
    { username: "admin", password: await bcrypt.hash("admin123", salt), role: "ADMIN" as const, full_name: "Администратор" },
    { username: "worker", password: await bcrypt.hash("worker123", salt), role: "WORKER" as const, full_name: "Рабочий Иванов" },
    { username: "worker2", password: await bcrypt.hash("worker123", salt), role: "WORKER" as const, full_name: "Рабочий Петров" },
  ];

  for (const u of users) {
    await supabase.from("users").upsert(u, { onConflict: "username", ignoreDuplicates: true });
  }

  // --- Projects ---
  const projects = [
    { name: "ЖК Солнечный", code: "SOL-01", address: "ул. Ленина, 42" },
    { name: "ЖК Речной", code: "REC-02", address: "наб. Реки Фонтанки, 10" },
    { name: "БЦ Горизонт", code: "GOR-03", address: "пр. Мира, 88" },
    { name: "ТЦ Меридиан", code: "MER-04", address: "ул. Строителей, 5" },
  ];

  for (const p of projects) {
    await supabase.from("projects").upsert(p, { onConflict: "code", ignoreDuplicates: true });
  }

  // Fetch created projects to get IDs
  const { data: createdProjects } = await supabase
    .from("projects")
    .select("id, code")
    .in("code", projects.map((p) => p.code));

  // --- Work Types ---
  const workTypeNames = [
    "Земляные работы", "Фундамент", "Кладка", "Монолит", "Кровля",
    "Фасад", "Инженерные сети", "Отделка", "Благоустройство", "Прочее",
  ];

  for (const name of workTypeNames) {
    await supabase.from("work_types").upsert({ name }, { onConflict: "name", ignoreDuplicates: true });
  }

  // --- Contractors ---
  const contractorNames = [
    "ООО СтройМастер", "ИП Петров", "ООО МонтажПро", "ЗАО ФундаментСтрой",
  ];

  for (const name of contractorNames) {
    await supabase.from("contractors").upsert({ name }, { onConflict: "name", ignoreDuplicates: true });
  }

  // --- Areas (per project) ---
  const areaNames = ["Секция А", "Секция Б", "Подвал", "Кровля", "Паркинг"];

  for (const project of createdProjects ?? []) {
    for (const areaName of areaNames) {
      // Check if area exists for this project
      const { data: existing } = await supabase
        .from("areas")
        .select("id")
        .eq("name", areaName)
        .eq("project_id", project.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from("areas").insert({ name: areaName, project_id: project.id });
      }
    }
  }

  console.log("Seed completed:");
  console.log("  Users: admin/admin123, worker/worker123, worker2/worker123");
  console.log(`  Projects: ${projects.length}`);
  console.log(`  Work types: ${workTypeNames.length}`);
  console.log(`  Contractors: ${contractorNames.length}`);
  console.log(`  Areas: ${(createdProjects?.length ?? 0) * areaNames.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
