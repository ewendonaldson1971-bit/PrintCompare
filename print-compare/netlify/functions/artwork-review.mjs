import { handleReview } from '../../server/artwork-review.mjs';

export default async request => handleReview(request);

// Enforced by Netlify across instances; no artwork or API keys are logged.
export const config = {
  rateLimit: { windowLimit: 60, windowSize: 3600, aggregateBy: 'ip' },
};
