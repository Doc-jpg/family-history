// General historical context shown on the timeline. These are broad, well-known
// events offered as background, labeled "context" in the UI, never as family facts.
// Regional entries are included because the family's first known point is Missouri;
// they stay useful for Kansas, Oklahoma and the Plains if research leads there.
export interface ContextEvent { from: number; to?: number; title: string; region?: string }

export const CONTEXT_EVENTS: ContextEvent[] = [
  { from: 1803, title: 'Louisiana Purchase brings the Missouri country into the United States' },
  { from: 1821, title: 'Missouri becomes a state' },
  { from: 1830, to: 1850, title: 'Peak decades of German immigration to Missouri' },
  { from: 1845, to: 1852, title: 'Irish Great Famine drives emigration to America' },
  { from: 1854, title: 'Kansas Territory opens to settlement' },
  { from: 1861, to: 1865, title: 'American Civil War; Missouri a divided border state' },
  { from: 1862, title: 'Homestead Act opens western land to settlers' },
  { from: 1889, title: 'Oklahoma Land Run of 1889' },
  { from: 1907, title: 'Oklahoma becomes a state' },
  { from: 1914, to: 1918, title: 'First World War (US enters 1917)' },
  { from: 1918, to: 1919, title: 'Influenza pandemic' },
  { from: 1929, to: 1939, title: 'Great Depression' },
  { from: 1930, to: 1936, title: 'Dust Bowl across the southern Plains', region: 'Plains' },
  { from: 1939, to: 1945, title: 'Second World War (US enters 1941)' },
  { from: 1950, to: 1953, title: 'Korean War' },
  { from: 1955, to: 1975, title: 'Vietnam War era' },
];
