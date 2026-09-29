# StackAnvil Javadocs

This repository publishes the Javadocs for all four fully patched projects in the [latest StackAnvil release](https://github.com/StackAnvil/patches/releases). The site is available at [stackanvil-jd.pistonmaster.net](https://stackanvil-jd.pistonmaster.net/).

The [publish workflow](.github/workflows/publish.yml) checks for a new release each hour. When it finds one, it checks out that release tag and builds all four projects with the JDKs specified by the patch stack. It then generates each project's Javadocs and deploys the site with GitHub Pages. ViaProxy disables Javadocs in its upstream build, so a Gradle init script enables the task and adds the annotation dependency needed by its documentation tool. The source repositories are not changed.

The site always shows the latest release. Existing links under a project's folder will resolve to the new release after an update. Use the release link on the index page when you need to identify the documented version.
