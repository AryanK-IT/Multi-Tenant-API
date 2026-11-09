import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/db/seed";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting TaskFlow database seeding...");
  const summary = await seedDatabase(prisma);
  console.log("Database seeded successfully:");
  console.table(summary);
}

main()
  .catch((e) => {
    console.error("Error during database seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
