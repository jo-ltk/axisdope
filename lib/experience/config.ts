/**
 * Everything personal on the page lives here. Change these and the whole experience follows.
 * Only the details from Alex's original page are used; nothing is invented.
 */
export const experienceConfig = {
  /** Shown as the giant monolith and in the photo-finish. Short names (3–6 letters) fill best. */
  name: 'ALEX',
  /** Shown in the original-page homage at the start and in the HUD labels. */
  displayName: 'Alex',
  city: 'Ottawa',
  /** IANA time zone used for the live clock. */
  timeZone: 'America/Toronto',
  /** Fixed reading from the original page. */
  temperatureC: 13,
  email: 'alexjosephreal@gmail.com',
  coords: ['45.4215° N', '75.6972° W'] as const,
  handle: 'axisdope',
  note: 'Alex does not tweet',
};

export type ExperienceConfig = typeof experienceConfig;
