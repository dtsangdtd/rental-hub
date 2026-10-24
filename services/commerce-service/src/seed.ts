import { createLogger, createPool, env } from '@rental/common';

const logger = createLogger('commerce-seed');
const pool = createPool(
  env(['COMMERCE_DATABASE_URL', 'DATABASE_URL'], 'postgres://rental:rental@localhost:5432/commerce_db'),
);

async function seed() {
  logger.info('Running optional demo commerce seed...');

  // 1. Categories
  const categories = [
    { slug: 'instant-food', name: 'Mì & Đồ ăn liền', icon_name: 'soup', sort_order: 1 },
    { slug: 'beverage', name: 'Đồ uống & Giải khát', icon_name: 'cup', sort_order: 2 },
    { slug: 'snacks', name: 'Bánh kẹo & Đồ ăn vặt', icon_name: 'cookie', sort_order: 3 },
    { slug: 'hygiene', name: 'Hóa phẩm & Vệ sinh', icon_name: 'droplet', sort_order: 4 },
    { slug: 'household', name: 'Tiêu hao phòng trọ', icon_name: 'home', sort_order: 5 },
    { slug: 'combos', name: 'Combo sinh viên / Dọn phòng', icon_name: 'gift', sort_order: 6 },
  ];

  for (const c of categories) {
    await pool.query(
      `INSERT INTO grocery_categories (slug, name, icon_name, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [c.slug, c.name, c.icon_name, c.sort_order],
    );
  }

  logger.info('Demo categories seeded.');
  await pool.end();
}

seed().catch((err) => {
  logger.error(err, 'Failed to run commerce seed');
  process.exit(1);
});
