/**
 * FICTIONAL DEMO DATA — used only by the public interactive demo (/demo) and
 * marketing previews. Every business, vendor, product and number here is
 * invented and generated from a fixed seed. Nothing in this folder may be
 * imported by tenant app code (enforced by tests in src/demo/demo.test.ts).
 */
import type { DailySale } from '@/lib/finance/metrics';
import type { QuantityRule } from '@/lib/wholesale/quantity';

export const DEMO_BUSINESS = { name: 'Bayside Beauty Supply', locations: ['Harbor Street', 'Westgate Plaza'] } as const;

// Mulberry32 — small deterministic PRNG so the demo looks the same on every load.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const WEEKDAY_FACTOR = [1.32, 0.78, 0.84, 0.88, 0.97, 1.18, 1.45]; // Sun..Sat

export function demoDailySales(anchor: string, days = 430): DailySale[] {
  const end = new Date(`${anchor}T00:00:00Z`).getTime();
  const out: DailySale[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = end - i * DAY;
    const d = new Date(t);
    const r = rng(Math.floor(t / DAY) * 7919);
    const yearsBack = i / 365;
    const growth = 1 - 0.07 * yearsBack; // ~7% year-over-year growth
    const season = 1 + 0.12 * Math.sin(((d.getUTCMonth() + 1) / 12) * Math.PI * 2 - 1.2);
    const base = 2350_00 * WEEKDAY_FACTOR[d.getUTCDay()] * growth * season;
    const salesCents = Math.round(base * (0.88 + r() * 0.24));
    const transactions = Math.max(12, Math.round(salesCents / (2890 + r() * 900)));
    out.push({ date: d.toISOString().slice(0, 10), salesCents, transactions });
  }
  return out;
}

export const DEMO_COGS_RATIO = 0.538;
export const DEMO_MONTHLY_OPEX = { payroll: 14_820_00, rent: 6_400_00, utilities: 910_00, cardFees: 1_960_00, other: 1_240_00 };

export interface DemoVendor {
  id: string;
  name: string;
  legalName: string;
  aliases: string[];
  terms: string;
  creditLimitCents: number;
  balanceCents: number;
  ytdCents: number;
  allTimeCents: number;
  contact: { name: string; phone: string; email: string };
  priceAlerts: { item: string; fromCents: number; toCents: number }[];
}

export const DEMO_VENDORS: DemoVendor[] = [
  { id: 'v1', name: 'Crownline Hair Co.', legalName: 'Crownline Hair Company LLC', aliases: ['CROWNLINE HAIR', 'CRWNLN*ACH'], terms: 'Net 30', creditLimitCents: 25_000_00, balanceCents: 8_412_50, ytdCents: 96_220_40, allTimeCents: 241_880_10, contact: { name: 'Dana Ruiz', phone: '(555) 014-2290', email: 'orders@crownline.example' }, priceAlerts: [{ item: 'Silky Wave 18"', fromCents: 7_40, toCents: 7_95 }] },
  { id: 'v2', name: 'Silkstrand Imports', legalName: 'Silkstrand Imports Inc.', aliases: ['SILKSTRAND IMP'], terms: 'Net 15', creditLimitCents: 15_000_00, balanceCents: 2_980_00, ytdCents: 41_310_75, allTimeCents: 88_402_00, contact: { name: 'Lee Park', phone: '(555) 017-4410', email: 'ar@silkstrand.example' }, priceAlerts: [] },
  { id: 'v3', name: 'Glow Theory Cosmetics', legalName: 'Glow Theory Beauty Group', aliases: ['GLOWTHEORY', 'GTB GROUP'], terms: 'Due on receipt', creditLimitCents: 5_000_00, balanceCents: 0, ytdCents: 18_744_20, allTimeCents: 30_118_90, contact: { name: 'Sam Okafor', phone: '(555) 019-7702', email: 'hello@glowtheory.example' }, priceAlerts: [{ item: 'Edge Control 4oz', fromCents: 2_15, toCents: 2_45 }] },
  { id: 'v4', name: 'Braidwell Supply', legalName: 'Braidwell Supply Co.', aliases: ['BRAIDWELL'], terms: 'Net 30', creditLimitCents: 20_000_00, balanceCents: 5_120_40, ytdCents: 62_005_00, allTimeCents: 150_960_35, contact: { name: 'Avery Cole', phone: '(555) 012-8831', email: 'sales@braidwell.example' }, priceAlerts: [] },
  { id: 'v5', name: 'Harbor Fixtures', legalName: 'Harbor Store Fixtures LLC', aliases: ['HARBOR FIXT'], terms: 'Net 45', creditLimitCents: 10_000_00, balanceCents: 1_450_00, ytdCents: 4_380_00, allTimeCents: 12_900_00, contact: { name: 'Jo Bennett', phone: '(555) 011-6650', email: 'billing@harborfix.example' }, priceAlerts: [] },
];

