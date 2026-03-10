Forked from [pages-cms/pages-cms](https://github.com/pages-cms/pages-cms)

Upstream commit: `75d8b1e0f2069883965701b4268c79bc252a40ae`

This vendored fork is adapted for Curb's local generated-site workflow instead of
the upstream GitHub App flow. The admin route is file-backed against `sites/<slug>`
and is intended to be customized in-repo rather than consumed as an external package.
