import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.event.count();
  if (existing > 0) {
    console.log(`Skip seed: ${existing} events already present.`);
    return;
  }

  await prisma.event.createMany({
    data: [
      {
        title: 'Триатлон Парк Астана',
        date: new Date('2027-05-23T08:00:00+05:00'),
        location: 'Парк Астана, Астана',
        distance: '5 км',
        slotsTotal: 2000,
        slotsTaken: 0,
        price: 5000,
      },
      {
        title: 'Осенний забег «Медеу 5K»',
        date: new Date('2025-08-17T09:00:00+05:00'),
        location: 'Медеу, Алматы',
        distance: '5 км',
        slotsTotal: 1500,
        slotsTaken: 1500,
        price: 4000,
      },
      {
        title: 'Ночной старт Астана',
        date: new Date('2025-10-05T20:00:00+05:00'),
        location: 'Набережная, Астана',
        distance: '5 км',
        slotsTotal: 1000,
        slotsTaken: 1000,
        price: 4500,
      },
    ],
  });

  console.log('Seeded 3 events.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
