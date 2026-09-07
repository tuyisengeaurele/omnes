/**
 * Local development seed data.
 *
 * Idempotent where the schema allows it (city code, merchant profile phone
 * numbers), so `npm run db:seed` can be re-run after a migrate reset without
 * producing duplicate reference data. Product and category rows are
 * recreated per merchant on each run, since there is no natural unique key
 * to upsert them against.
 *
 * Run with: npm run db:seed --workspace apps/api
 */

import { PrismaClient, type Vertical } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const RWF = 'RWF';

async function seedCity() {
  const city = await prisma.city.upsert({
    where: { code: 'KGL' },
    update: {},
    create: {
      code: 'KGL',
      name: 'Kigali',
      countryCode: 'RW',
      currency: RWF,
      timezone: 'Africa/Kigali',
      activeVerticals: ['FOOD', 'GROCERY'],
    },
  });

  const zoneDefs = [
    { name: 'Kimihurura', deliveryRadiusM: 4000 },
    { name: 'Kacyiru', deliveryRadiusM: 4000 },
    { name: 'Nyamirambo', deliveryRadiusM: 3500 },
    { name: 'Remera', deliveryRadiusM: 4500 },
    { name: 'Kicukiro', deliveryRadiusM: 5000 },
  ];

  const existingZones = await prisma.zone.findMany({ where: { cityId: city.id } });
  const zones =
    existingZones.length > 0
      ? existingZones
      : await Promise.all(
          zoneDefs.map((z) =>
            prisma.zone.create({
              data: {
                cityId: city.id,
                name: z.name,
                deliveryRadiusM: z.deliveryRadiusM,
                // Placeholder centroid-only polygon. Real zone boundaries are
                // drawn by ops once the admin dashboard ships.
                polygon: { type: 'Point', coordinates: [30.0619, -1.9441] },
              },
            })
          )
        );

  const feeCount = await prisma.feeSchedule.count({ where: { cityId: city.id } });
  if (feeCount === 0) {
    const verticals: Vertical[] = ['FOOD', 'GROCERY'];
    await prisma.feeSchedule.createMany({
      data: verticals.map((vertical) => ({
        cityId: city.id,
        vertical,
        baseFeeMinor: 500,
        perKmFeeMinor: 200,
        serviceFeeBps: 500,
        effectiveFrom: new Date(),
      })),
    });
  }

  return { city, zones };
}

async function seedStaffUsers() {
  const staff: Array<{ phone: string; name: string; role: 'OPS' | 'SUPPORT' | 'FINANCE' | 'SUPER_ADMIN' }> = [
    { phone: '+250780000001', name: 'Ops Admin', role: 'OPS' },
    { phone: '+250780000002', name: 'Support Agent', role: 'SUPPORT' },
    { phone: '+250780000003', name: 'Finance Officer', role: 'FINANCE' },
    { phone: '+250780000004', name: 'Platform Owner', role: 'SUPER_ADMIN' },
  ];

  for (const s of staff) {
    const user = await prisma.user.upsert({
      where: { phoneE164: s.phone },
      update: {},
      create: {
        phoneE164: s.phone,
        displayName: s.name,
        locale: 'en',
      },
    });

    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: s.role } },
      update: {},
      create: { userId: user.id, role: s.role },
    });
  }
}

interface MerchantSeed {
  name: string;
  vertical: Vertical;
  phone: string;
  zoneIndex: number;
  categories: Array<{ name: string; items: Array<{ name: string; priceMinor: number }> }>;
}

