
const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const postcss = require('postcss');
const rootPath = require('app-root-path').path

function readConfigFile(file) {
    if (file && !path.isAbsolute(file)) {
        file = path.join(rootPath, file);
    }
    const filePath = file || path.join(rootPath, 'postcss.config.js');

    if (fs.existsSync(filePath)) {
        return require(filePath);
    }
    return {};
}

const config = readConfigFile();
const allPluginNames = config.plugins ? Object.keys(config.plugins) : [];
const subsequentPluginNames = allPluginNames.slice(allPluginNames.indexOf('postcss-extract-media-query') + 1);
const subsequentPlugins = subsequentPluginNames.map(name => require(name)(config.plugins[name]));

function applySubsequentPlugins(css, filePath) {
    if (subsequentPlugins.length) {
        return postcss(subsequentPlugins)
                .process(css, { from: filePath })
                .root
                .toString();
    }
    return css;
}

module.exports = postcss.plugin('postcss-extract-media-query', opts => {
    
    opts = _.merge({
        entry: null,
        output: {
            path: path.join(__dirname, '..'),
            name: '[name]-[query].[ext]'
        },
        queries: {},
        extractAll: true,
        stats: true
    }, opts);

    // Deprecation warnings
    // TODO: remove in future
    if (typeof opts.whitelist === 'boolean') {
        console.log(chalk.yellow('[WARNING] whitelist option is deprecated – please use extractAll'));
        if (opts.whitelist === true) {
            opts.extractAll = false;
        }
    }
    if (opts.combine) {
        console.log(chalk.yellow('[WARNING] combine option is deprecated – please use another plugin for this'));
        console.log(chalk.yellow('\trecommended: https://github.com/SassNinja/postcss-combine-media-query'));
    }
    if (opts.minimize) {
        console.log(chalk.yellow('[WARNING] minimize option is deprecated – please use another plugin for this'));
        console.log(chalk.yellow('\trecommended: https://github.com/cssnano/cssnano'));
    }

    const media = {};

    function addMedia(key, css, query) {
        if (!Array.isArray(media[key])) {
            media[key] = [];
        }
        media[key].push({ css, query });
    }

    function getMedia(key) {
        const css = media[key].map(data => data.css).join('\n');
        const query = media[key][0].query;

        return { css, query };
    }

    return (root, result) => {

        let from = 'undefined.css';

        if (opts.entry) {
            from = opts.entry;
        } else if (result.opts.from) {
            from = result.opts.from;
        }

        const file = from.match(/([^/\\]+)\.(\w+)(?:\?.+)?$/);
        const name = file[1];
        const ext = file[2];

        root.walkAtRules('media', atRule => {

            const query = atRule.params;
            const queryname = opts.queries[query] || (opts.extractAll && _.kebabCase(query));

            if (queryname) {
                const css = postcss.root().append(atRule).toString();

                addMedia(queryname, css, query);

                if (opts.output.path) {
                    atRule.remove();
                }
            }
        });

        // emit file(s) with extracted css
        if (opts.output.path) {

            Object.keys(media).forEach(queryname => {

                let { css } = getMedia(queryname);

                const newFile = opts.output.name
                                .replace(/\[name\]/g, name)
                                .replace(/\[query\]/g, queryname)
                                .replace(/\[ext\]/g, ext)

                const newFilePath = path.join(opts.output.path, newFile);

                css = applySubsequentPlugins(css, newFilePath);

                fs.outputFileSync(newFilePath, css);

                if (opts.stats === true) {
                    console.log(chalk.green('[extracted media query]'), newFile);
                }
            });
        }

        // if no output path defined (mostly testing purpose) merge back to root
        // TODO: remove this in v2 together with combine & minimize
        else {
            
            Object.keys(media).forEach(queryname => {

                let { css } = getMedia(queryname);

                css = applySubsequentPlugins(css, from);

                root.append(postcss.parse(css));
            });
        }

    };

});