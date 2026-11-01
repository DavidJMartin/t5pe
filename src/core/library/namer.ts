// Random two-word patch names (design.md §3.8): "Windy Morning", "Red Car", "Blue Brush". They don't need
// to mean anything, just be distinctive enough to stick. No AI: curated word lists, seeded from the patch's
// id so a patch always gets the same first suggestion; `attempt` rolls the next one.
import { rng } from '../random';
import { NAME_LENGTH } from '../sysex/constants';

const ADJECTIVES = [
  // colours
  'Red', 'Blue', 'Green', 'Amber', 'Golden', 'Silver', 'Copper', 'Crimson', 'Scarlet', 'Violet', 'Indigo', 'Teal',
  'Olive', 'Coral', 'Ivory', 'Ochre', 'Rusty', 'Rosy', 'Pale', 'Dusky', 'Inky', 'Pink', 'Orange', 'Lemon', 'Mint',
  'Plum', 'Cobalt', 'Jade', 'Pearl', 'Sandy', 'Ashen', 'Navy', 'Saffron', 'Lilac', 'Bronze', 'Grey', 'Black', 'White',
  // weather and time
  'Windy', 'Rainy', 'Misty', 'Foggy', 'Sunny', 'Stormy', 'Frosty', 'Snowy', 'Cloudy', 'Hazy', 'Breezy', 'Humid',
  'Icy', 'Dewy', 'Early', 'Late', 'Midnight', 'Morning', 'Evening', 'Autumn', 'Winter', 'Summer', 'Spring', 'Sunday',
  'Rainbow', 'Moonlit', 'Starry', 'Twilight',
  // textures and materials
  'Velvet', 'Woolly', 'Silky', 'Glassy', 'Wooden', 'Paper', 'Rubber', 'Leather', 'Marble', 'Concrete', 'Chrome',
  'Brass', 'Tin', 'Cotton', 'Satin', 'Feather', 'Stone', 'Clay', 'Crystal', 'Neon', 'Plastic', 'Linen', 'Fuzzy',
  'Smooth', 'Rough', 'Bumpy', 'Sticky', 'Crispy', 'Crunchy', 'Soft', 'Hollow', 'Dusty', 'Muddy', 'Sparkly', 'Shiny',
  'Faded', 'Polished', 'Woven', 'Knitted', 'Frozen', 'Melted', 'Toasted', 'Salty', 'Sweet', 'Sour', 'Spicy', 'Honey',
  // moods and character
  'Lazy', 'Sleepy', 'Brave', 'Shy', 'Clever', 'Quiet', 'Loud', 'Gentle', 'Wild', 'Calm', 'Happy', 'Lonely', 'Lucky',
  'Curious', 'Fancy', 'Humble', 'Jolly', 'Merry', 'Moody', 'Proud', 'Silly', 'Tender', 'Wise', 'Zesty', 'Bold',
  'Dreamy', 'Eager', 'Fearless', 'Gloomy', 'Hasty', 'Restless', 'Patient', 'Nervous', 'Secret', 'Hidden', 'Lost',
  'Distant', 'Ancient', 'Modern', 'Tiny', 'Giant', 'Little', 'Big', 'Tall', 'Long', 'Wide', 'Narrow', 'Heavy', 'Light',
  'Swift', 'Slow', 'Spinning', 'Floating', 'Falling', 'Rolling', 'Drifting', 'Humming', 'Whispering', 'Dancing',
  'Glowing', 'Burning', 'Sleeping', 'Wandering', 'Broken', 'Borrowed', 'Electric', 'Magnetic', 'Lunar', 'Solar',
  'Northern', 'Southern', 'Coastal', 'Urban', 'Rural', 'Royal', 'Rustic', 'Vintage', 'Retro', 'Cosmic',
];

