import globby from "globby";
import path from "path";
import { fileURLToPath } from "url";
import debugFactory from "debug";
import getGeneratedList from "./generate/get-generated-list.js";
import { getEntryData } from "./parse/get-entry-data.js";
import { detectDuplicateStoryNames, printError } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const debug = debugFactory("ladle:vite");

/**
 * @param errorMessage {string}
 */
const defaultListModule = (errorMessage) => `
import { lazy } from "react";
import * as React from "react";
export const list = [];
export const config = {};
export const stories = {};
export const storySource = {};
export const errorMessage = \`${errorMessage}\`;
export const Provider = ({ children }: { children: any }) =>
  /*#__PURE__*/ React.createElement(React.Fragment, null, children);
`;

/**
 * @param config {import("../../shared/types").Config}
 * @param configFolder {string}
 * @param mode {string}
 */
function ladlePlugin(config, configFolder, mode) {
  const virtualModuleId = "virtual:generated-list";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  return {
    name: "ladle-plugin",
    /**
     * @param {string} id
     */
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return null;
    },
    /**
     * @param {string} code
     * @param {string} id
     */
    async transform(code, id) {
      // We instrument stories with a simple eventemitter like code so
      // some addons (like a11y) can subscribe to changes and re-run
      // on HMR updates
      if (id.includes(".stories.")) {
        const from = path
          .relative(id, path.join(__dirname, "../../app/src"))
          .slice(3);
        const watcherImport = `import { storyUpdated } from "${from}/story-hmr";`;
        // if stories are defined through .bind({}) we need to force full reloads since
        // react-refresh can't pick it up
        const invalidateHmr = code.includes(".bind({})")
          ? `if (import.meta.hot) {
          import.meta.hot.on("vite:beforeUpdate", () => {
            import.meta.hot.invalidate();
          });
        }`
          : "";
        return {
          code: `${code}\n${invalidateHmr}\n${watcherImport}\nif (import.meta.hot) {
          import.meta.hot.accept(() => {
            storyUpdated();
          });
        }`,
          map: null,
        };
      }
      return { code, map: null };
    },
    /**
     * @param {string} id
     */
    async load(id) {
      if (id === resolvedVirtualModuleId) {
        debug(`transforming: ${id}`);
        try {
          debug("Initial generation of the list");
          const entryData = await getEntryData(await globby([config.stories]));
          detectDuplicateStoryNames(entryData);
          return getGeneratedList(entryData, configFolder, config);
        } catch (/** @type {any} */ e) {
          printError("\nStory discovering failed:\n");
          printError(e);
          printError("\nMore info: https://ladle.dev/docs/stories#limitations");
          if (mode === "production") {
            process.exit(1);
          }
          return /** @type {string} */ (defaultListModule(e.message));
        }
      }
      return;
    },
  };
}

export default ladlePlugin;
