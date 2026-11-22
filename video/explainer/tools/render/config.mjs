// Shared settings for the renderer.
export const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
export const SCRATCH = process.env.RENDER_SCRATCH ?? '/tmp/claude-1000/-home-bl9-Documents-vibeproof/0dc13e05-c86f-4f97-b527-7962fbc04892/scratchpad/render';
export const CACHE = `${SCRATCH}/cache`;
export const FPS = 30;
export const CHROME_ARGS = [
  '--force-device-scale-factor=1',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-gpu',
  '--font-render-hinting=none',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--no-first-run',
  '--no-default-browser-check',
];
