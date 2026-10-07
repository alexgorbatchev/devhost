// The compiled `devtools.css`, installed into every devtools shadow root. Each build replaces this module with
// the real text: `apps/devhost/scripts/buildDevtoolsBundle.ts` for the shipped runtime and `vite.config.ts` for
// Storybook and browser tests. It is empty only where nothing is rendered, such as Bun unit tests.
const devtoolsCssText: string = "";

export default devtoolsCssText;
