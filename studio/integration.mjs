export default function studio() {
  return {
    name: 'will-local-studio',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command === 'dev' && process.env.STUDIO_PREVIEW === '1') {
          injectRoute({ pattern: '/__studio/preview', entrypoint: new URL('./preview.astro', import.meta.url), prerender: false });
        }
      }
    }
  };
}