export interface DemoInvoice {
  id: string;
  vendorId: string;
  number: string;
  date: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
  lines: { sku: string; upc: string; description: string; qty: number; unitCents: number }[];
}

export function demoInvoices(anchor: string): DemoInvoice[] {
  const t = new Date(`${anchor}T00:00:00Z`).getTime();
  const d = (offset: number) => new Date(t + offset * DAY).toISOString().slice(0, 10);
  const mk = (id: string, vendorId: string, number: string, issued: number, termDays: number, paid: number, lines: DemoInvoice['lines']): DemoInvoice => {
    const totalCents = lines.reduce((a, l) => a + l.qty * l.unitCents, 0);
    return { id, vendorId, number, date: d(issued), dueDate: d(issued + termDays), totalCents, paidCents: Math.round(totalCents * paid), lines };
  };
  return [
    mk('i1', 'v1', 'CL-20814', -24, 30, 0, [
      { sku: 'CL-SW18', upc: '0 81234 50018 2', description: 'Silky Wave 18"', qty: 48, unitCents: 7_95 },
      { sku: 'CL-SW22', upc: '0 81234 50022 9', description: 'Silky Wave 22"', qty: 36, unitCents: 9_10 },
      { sku: 'CL-KC14', upc: '0 81234 51014 3', description: 'Kinky Curl Closure 14"', qty: 12, unitCents: 18_50 },
    ]),
    mk('i2', 'v4', 'BW-4471', -12, 30, 0.5, [
      { sku: 'BW-PB3X', upc: '0 77120 30003 1', description: 'Pre-stretched Braid 3X', qty: 144, unitCents: 2_35 },
      { sku: 'BW-KB52', upc: '0 77120 30052 9', description: 'Knotless Braid 52"', qty: 96, unitCents: 3_10 },
    ]),
    mk('i3', 'v2', 'SS-9930', -8, 15, 0, [
      { sku: 'SS-BW10', upc: '0 66019 10010 4', description: 'Body Wave Bundle 10"', qty: 24, unitCents: 22_00 },
      { sku: 'SS-ST14', upc: '0 66019 10414 0', description: 'Straight Bundle 14"', qty: 20, unitCents: 26_40 },
    ]),
    mk('i4', 'v3', 'GT-1182', -3, 0, 1, [
      { sku: 'GT-EC4', upc: '0 55402 00004 7', description: 'Edge Control 4oz', qty: 72, unitCents: 2_45 },
      { sku: 'GT-LG2', upc: '0 55402 00102 0', description: 'Lace Glue 1.3oz', qty: 48, unitCents: 3_60 },
    ]),
    mk('i5', 'v5', 'HF-0071', -40, 45, 0, [
      { sku: 'HF-WD60', upc: '—', description: 'Wig display head (6-pack)', qty: 5, unitCents: 29_00 },
    ]),
  ];
}

export interface DemoItem {
  sku: string;
  upc: string;
  name: string;
  department: string;
  location: string;
  onHand: number;
  reorderPoint: number;
  costCents: number;
  priceCents: number;
  lastSoldDaysAgo: number;
}

