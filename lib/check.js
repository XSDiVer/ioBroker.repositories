'use strict';
const request = require('request');
const fs      = require('fs');
const CHECKER_NAME = 'checker.js';
let checker;

function getPullRequestNumber() {
    if (process.env.GITHUB_REF) {
        const result = /refs\/pull\/(\d+)\/merge/g.exec(process.env.GITHUB_REF);
        if (!result) {
            throw new Error('Reference not found.');
        }
        return result[1];
    } else if (process.env.GITHUB_EVENT_PATH) {
        const event = JSON.parse(require('fs').readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        process.env.GITHUB_REF = event.pull_request.number;
    } else {
        throw new Error('Reference not found. process.env.GITHUB_REF and process.env.GITHUB_EVENT_PATH are not set!');
    }
}

function addLabel(prID, labels) {
    return new Promise((resolve, reject) => {
        const url = `https://api.github.com/repos/ioBroker/ioBroker.repositories/issues/${prID}/labels`;
        const options = {
            url,
            method: 'POST',
            headers: {
                Authorization: `token ${process.env.GITHUB_TOKEN}`,
                'user-agent': 'Action script'
            },
            json: {labels}
        };

        request(options, (error, response, body) => {
            if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function addComment(prID, body) {
    return new Promise((resolve, reject) => {
        const url = `https://api.github.com/repos/ioBroker/ioBroker.repositories/issues/${prID}/comments`;
        const options = {
            url,
            method: 'POST',
            headers: {
                Authorization: `token ${process.env.GITHUB_TOKEN}`,
                'user-agent': 'Action script'
            },
            json: {body}
        };

        request(options, (error, response, body) => {
            if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function getGithub(url) {
    return new Promise((resolve, reject) =>
        request({
            url,
            headers: {
                Authorization: `token ${process.env.GITHUB_TOKEN}`,
                'user-agent': 'Action script'
            }
        }, (error, response, body) => {
            if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
                resolve(body);
            } else {
                reject(error);
            }
        }));
}

function getUrl(url) {
    return new Promise((resolve, reject) =>
        request(url, (error, response, body) => {
            if (!error && (response.statusCode === 200 || response.statusCode === 201)) {
                resolve(body);
            } else {
                reject(error);
            }
        }));
}

function downloadChecker() {
    return getGithub('https://raw.githubusercontent.com/ioBroker/ioBroker.repochecker/master/index.js')
        .then(body => fs.writeFileSync(__dirname + '/' + CHECKER_NAME, body));
}

function executeOneAdapterCheck(adapter) {
    checker = checker || require('./' + CHECKER_NAME);

    return new Promise((resolve, reject) => {
        checker.handler(
            {
                queryStringParameters: {
                    url: adapter,
                }
            },
            null,
            (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    const context = JSON.parse(data.body);
                    /*if (context.errors.length) {
                        console.error(JSON.stringify(context.errors, null, 2));
                    }
                    console.log(JSON.stringify(data, null, 2));*/

                    resolve({adapter, context});
                }
            });
    });
}

function detectChanges(commit) {
    /*
    {
      "sha": "8057d13625f724f0cd126ce5c3920da580429e0b",
      "filename": "sources-dist.json",
      "status": "modified",
      "additions": 5,
      "deletions": 0,
      "changes": 5,
      "blob_url": "https://github.com/ioBroker/ioBroker.repositories/blob/024bd5ccecc3c37dc6faf672fbfbd9f072f0189f/sources-dist.json",
      "raw_url": "https://github.com/ioBroker/ioBroker.repositories/raw/024bd5ccecc3c37dc6faf672fbfbd9f072f0189f/sources-dist.json",
      "contents_url": "https://api.github.com/repos/ioBroker/ioBroker.repositories/contents/sources-dist.json?ref=024bd5ccecc3c37dc6faf672fbfbd9f072f0189f",
      "patch": "@@ -1436,6 +1436,11 @@\n     \"icon\": \"https://raw.githubusercontent.com/ioBroker/ioBroker.vis-hqwidgets/master/admin/hqwidgets.png\",\n     \"type\": \"visualization-widgets\"\n   },\n+  \"vis-inventwo\": {\n+    \"meta\": \"https://raw.githubusercontent.com/inventwo/ioBroker.vis-inventwo/master/io-package.json\",\n+    \"icon\": \"https://raw.githubusercontent.com/inventwo/ioBroker.vis-inventwo/master/admin/i_150.png\",\n+    \"type\": \"visualisation-widgets\"\n+  },\n   \"vis-jqui-mfd\": {\n     \"meta\": \"https://raw.githubusercontent.com/ioBroker/ioBroker.vis-jqui-mfd/master/io-package.json\",\n     \"icon\": \"https://raw.githubusercontent.com/ioBroker/ioBroker.vis-jqui-mfd/master/admin/jqui-mfd.png\","
    }
     */
    return getGithub(commit.raw_url)
        .then(json => {
            let patch = commit.patch.split('@@').map(t => t.trim()).filter(t => t);
            json = json.split('\n');
            const adapters = [];
            let totalOffset = 0;
            for (let i = 0; i < patch.length; i += 2) {
                const changes = patch[i];
                const lines = patch[i + 1].split('\n');
                const added = lines
                    .filter(line => line.match(/^\+\s*"[-_a-z\d]+"\s*:\s*{$/))
                    .map(line => line.match(/^\+\s*"([-_a-z\d]+)"\s*:\s*{$/)[1]);

                let found = false;
                let offset = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('-')) {
                        totalOffset--;
                        !found && offset--;
                    } else if (lines[i].startsWith('+')) {
                        totalOffset++;
                        !found && offset++;
                        found = true;
                    } else {
                        !found && offset++;
                    }
                }
                if (!added.length && found) {
                    let start = parseInt(changes.replace(/-/g, '')) + offset + totalOffset;
                    let lastAdapter = '';
                    for (let k = 0; k < json.length; k++) {
                        const m = json[k].match(/^\s*"([-_a-z\d]+)"\s*:\s*{$/);
                        if (m) {
                            lastAdapter = m[1];
                        }
                        if (k >= start) {
                            if (!added.includes(lastAdapter)) {
                                added.push(lastAdapter);
                            }
                            break;
                        }
                    }
                }

                added.forEach(a => !adapters.includes(a) && adapters.push(a));
            }

            const repo = JSON.parse(json.join('\n'));

            return adapters.map(a => repo[a].meta.replace(/\/master\/io\-package.json$/, ''));
        });
}

function detectAffectedAdapter(prID) {
    return getGithub(`https://api.github.com/repos/ioBroker/ioBroker.repositories/pulls/${prID}`)
        .then(body => JSON.parse(body).commits_url)
        // https://api.github.com/repos/ioBroker/ioBroker.repositories/pulls/632/commits => [0].sha
        .then(commits_url => getGithub(commits_url))
        .then(body => {
            const commits = JSON.parse(body);
            let adapters = [];

            return Promise.all(
                commits.map(commit =>
                    getGithub(`https://api.github.com/repos/ioBroker/ioBroker.repositories/commits/${commit.sha}`)
                        .then(body => {
                            const commit = JSON.parse(body);
                            return commit.files;
                        })
                        .then(files => {
                            files = files.filter(item => item.filename.startsWith('sources-dist'));

                            return Promise.all(files.map(item => detectChanges(item))).then(result =>
                                result.filter(a => a && a.length).forEach(a => adapters = adapters.concat(a)));
                        }))
                )
                .then(() => adapters);
        });
}

function decorateLine(line) {
    if (line.noDecorate) {
        return line.text;
    }
    let m = line.text.match(/"npm owner add bluefox iobroker\.([-_a-z\d]+)"/);
    if (m) {
        line.text = line.text.replace(`"npm owner add bluefox iobroker.${m[1]}"`, "`npm owner add bluefox iobroker." + m[1] + "`");
    }

    m = line.text.match(/"Manage topics"/);
    if (m) {
        line.text = line.text.replace(`"Manage topics"`, "`Manage topics`");
    }

    m = line.text.match(/"## License"/);
    if (m) {
        line.text = line.text.replace(`"## License"`, "`## License`");
    }

    m = line.text.match(/travis/);
    if (m) {
        line.text = line.text.replace(/travis/g, `[travis](https://travis-ci.org/)`);
    }

    m = line.text.match(/Travis\-ci\.org/);
    if (m) {
        line.text = line.text.replace(`Travis-ci.org`, `[Travis-ci.org](https://travis-ci.org/${line.owner}/${line.adapter})`);
    }

    m = line.text.match(/ README.md/);
    if (m) {
        line.text = line.text.replace(/ README.md/g, " [README.md](" + line.link + "/blob/master/README.md)");
    }

    m = line.text.match(/ io\-package\.json/);
    if (m) {
        line.text = line.text.replace(/ io-package.json/g, ` [io-package.json]("${line.link}/blob/master/io-package.json)`);
    }

    m = line.text.match(/ package\.json/);
    if (m) {
        line.text = line.text.replace(/ package.json/g, ` [package.json]("${line.link}/blob/master/package.json)`);
    }

    m = line.text.match(/ node_modules/);
    if (m) {
        line.text = line.text.replace(/ node_modules/g, ` [node_modules]("${line.link}/tree/master/node_modules)`);
    }

    m = line.text.match(/ NPM/);
    if (m) {
        line.text = line.text.replace(/ NPM/g, ` [NPM]("https://www.npmjs.com/package/${line.adapter.toLowerCase()})`);
    }

    m = line.text.match(/"iob_npm.done"/);
    if (m) {
        line.text = line.text.replace(`"iob_npm.done"`, `"[iob_npm.done]("${line.link}/blob/master/iob_npm.done)`);
    }

    return line.text;
}

function doIt() {
    const gPrID = getPullRequestNumber();

    return downloadChecker()
        .then(() => detectAffectedAdapter(gPrID))
        .then(links => Promise.all(links.map(link => executeOneAdapterCheck(link))))
        .then(results => {
            // check if badges exists
            return Promise.all(results.map(data => {
                const parts = data.adapter.split('/');
                const adapter = parts.pop();
                const badge = `http://iobroker.live/badges/${adapter.replace('ioBroker.', '')}-installed.svg`;
                console.log(badge);

                return getUrl(badge)
                    .catch(e => '')
                    .then(svg => data.badgeLatest = (svg || '').toString().startsWith('<svg '))
                    .then(() => getUrl(`http://iobroker.live/badges/${adapter.replace('ioBroker.', '')}-stable.svg`))
                    .catch(e => '')
                    .then(svg => data.badgeStable = (svg || '').toString().startsWith('<svg '))
            })).then(() => results);
        })
        .then(results => {
            let comments = [{text: '## Automated adapter checker'}];
            let someChecked = false;
            let errorsFound = false;

            results.forEach(data => {
                const parts = data.adapter.split('/');
                const adapter = parts.pop().replace('iobroker', 'ioBroker');
                const owner = parts.pop();
                const link = `https://github.com/${owner}/${adapter}`;

                comments.push({text: `\n### [${adapter}](${link})`, link, owner, adapter, noDecorate: true});

                let badges = `[![Downloads](https://img.shields.io/npm/dm/${adapter.replace('ioBroker.', 'iobroker.')}.svg)](https://www.npmjs.com/package/${adapter.replace('ioBroker.', 'iobroker.')}) `;
                if (data.badgeLatest) {
                    badges += `![Number of Installations (latest)](http://iobroker.live/badges/${adapter.replace('ioBroker.', '')}-installed.svg) `;
                }
                if (data.badgeStable) {
                    badges += `![Number of Installations (stable)](http://iobroker.live/badges/${adapter.replace('ioBroker.', '')}-stable.svg)`;
                }

                comments.push({text: badges, noDecorate: true});
                comments.push({text: `[![NPM](https://nodei.co/npm/${adapter.replace('ioBroker.', 'iobroker.')}.png?downloads=true)](https://nodei.co/npm/${adapter.replace('ioBroker.', 'iobroker.')}/)\n`, noDecorate: true});

                if (data.context) {
                    someChecked = true;

                    if (data.context.errors && data.context.errors.length) {
                        errorsFound = true;
                        data.context.errors.forEach(err => comments.push({text: '- [ ] :heavy_exclamation_mark: ' + err, link, owner, adapter}));
                    } else {
                        comments.push({text: ':thumbsup: No errors found', link, owner, adapter, noDecorate: true});
                    }

                    if (data.context.warnings && data.context.warnings.length) {
                        data.context.warnings.forEach(warn => comments.push({text: '- [ ] :eyes: ' + warn, link, owner, adapter}));
                    }
                }
            });
            const promises = [];
            if (!someChecked) {
                comments.push({text: 'No changed adapters found', noDecorate: true});
            } else {
                if (errorsFound) {
                    promises.push(addLabel(gPrID, ['must be fixed', 'auto-checked']));
                } else {
                    promises.push(addLabel(gPrID, ['auto-checked']));
                }
            }

            // decorate
            const comment = comments.map(line => decorateLine(line)).join('\n');

            console.log('ADD PULL REQUEST COMMENT:');
            console.log(comment);

            promises.push(addComment(gPrID, comment));

            return Promise.all(promises);
        });
}

doIt()
    .then(() => console.log('done'))
    .catch(e => console.error(e));