import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const salt = await bcrypt.genSalt(10);

  // --- Users ---
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      password: await bcrypt.hash("admin123", salt),
      role: Role.ADMIN,
      fullName: "Администратор",
    },
  });

  await prisma.user.upsert({
    where: { username: "worker" },
    update: {},
    create: {
      username: "worker",
      password: await bcrypt.hash("worker123", salt),
      role: Role.WORKER,
      fullName: "Рабочий Иванов",
    },
  });

  await prisma.user.upsert({
    where: { username: "worker2" },
    update: {},
    create: {
      username: "worker2",
      password: await bcrypt.hash("worker123", salt),
      role: Role.WORKER,
      fullName: "Рабочий Петров",
    },
  });

  // --- Projects ---
  const projects = [
    { name: "ЖК Солнечный", code: "SOL-01", address: "ул. Ленина, 42" },
    { name: "ЖК Речной", code: "REC-02", address: "наб. Реки Фонтанки, 10" },
    { name: "БЦ Горизонт", code: "GOR-03", address: "пр. Мира, 88" },
    { name: "ТЦ Меридиан", code: "MER-04", address: "ул. Строителей, 5" },
  ];

  const createdProjects = [];
  for (const p of projects) {
    const project = await prisma.project.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    createdProjects.push(project);
  }

  // --- Work Types ---
  const workTypeNames = [
    "Земляные работы",
    "Фундамент",
    "Кладка",
    "Монолит",
    "Кровля",
    "Фасад",
    "Инженерные сети",
    "Отделка",
    "Благоустройство",
    "Прочее",
  ];

  for (const name of workTypeNames) {
    await prisma.workType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // --- Contractors ---
  const contractorNames = [
    "ООО СтройМастер",
    "ИП Петров",
    "ООО МонтажПро",
    "ЗАО ФундаментСтрой",
  ];

  for (const name of contractorNames) {
    await prisma.contractor.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // --- Areas (per project) ---
  const areaNames = ["Секция А", "Секция Б", "Подвал", "Кровля", "Паркинг"];

  for (const project of createdProjects) {
    for (const areaName of areaNames) {
      const existing = await prisma.area.findFirst({
        where: { name: areaName, projectId: project.id },
      });
      if (!existing) {
        await prisma.area.create({
          data: { name: areaName, projectId: project.id },
        });
      }
    }
  }

  console.log("Seed completed:");
  console.log("  Users: admin/admin123, worker/worker123, worker2/worker123");
  console.log(`  Projects: ${projects.length}`);
  console.log(`  Work types: ${workTypeNames.length}`);
  console.log(`  Contractors: ${contractorNames.length}`);
  console.log(`  Areas: ${createdProjects.length * areaNames.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