/** Nouns in loose themes, so the namer can lean towards a patch's type while staying random. */
const NOUNS: Record<'sky' | 'land' | 'things' | 'creatures' | 'places', readonly string[]> = {
  sky: [
    'Morning', 'Evening', 'Sunrise', 'Sunset', 'Dawn', 'Dusk', 'Cloud', 'Rain', 'Storm', 'Thunder', 'Breeze', 'Wind',
    'Fog', 'Mist', 'Snow', 'Frost', 'Hail', 'Rainbow', 'Comet', 'Moon', 'Star', 'Planet', 'Galaxy', 'Aurora', 'Eclipse',
    'Horizon', 'Sky', 'Weather', 'Season', 'Shadow', 'Halo', 'Orbit', 'Nebula', 'Glow', 'Haze', 'Drizzle', 'Gale',
  ],
  land: [
    'River', 'Lake', 'Ocean', 'Wave', 'Tide', 'Shore', 'Beach', 'Island', 'Valley', 'Hill', 'Mountain', 'Canyon',
    'Desert', 'Forest', 'Meadow', 'Field', 'Garden', 'Orchard', 'Glacier', 'Cave', 'Cliff', 'Reef', 'Pond', 'Stream',
    'Marsh', 'Dune', 'Volcano', 'Prairie', 'Tundra', 'Lagoon', 'Waterfall', 'Fern', 'Moss', 'Willow', 'Oak', 'Pine',
    'Maple', 'Tulip', 'Daisy', 'Clover', 'Thistle', 'Bamboo', 'Pebble', 'Boulder', 'Ember', 'Spring',
  ],
  things: [
    'Car', 'Brush', 'Kettle', 'Lantern', 'Bicycle', 'Teapot', 'Umbrella', 'Compass', 'Anchor', 'Balloon', 'Button',
    'Candle', 'Clock', 'Crayon', 'Cushion', 'Drum', 'Envelope', 'Feather', 'Fork', 'Glove', 'Hammer', 'Kite', 'Ladder',
    'Marble', 'Mirror', 'Notebook', 'Paintbrush', 'Pencil', 'Piano', 'Pillow', 'Radio', 'Ribbon', 'Rocket', 'Sandal',
    'Scarf', 'Spoon', 'Suitcase', 'Teacup', 'Telescope', 'Thimble', 'Toaster', 'Trumpet', 'Tractor', 'Typewriter',
    'Violin', 'Wagon', 'Whistle', 'Engine', 'Magnet', 'Postcard', 'Lighthouse', 'Jukebox', 'Cassette', 'Bell',
    'Tambourine', 'Satellite', 'Yacht', 'Tram', 'Bus', 'Train', 'Submarine', 'Zeppelin', 'Bottle', 'Jar', 'Basket',
    'Blanket', 'Bucket', 'Chair', 'Cupboard', 'Door', 'Window', 'Lamp', 'Key', 'Lock', 'Coin', 'Ring', 'Crown',
  ],
  creatures: [
    'Fox', 'Owl', 'Whale', 'Otter', 'Badger', 'Heron', 'Moth', 'Beetle', 'Bear', 'Wolf', 'Hare', 'Raven', 'Crow',
    'Swan', 'Gull', 'Lark', 'Robin', 'Wren', 'Finch', 'Sparrow', 'Falcon', 'Eagle', 'Hawk', 'Seal', 'Walrus', 'Octopus',
    'Jellyfish', 'Lobster', 'Crab', 'Shark', 'Dolphin', 'Turtle', 'Tortoise', 'Lizard', 'Gecko', 'Frog', 'Toad',
    'Salmon', 'Trout', 'Bison', 'Moose', 'Elk', 'Camel', 'Llama', 'Panda', 'Tiger', 'Lion', 'Leopard', 'Elephant',
    'Rhino', 'Hippo', 'Giraffe', 'Zebra', 'Gorilla', 'Lemur', 'Sloth', 'Koala', 'Kangaroo', 'Penguin', 'Puffin',
    'Pelican', 'Flamingo', 'Parrot', 'Peacock', 'Bee', 'Wasp', 'Firefly', 'Snail', 'Squid', 'Mammoth', 'Dragon',
  ],
  places: [
    'Harbour', 'Station', 'Market', 'Library', 'Museum', 'Cinema', 'Cafe', 'Diner', 'Bakery', 'Workshop', 'Attic',
    'Cellar', 'Kitchen', 'Hallway', 'Balcony', 'Rooftop', 'Chapel', 'Castle', 'Tower', 'Bridge', 'Tunnel', 'Pier',
    'Arcade', 'Carousel', 'Circus', 'Theatre', 'Ballroom', 'Greenhouse', 'Laundry', 'Garage', 'Studio', 'Village',
    'Avenue', 'Alley', 'Plaza', 'Motel', 'Hotel', 'Airport', 'Observatory', 'Planetarium', 'Lagoon', 'Cottage',
    'Farmhouse', 'Mill', 'Barn', 'Stable', 'Dockyard', 'Warehouse', 'Factory', 'Gallery', 'Courtyard', 'Terrace',
  ],
};
type Theme = keyof typeof NOUNS;
const ALL_THEMES = Object.keys(NOUNS) as Theme[];

/** Themes each category leans towards (design.md §3.8, "optional flavour"); unlisted categories use all. */
const LEANING: Record<string, Theme[]> = {
  pad: ['sky', 'land'],
  bass: ['creatures', 'things', 'land'],
  keys: ['things', 'places'],
  organ: ['places', 'things'],
  lead: ['things', 'sky', 'creatures'],
  pluck: ['things', 'creatures'],
  bell: ['things', 'sky'],
  percussive: ['things', 'creatures'],
};

/**
 * A two-word name for a patch, never one in `taken` (compared case-insensitively). The same id, category
 * and attempt always give the same name; increase `attempt` for "another".
 */
export function suggestName(id: string, category: string | null, taken: ReadonlySet<string>, attempt = 0): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const random = rng(parseInt(id.slice(0, 8), 16) || 1);
  const themes = (category && LEANING[category]) || ALL_THEMES;
  let skipped = 0;
  for (let tries = 0; tries < 10_000; tries++) {
    // Mostly the leaning themes, sometimes any theme, so names stay varied.
    const pool = random() < 0.75 ? themes : ALL_THEMES;
    const nouns = NOUNS[pool[Math.floor(random() * pool.length)]];
    const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
    const noun = nouns[Math.floor(random() * nouns.length)];
    const name = `${adjective} ${noun}`;
    if (adjective === noun || name.length > NAME_LENGTH || used.has(name.toLowerCase())) continue;
    if (skipped++ === attempt) return name;
  }
  return `Patch ${id.slice(0, 6)}`; // practically unreachable: tens of thousands of combinations
}

