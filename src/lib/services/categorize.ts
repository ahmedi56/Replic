/**
 * Category suggestion.
 *
 * A keyword pass over the normalized merchant. It is a *suggestion*: the value is written
 * once, on creation, and any later change by the user wins and is never overwritten by a
 * re-run. Cheap, explainable, and good enough that sending this to an LLM would be waste.
 */
const RULES: Array<{ category: string; patterns: RegExp }> = [
  { category: 'Food', patterns: /\b(carrefour|monoprix|auchan|lidl|aldi|tesco|walmart|costco|restaurant|cafe|coffee|starbucks|mcdonalds|burger|pizza|bakery|boulangerie|deli|grocer|supermarket|food|eats|deliveroo|just eat|subway)\b/ },
  { category: 'Transport', patterns: /\b(uber|lyft|bolt|taxi|metro|subway rail|train|sncf|rail|bus|parking|toll|fuel|petrol|gas station|shell|esso|totalenergies|car rental|hertz|avis)\b/ },
  { category: 'Software', patterns: /\b(adobe|figma|notion|slack|github|gitlab|atlassian|jira|dropbox|google|microsoft|openai|anthropic|aws|amazon web services|digitalocean|heroku|vercel|cloudflare|godaddy|namecheap|stripe|twilio|canva|zoom|saas|subscription|netflix|spotify)\b/ },
  { category: 'Travel', patterns: /\b(airbnb|booking|hotel|hostel|ryanair|easyjet|lufthansa|air france|tunisair|airline|flight|expedia|trivago)\b/ },
  { category: 'Office', patterns: /\b(staples|office|stationery|ikea|paper|printing|print|post|postal|courier|dhl|fedex|ups)\b/ },
  { category: 'Equipment', patterns: /\b(apple|dell|lenovo|hp|laptop|monitor|hardware|electronics|fnac|decathlon|darty)\b/ },
  { category: 'Marketing', patterns: /\b(meta|facebook|linkedin|twitter|x corp|google ads|adwords|mailchimp|hubspot|advert|campaign|sponsored)\b/ },
  { category: 'Utilities', patterns: /\b(electric|electricity|water|gas bill|internet|broadband|telecom|orange|vodafone|ooredoo|mobile|phone bill|energy|steg|sonede)\b/ },
];

export function suggestCategory(merchantNorm: string | null | undefined, description?: string | null): string | null {
  const haystack = `${merchantNorm ?? ''} ${description ?? ''}`.toLowerCase();
  if (!haystack.trim()) return null;
  for (const rule of RULES) {
    if (rule.patterns.test(haystack)) return rule.category;
  }
  return null;
}
