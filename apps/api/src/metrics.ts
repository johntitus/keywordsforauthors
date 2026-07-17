import { type BookFormat, type SerpBook } from "@kfa/shared";
import { SERP_ORGANIC_TYPE } from "@kfa/shared";

const KNOWN_FORMATS: BookFormat[] = [
  "Paperback",
  "Kindle",
  "Audiobook",
  "Hardcover",
  "Cards",
];

/** Is this organic result an actual book (vs. a blank journal/notebook)? */
function isBook(formats: BookFormat[]): boolean {
  return formats.some((f) => f === "Paperback" || f === "Kindle" || f === "Hardcover" || f === "Audiobook");
}

function normalizeFormats(labels: unknown): BookFormat[] {
  if (!Array.isArray(labels)) return ["Unknown"];
  const mapped = labels
    .map((l) => KNOWN_FORMATS.find((f) => f.toLowerCase() === String(l).toLowerCase()))
    .filter((f): f is BookFormat => Boolean(f));
  return mapped.length ? mapped : ["Unknown"];
}

/** Map a raw amazon_serp item to our trimmed SerpBook shape. */
export function toSerpBook(it: any): SerpBook {
  return {
    rankAbsolute: it.rank_absolute ?? 0,
    title: it.title ?? "",
    asin: it.data_asin ?? it.asin ?? "",
    priceFrom: it.price_from ?? null,
    ratingValue: it.rating?.value ?? null,
    ratingVotes: it.rating?.votes_count ?? null,
    formats: normalizeFormats(it.labels),
    isBestSeller: Boolean(it.is_best_seller),
    isAmazonChoice: Boolean(it.is_amazon_choice),
    imageUrl: it.image_url ?? null,
    url: it.url ?? null,
  };
}

export interface DeepDiveMetrics {
  serpPurity: number;
  avgReviews: number | null;
  avgPrice: number | null;
  titleDensity: number;
}

/**
 * Compute the deep-dive metrics from organic book results (brief §3.3).
 * SERP purity — the signature insight — is book-format results ÷ total organic.
 */
export function computeMetrics(books: SerpBook[], keyword: string): DeepDiveMetrics {
  const total = books.length;
  const realBooks = books.filter((b) => isBook(b.formats));
  const serpPurity = total === 0 ? 0 : realBooks.length / total;

  const votes = realBooks.map((b) => b.ratingVotes).filter((v): v is number => v != null);
  const prices = realBooks.map((b) => b.priceFrom).filter((p): p is number => p != null);
  const phrase = keyword.toLowerCase();

  return {
    serpPurity,
    avgReviews: votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : null,
    avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    titleDensity: books.filter((b) => b.title.toLowerCase().includes(phrase)).length,
  };
}

export { SERP_ORGANIC_TYPE };
