import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.event.count();
  if (existing > 0) {
    console.log(`Skip seed: ${existing} events already present.`);
    return;
  }

  // Сезон 5&5 2027 — пять парков мая–сентября. Абонемент 20 000₸
  // против 5×5000 = 25 000₸ по отдельности → экономия 5 000₸.
  const season = await prisma.season.create({
    data: {
      title: '5&5 2027',
      year: 2027,
      price: 20000,
      isActive: true,
      events: {
        create: [
          {
            title: 'Триатлон Парк Астана',
            date: new Date('2027-05-23T09:00:00+05:00'),
            location: 'Триатлон Парк, Астана',
            distance: '5 км',
            slotsTotal: 2000,
            price: 5000,
          },
          {
            title: 'Президентский парк',
            date: new Date('2027-06-13T08:00:00+05:00'),
            location: 'Президентский парк, Астана',
            distance: '5 км',
            slotsTotal: 2000,
            price: 5000,
          },
          {
            title: 'Ботанический сад',
            date: new Date('2027-07-18T08:00:00+05:00'),
            location: 'Ботанический сад, Астана',
            distance: '5 км',
            slotsTotal: 2000,
            price: 5000,
          },
          {
            title: 'Центральный парк',
            date: new Date('2027-08-22T08:00:00+05:00'),
            location: 'Центральный парк, Астана',
            distance: '5 км',
            slotsTotal: 2000,
            price: 5000,
          },
          {
            title: 'Триатлон Парк — финал сезона',
            date: new Date('2027-09-05T09:00:00+05:00'),
            location: 'Триатлон Парк, Астана',
            distance: '5 км',
            slotsTotal: 2000,
            price: 5000,
          },
        ],
      },
    },
    include: { events: true },
  });

  console.log(
    `Seeded season "${season.title}" (id=${season.id}) with ${season.events.length} events.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
