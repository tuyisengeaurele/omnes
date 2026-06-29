import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.companySettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'OMNES Manufacturing Ltd',
      currency: 'RWF',
      vatRate: 18,
      financialYearStart: 1,
    },
  });

  const passwordHash = await bcrypt.hash('Admin@2025!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@omnes.rw' },
    update: {},
    create: {
      email: 'admin@omnes.rw',
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Seed complete. Admin: admin@omnes.rw / Admin@2025!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
