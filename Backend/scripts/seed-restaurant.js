/**
 * Create (or update) a ready-to-use demo restaurant with a menu of real food photos:
 *
 *   npm run seed:restaurant
 *   npm run seed:restaurant -- --phone=8817921168 --name="Mayur Food Delivery" [--zone="Indore"]
 *
 * - Login: restaurant app -> phone number -> OTP. With USE_DEFAULT_OTP=true (dev) the OTP is 1234.
 * - The restaurant is created already approved, accepting orders and open all day.
 * - It is placed inside a service zone (the one named by --zone, else the first active zone) so
 *   customers in that zone can see it. With no active zone it is still created, but customers
 *   will not see it until a zone exists - the script says so.
 * - Re-running is safe: the restaurant is matched by phone and menu items by name, never duplicated.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { isPointInZone } from '../src/modules/food/shared/zoneLocation.js';
import { seedOutletTimingsForRestaurant } from '../src/modules/food/restaurant/services/outletTimings.service.js';

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, ...rest] = arg.replace(/^--/, '').split('=');
        return [key, rest.join('=') || true];
    })
);
// PowerShell strips the bare `--`, so npm exposes flags as npm_config_<key>.
const arg = (key) => args[key] || process.env[`npm_config_${key}`] || '';

const phone = String(arg('phone') || '8817921168').replace(/\D/g, '').slice(-10);
const restaurantName = String(arg('name') || 'Mayur Food Delivery').trim();
const zoneArg = String(arg('zone') || '').trim();

if (phone.length !== 10) {
    console.error('Phone must be a 10 digit number.');
    process.exit(1);
}

const photo = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

// Photo ids were checked by eye so each dish name matches its picture.
const IMG = {
    paneerButterMasala: '1631452180519-c014fe946bc7',
    paneerTikka: '1567188040759-fb8a883dc6d8',
    vegBiryani: '1563379091339-03b21ab4a4f8',
    vegPizza: '1565299624946-b28f40a0ae38',
    samosa: '1601050690597-df0568f70950',
    veggieSalad: '1512621776951-a57141f2eefd',
    chickenBiryani: '1589302168068-964664d93dc0',
    friedChicken: '1626082927389-6cd097cdc6ec',
    kebabPlatter: '1555939594-58d7cb561ad1',
};

const MENU = [
    { name: 'Paneer Butter Masala', category: 'Main Course', price: 220, foodType: 'Veg', img: IMG.paneerButterMasala, recommended: true, prep: '20-25 mins', description: 'Soft paneer cubes in a rich, creamy tomato-butter gravy. Served with naan.' },
    { name: 'Paneer Tikka', category: 'Starters', price: 240, foodType: 'Veg', img: IMG.paneerTikka, recommended: true, prep: '15-20 mins', description: 'Char-grilled paneer, peppers and onions marinated in spiced yogurt.' },
    { name: 'Veg Biryani', category: 'Biryani & Rice', price: 190, foodType: 'Veg', img: IMG.vegBiryani, recommended: true, prep: '25-30 mins', description: 'Fragrant basmati rice slow-cooked with vegetables and whole spices.' },
    { name: 'Veg Pizza', category: 'Pizza', price: 249, foodType: 'Veg', img: IMG.vegPizza, recommended: false, prep: '20-25 mins', description: 'Hand-stretched crust with onion, capsicum, sweet corn and mozzarella.' },
    { name: 'Samosa (2 pcs)', category: 'Snacks', price: 50, foodType: 'Veg', img: IMG.samosa, recommended: false, prep: '10-15 mins', description: 'Crisp pastry stuffed with spiced potato and peas. Served with chutney.' },
    { name: 'Fresh Veggie Salad Bowl', category: 'Salads', price: 150, foodType: 'Veg', img: IMG.veggieSalad, recommended: false, prep: '10-15 mins', description: 'Crunchy seasonal vegetables, avocado and chickpeas with a light dressing.' },
    { name: 'Chicken Biryani', category: 'Biryani & Rice', price: 260, foodType: 'Non-Veg', img: IMG.chickenBiryani, recommended: true, prep: '25-30 mins', description: 'Dum-cooked basmati rice layered with tender marinated chicken.' },
    { name: 'Crispy Fried Chicken', category: 'Starters', price: 280, foodType: 'Non-Veg', img: IMG.friedChicken, recommended: false, prep: '20-25 mins', description: 'Golden, crunchy fried chicken pieces seasoned with house spices.' },
    { name: 'Mixed Grill Kebab Platter', category: 'Starters', price: 320, foodType: 'Non-Veg', img: IMG.kebabPlatter, recommended: false, prep: '25-30 mins', description: 'Assorted grilled kebabs served with mint chutney and dips.' },
];

/** Average of the polygon's points; falls back to the first point when that lands outside a concave zone. */
const pointInside = (zone) => {
    const ring = zone.coordinates || [];
    const lat = ring.reduce((s, c) => s + Number(c.latitude), 0) / ring.length;
    const lng = ring.reduce((s, c) => s + Number(c.longitude), 0) / ring.length;
    if (isPointInZone(lat, lng, zone)) return { lat, lng };
    return null;
};