const merchantDefs: MerchantSeed[] = [
  {
    name: 'Heaven Kigali Kitchen',
    vertical: 'FOOD',
    phone: '+250781000001',
    zoneIndex: 0,
    categories: [
      {
        name: 'Grills',
        items: [
          { name: 'Grilled tilapia and ugali', priceMinor: 6500 },
          { name: 'Brochette platter', priceMinor: 5500 },
          { name: 'Grilled chicken leg quarter', priceMinor: 4500 },
          { name: 'Goat brochette skewer', priceMinor: 3000 },
        ],
      },
      {
        name: 'Sides',
        items: [
          { name: 'Sweet potato fries', priceMinor: 2000 },
          { name: 'Plantain chips', priceMinor: 1800 },
          { name: 'Sauteed greens', priceMinor: 1500 },
        ],
      },
    ],
  },
  {
    name: 'Kigali Noodle House',
    vertical: 'FOOD',
    phone: '+250781000002',
    zoneIndex: 1,
    categories: [
      {
        name: 'Noodles',
        items: [
          { name: 'Beef chow mein', priceMinor: 4800 },
          { name: 'Vegetable stir-fried noodles', priceMinor: 3800 },
          { name: 'Chicken udon soup', priceMinor: 4200 },
        ],
      },
      {
        name: 'Starters',
        items: [
          { name: 'Spring rolls, 4 pieces', priceMinor: 2500 },
          { name: 'Chicken dumplings, 6 pieces', priceMinor: 3200 },
        ],
      },
    ],
  },
  {
    name: 'Mama Africa Pizzeria',
    vertical: 'FOOD',
    phone: '+250781000003',
    zoneIndex: 3,
    categories: [
      {
        name: 'Pizza',
        items: [
          { name: 'Margherita, 12 inch', priceMinor: 7500 },
          { name: 'Pepperoni, 12 inch', priceMinor: 8500 },
          { name: 'Vegetarian supreme, 12 inch', priceMinor: 8000 },
          { name: 'BBQ chicken, 12 inch', priceMinor: 9000 },
        ],
      },
      {
        name: 'Salads',
        items: [
          { name: 'Caesar salad', priceMinor: 3500 },
          { name: 'Garden salad', priceMinor: 2800 },
        ],
      },
    ],
  },
  {
    name: 'Simba Supermarket Kacyiru',
    vertical: 'GROCERY',
    phone: '+250781000004',
    zoneIndex: 1,
    categories: [
      {
        name: 'Fresh produce',
        items: [
          { name: 'Tomatoes, 1kg', priceMinor: 1200 },
          { name: 'Onions, 1kg', priceMinor: 900 },
          { name: 'Irish potatoes, 2kg', priceMinor: 1800 },
          { name: 'Bananas, 1 bunch', priceMinor: 1500 },
          { name: 'Avocado, each', priceMinor: 500 },
        ],
      },
      {
        name: 'Pantry',
        items: [
          { name: 'Rice, 5kg', priceMinor: 6500 },
          { name: 'Cooking oil, 1L', priceMinor: 2800 },
          { name: 'Sugar, 1kg', priceMinor: 1400 },
          { name: 'Maize flour, 2kg', priceMinor: 1900 },
        ],
      },
    ],
  },
  {
    name: 'Kigali Fresh Market',
    vertical: 'GROCERY',
    phone: '+250781000005',
    zoneIndex: 2,
    categories: [
      {
        name: 'Dairy and eggs',
        items: [
          { name: 'Fresh milk, 1L', priceMinor: 1100 },
          { name: 'Eggs, tray of 30', priceMinor: 4200 },
          { name: 'Yogurt, 500ml', priceMinor: 1600 },
        ],
      },
      {
        name: 'Bakery',
        items: [
          { name: 'Sliced bread, 600g', priceMinor: 1300 },
          { name: 'Mandazi, pack of 6', priceMinor: 1000 },
        ],
      },
    ],
  },
  {
    name: 'Kicukiro Essentials',
    vertical: 'GROCERY',
    phone: '+250781000006',
    zoneIndex: 4,
    categories: [
      {
        name: 'Household',
        items: [
          { name: 'Laundry soap bar', priceMinor: 700 },
          { name: 'Dish washing liquid, 500ml', priceMinor: 1800 },
          { name: 'Toilet paper, pack of 4', priceMinor: 2200 },
        ],
      },
      {
        name: 'Beverages',
        items: [
          { name: 'Bottled water, 1.5L', priceMinor: 800 },
          { name: 'Fanta citron, 500ml', priceMinor: 700 },
          { name: 'Ground coffee, 250g', priceMinor: 3500 },
        ],
      },
    ],
  },
];

async function seedMerchants(cityId: string, zoneIds: string[]) {
  for (const def of merchantDefs) {
    const ownerUser = await prisma.user.upsert({
      where: { phoneE164: def.phone },
      update: {},
      create: {
        phoneE164: def.phone,
        displayName: `${def.name} owner`,
        locale: 'en',
      },
    });

    let merchant = await prisma.merchant.findFirst({ where: { name: def.name } });
    if (!merchant) {
      merchant = await prisma.merchant.create({
        data: {
          name: def.name,
          vertical: def.vertical,
          cityId,
          zoneId: zoneIds[def.zoneIndex] ?? zoneIds[0]!,
          // Approximate Kigali coordinates, offset slightly per merchant so
          // they do not all stack on one point on a map view.
          latitude: 30.0619 + merchantDefs.indexOf(def) * 0.004,
          longitude: -1.9441 + merchantDefs.indexOf(def) * 0.003,
          prepTimeMinutes: 20,
          isOpen: true,
          status: 'ACTIVE',
        },
      });

      await prisma.merchantHours.createMany({
        data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          merchantId: merchant!.id,
          dayOfWeek,
          opensAt: '08:00',
          closesAt: '21:00',
        })),
      });
    }

    await prisma.merchantProfile.upsert({
      where: { userId: ownerUser.id },
      update: {},
      create: { userId: ownerUser.id, merchantId: merchant.id, status: 'APPROVED' },
    });

    await prisma.userRole.upsert({
      where: { userId_role: { userId: ownerUser.id, role: 'MERCHANT_OWNER' } },
      update: {},
      create: { userId: ownerUser.id, role: 'MERCHANT_OWNER' },
    });

    // Categories and products are recreated on each run rather than upserted,
    // since neither has a natural unique key to key off. Products are deleted
    // before their categories: Product.categoryId is ON DELETE SET NULL, so
    // deleting categories first would orphan the old products instead of
    // removing them, and the next createMany would double the catalog.
    await prisma.product.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.category.deleteMany({ where: { merchantId: merchant.id } });

    for (const cat of def.categories) {
      const category = await prisma.category.create({
        data: { merchantId: merchant.id, name: cat.name },
      });

      await prisma.product.createMany({
        data: cat.items.map((item) => ({
          merchantId: merchant!.id,
          categoryId: category.id,
          name: item.name,
          priceMinor: item.priceMinor,
          currency: RWF,
          isAvailable: true,
        })),
      });
    }
  }
}

async function main() {
  const { city, zones } = await seedCity();
  await seedStaffUsers();
  await seedMerchants(
    city.id,
    zones.map((z) => z.id)
  );

  const [merchantCount, productCount, userCount] = await Promise.all([
    prisma.merchant.count(),
    prisma.product.count(),
    prisma.user.count(),
  ]);

  console.log(`seeded: ${merchantCount} merchants, ${productCount} products, ${userCount} users`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
