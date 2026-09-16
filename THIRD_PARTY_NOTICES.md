# Third-Party Notices

Production dependencies are installed from npm and retain their own license
terms:

| Package | Pinned version | License |
|---|---:|---|
| Ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| undici | 6.28.1 | MIT |
| @types/node | 20.19.43 | MIT |

This notice does not replace dependency license files. Generated excerpts and
reports remain subject to the analyzed repository's original license.

## Regression fixture excerpts

The curated `deepseek-v4-pro-defu-*.json` test fixtures contain bounded excerpts
and source locators from [unjs/defu](https://github.com/unjs/defu), commit
`82632b66f5914e9946edce300e10633a3d5c0cb7`. They test rejection of unsupported
claims; they are not a current model benchmark or a live response archive.
The upstream [MIT license](docs/licenses/defu-MIT.txt) is included. Other fixture
repositories are small test examples, not full third-party applications.