await connectDB();
try {
    let zone = null;
    if (zoneArg) {
        const rx = new RegExp(`^${zoneArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        zone = await FoodZone.findOne({ isActive: true, $or: [{ name: rx }, { zoneName: rx }, { serviceLocation: rx }] }).lean();
        if (!zone) console.warn(`No active zone named "${zoneArg}" - falling back to the first active zone.`);
    }
    if (!zone) zone = await FoodZone.findOne({ isActive: true }).sort({ createdAt: 1 }).lean();

    const spot = zone ? pointInside(zone) : null;
    const zoneLabel = zone ? (zone.name || zone.zoneName || zone.serviceLocation) : '';

    const hero = photo(IMG.chickenBiryani, 1200);
    const base = {
        restaurantName,
        ownerName: 'Mayur',
        ownerPhone: phone,
        primaryContactNumber: phone,
        foodType: 'Mixed',
        pureVegRestaurant: false,
        pureVeganRestaurant: false,
        cuisines: ['North Indian', 'Biryani', 'Pizza', 'Snacks'],
        openingTime: '00:00',
        closingTime: '23:59',
        openDays: [],
        isAcceptingOrders: true,
        estimatedDeliveryTime: '30-35 mins',
        estimatedDeliveryTimeMinutes: 35,
        featuredDish: 'Chicken Biryani',
        featuredPrice: 260,
        rating: 4.5,
        totalRatings: 120,
        profileImage: photo(IMG.paneerButterMasala, 400),
        coverImages: [hero, photo(IMG.vegPizza, 1200), photo(IMG.paneerTikka, 1200)],
        menuImages: MENU.slice(0, 4).map((m) => photo(m.img, 1000)),
        status: 'approved',
        approvedAt: new Date(),
        ...(zone ? { zoneId: zone._id } : {}),
        ...(spot
            ? {
                  location: {
                      type: 'Point',
                      coordinates: [spot.lng, spot.lat],
                      latitude: spot.lat,
                      longitude: spot.lng,
                      formattedAddress: `${restaurantName}, ${zoneLabel}`,
                      address: `${restaurantName}, ${zoneLabel}`,
                      addressLine1: restaurantName,
                      area: zoneLabel,
                      city: zoneLabel,
                  },
              }
            : {}),
    };

    let restaurant = await FoodRestaurant.findOne({ ownerPhoneLast10: phone });
    const created = !restaurant;
    if (!restaurant) restaurant = new FoodRestaurant(base);
    else restaurant.set(base);
    await restaurant.save();

    await seedOutletTimingsForRestaurant(restaurant._id, {
        openingTime: base.openingTime,
        closingTime: base.closingTime,
        openDays: base.openDays,
    });

    let createdItems = 0;
    for (const entry of MENU) {
        const doc = {
            restaurantId: restaurant._id,
            name: entry.name,
            categoryName: entry.category,
            description: entry.description,
            price: entry.price,
            image: photo(entry.img),
            foodType: entry.foodType,
            isAvailable: true,
            isRecommended: entry.recommended,
            preparationTime: entry.prep,
            approvalStatus: 'approved',
            approvedAt: new Date(),
            zoneId: zone?._id ?? null,
        };
        const existing = await FoodItem.findOne({ restaurantId: restaurant._id, name: entry.name }).select('_id').lean();
        if (existing) await FoodItem.updateOne({ _id: existing._id }, { $set: doc });
        else {
            await FoodItem.create(doc);
            createdItems += 1;
        }
    }

    console.log(`${created ? 'Created' : 'Updated'} restaurant "${restaurant.restaurantName}" (${restaurant._id})`);
    console.log(`Menu: ${MENU.length} dishes with photos (${createdItems} new)`);
    console.log(`Login: phone ${phone}, OTP 1234 (works while USE_DEFAULT_OTP=true / for default test phones)`);
    if (zone && spot) console.log(`Zone: ${zoneLabel} - customers inside it can see this restaurant`);
    else if (zone) console.warn(`Zone "${zoneLabel}" found but its shape has no inside point; restaurant saved with zoneId only.`);
    else console.warn('No active zone exists: create a zone in the admin panel, then run this script again so customers can see the restaurant.');
} catch (error) {
    console.error(`Seeding restaurant failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
