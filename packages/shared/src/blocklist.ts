/**
 * "Never show" keyword blocklist — junk keywords that must never appear in
 * results, regardless of volume or relevance tier. These are mostly tokenization
 * artifacts from the upstream data: bare stopwords/conjunctions that leak in as
 * standalone "keywords", and contraction fragments (e.g. "don" from "don't",
 * where the apostrophe was stripped upstream).
 *
 * Matching is EXACT and case-insensitive against the WHOLE keyword string (so a
 * real phrase like "coping skills for kids" is untouched — only the bare token
 * "for" would be blocked). Applied server-side in /api/search.
 *
 * ➜ Add new junk here as you spot it. Keep entries lowercase.
 */
export const NEVER_SHOW_KEYWORDS: ReadonlySet<string> = new Set([
  // articles / conjunctions / prepositions
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with",
  "at", "by", "as", "so", "than", "then", "up", "out", "off", "too",
  // bare verbs / auxiliaries
  "is", "it", "be", "am", "are", "was", "were", "do", "does", "did", "has", "have", "had",
  // pronouns / determiners
  "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "we", "us", "our",
  "they", "them", "their", "this", "that", "these", "those", "no", "not",
  // question words
  "how", "what", "why", "when", "where", "who", "which",
  // contraction fragments (apostrophe stripped upstream): don't → "don", etc.
  "don", "won", "isn", "aren", "wasn", "weren", "doesn", "didn", "hasn", "haven",
  "hadn", "couldn", "wouldn", "shouldn", "mustn", "needn", "can", "cant",
  "ll", "ve", "re", "s", "t", "m", "d",
  // Amazon UI / carousel labels that leak in as "keywords"
  "recommended for you",
]);

/** True if a keyword should be dropped from results entirely. */
export function isNeverShow(keyword: string): boolean {
  return NEVER_SHOW_KEYWORDS.has(keyword.trim().toLowerCase());
}