export const DEMO_INVENTORY: DemoItem[] = [
  { sku: 'CL-SW18', upc: '081234500182', name: 'Silky Wave 18"', department: 'Human hair', location: 'Harbor Street', onHand: 31, reorderPoint: 20, costCents: 7_95, priceCents: 15_99, lastSoldDaysAgo: 0 },
  { sku: 'CL-SW22', upc: '081234500229', name: 'Silky Wave 22"', department: 'Human hair', location: 'Harbor Street', onHand: 9, reorderPoint: 15, costCents: 9_10, priceCents: 18_99, lastSoldDaysAgo: 1 },
  { sku: 'CL-KC14', upc: '081234510143', name: 'Kinky Curl Closure 14"', department: 'Closures', location: 'Westgate Plaza', onHand: 4, reorderPoint: 6, costCents: 18_50, priceCents: 39_99, lastSoldDaysAgo: 3 },
  { sku: 'BW-PB3X', upc: '077120300031', name: 'Pre-stretched Braid 3X', department: 'Braiding', location: 'Harbor Street', onHand: 212, reorderPoint: 120, costCents: 2_35, priceCents: 4_99, lastSoldDaysAgo: 0 },
  { sku: 'BW-KB52', upc: '077120300529', name: 'Knotless Braid 52"', department: 'Braiding', location: 'Westgate Plaza', onHand: 58, reorderPoint: 60, costCents: 3_10, priceCents: 6_49, lastSoldDaysAgo: 0 },
  { sku: 'SS-BW10', upc: '066019100104', name: 'Body Wave Bundle 10"', department: 'Human hair', location: 'Westgate Plaza', onHand: 17, reorderPoint: 10, costCents: 22_00, priceCents: 44_99, lastSoldDaysAgo: 2 },
  { sku: 'SS-ST14', upc: '066019104140', name: 'Straight Bundle 14"', department: 'Human hair', location: 'Harbor Street', onHand: 0, reorderPoint: 8, costCents: 26_40, priceCents: 54_99, lastSoldDaysAgo: 6 },
  { sku: 'GT-EC4', upc: '055402000047', name: 'Edge Control 4oz', department: 'Hair care', location: 'Harbor Street', onHand: 64, reorderPoint: 36, costCents: 2_45, priceCents: 5_99, lastSoldDaysAgo: 0 },
  { sku: 'GT-LG2', upc: '055402001020', name: 'Lace Glue 1.3oz', department: 'Hair care', location: 'Westgate Plaza', onHand: 22, reorderPoint: 24, costCents: 3_60, priceCents: 8_99, lastSoldDaysAgo: 1 },
  { sku: 'AC-SC12', upc: '044410012128', name: 'Satin Bonnet XL', department: 'Accessories', location: 'Harbor Street', onHand: 46, reorderPoint: 12, costCents: 1_20, priceCents: 4_49, lastSoldDaysAgo: 97 },
  { sku: 'AC-WC06', upc: '044410006066', name: 'Wig Cap (2-pack)', department: 'Accessories', location: 'Westgate Plaza', onHand: 130, reorderPoint: 48, costCents: 45, priceCents: 1_99, lastSoldDaysAgo: 0 },
  { sku: 'AC-RT08', upc: '044410008084', name: 'Rat-tail Comb', department: 'Accessories', location: 'Harbor Street', onHand: 88, reorderPoint: 30, costCents: 30, priceCents: 1_49, lastSoldDaysAgo: 140 },
];

export interface DemoCatalogItem {
  sku: string;
  upc: string;
  name: string;
  brand: string;
  category: string;
  variants: string[];
  available: number;
  priceCents: number; // this customer's tier price per unit
  listCents: number;
  rule: QuantityRule;
}

export const DEMO_WHOLESALE_CUSTOMER = { name: 'Northgate Beauty (fictional)', tier: 'Tier 2', terms: 'Net 30', creditLimitCents: 30_000_00, openBalanceCents: 11_240_00 };

export const DEMO_CATALOG: DemoCatalogItem[] = [
  { sku: 'BW-PB3X', upc: '077120300031', name: 'Pre-stretched Braid 3X', brand: 'Braidwell', category: 'Braiding', variants: ['1', '1B', '2', '4', '27', '30'], available: 3120, priceCents: 2_49, listCents: 2_79, rule: { min: 12, increment: 12 } },
  { sku: 'BW-KB52', upc: '077120300529', name: 'Knotless Braid 52"', brand: 'Braidwell', category: 'Braiding', variants: ['1B', '2', 'T1B/30'], available: 1440, priceCents: 3_29, listCents: 3_59, rule: { min: 6, increment: 6 } },
  { sku: 'CL-SW18', upc: '081234500182', name: 'Silky Wave 18"', brand: 'Crownline', category: 'Human hair', variants: ['1', '1B', '2'], available: 288, priceCents: 8_40, listCents: 9_10, rule: { min: 6, increment: 6 } },
  { sku: 'CL-KC14', upc: '081234510143', name: 'Kinky Curl Closure 14"', brand: 'Crownline', category: 'Closures', variants: ['1B'], available: 60, priceCents: 19_20, listCents: 21_00, rule: { min: 6, increment: 6 } },
  { sku: 'GT-EC4', upc: '055402000047', name: 'Edge Control 4oz', brand: 'Glow Theory', category: 'Hair care', variants: ['Extra hold', 'Original'], available: 2400, priceCents: 2_55, listCents: 2_95, rule: { min: 24, increment: 24 } },
  { sku: 'GT-LG2', upc: '055402001020', name: 'Lace Glue 1.3oz', brand: 'Glow Theory', category: 'Hair care', variants: ['Clear'], available: 960, priceCents: 3_75, listCents: 4_10, rule: { min: 48, increment: 48 } },
  { sku: 'AC-WC06', upc: '044410006066', name: 'Wig Cap (2-pack)', brand: 'Harbor Basics', category: 'Accessories', variants: ['Nude', 'Black', 'Brown'], available: 5000, priceCents: 52, listCents: 60, rule: { min: 48, increment: 48 } },
];
