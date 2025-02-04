("use strict");
const nodePath = require("path");
const fg = require("fast-glob");
const { readFile } = require("fs/promises");
const { optimize, loadConfig } = require("svgo");
const usvgWasm = require("usvg-wasm");

function compileSvg(source) {
  const svgWithProps = source.replace(/(?<=<svg[^>]*?)(>)/i, " {...props}>");
  return `export default (props = {}) => ${svgWithProps}`;
}

async function optimizeSvg(content, path) {
  const config = await loadConfig();
  const { data } = await optimize(content, Object.assign({}, config, { path }));
  return data;
}

function parseId(id) {
  let idx = id.indexOf("?");
  if (idx < 0) {
    idx = id.length;
  }
  const path = id.substr(0, idx);
  const qs = id.substr(idx + 1);
  return { path, qs };
}

module.exports = (options = {}) => {
  const { defaultExport = "component", svgo = true, usvg = true } = options;

  const isComponentMode = (qs) => {
    const params = new URLSearchParams(qs);
    if (params.has("component")) {
      return true;
    }
    if (params.has("url")) {
      return false;
    }
    return defaultExport == "component";
  };

  return {
    enforce: "pre",
    name: "solid-svg",
    resolveId(id, importer) {
      const { path, qs } = parseId(id);
      if (!path.endsWith(".svg") && !path.endsWith(".svg.tsx")) {
        return null;
      }

      const resolvedPath = nodePath.relative(
        nodePath.resolve("."),
        nodePath.resolve(nodePath.dirname(importer), id)
      );

      if (id.indexOf("[name]") >= 0) {
        return resolvedPath;
      }

      if (isComponentMode(qs)) {
        const resolvedPathAsComponent = resolvedPath.replace(
          /\.svg(\.tsx)?/,
          ".svg.tsx"
        );
        return resolvedPathAsComponent;
      }

      // if mode is url, we use the default behavior
      return null;
    },

    async load(id) {
      const { path, qs } = parseId(id);
      if (!path.endsWith(".svg") && !path.endsWith(".svg.tsx")) {
        return null;
      }

      if (id.indexOf("[name]") >= 0) {
        const pattern = path.replace("[name].svg", "*.svg");
        const files = fg.sync(pattern);
        const regex = new RegExp(id.replace("[name].svg", "(.*)\\.svg"));
        let source = "export default {\n";
        files.forEach((file) => {
          const matched = regex.exec(file);
          const name = matched[1];
          source += `"${name}": () => import("./${name}.svg${qs}"),\n`;
        });
        source += "}";

        return source;
      }

      if (isComponentMode(qs)) {
        const svgPath = path.replace(".svg.tsx", ".svg");
        const code = await readFile(svgPath);

        let svg;
        if (svgo) {
          svg = await optimizeSvg(code, svgPath);
        } else {
          svg = code.toString("utf-8");
        }

        if (usvg) {
          // Need to insert this since usvg needs the xmlns attribute on the root element
          svg = svg.replace(
            /(?<=<svg[^>]*?)(>)/i,
            ' xmlns="http://www.w3.org/2000/svg">'
          );
          svg = usvgWasm.simplifySvg(svg);
        }

        const result = compileSvg(svg);
        return result;
      }
    },
  };
};
