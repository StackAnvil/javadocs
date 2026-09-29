import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, ".source");
const stage = join(root, ".generated-site");
const site = join(root, "site");
const publishedFile = join(root, "published.json");
const sourceRepository = "StackAnvil/patches";
const projects = [
  { id: "viabedrock", name: "ViaBedrock", java: "17" },
  { id: "viafabricplus-bedrock", name: "ViaFabricPlus Bedrock add-on", java: "25" },
  { id: "cubeconverter", name: "CubeConverter", java: "17" },
  { id: "viaproxy", name: "ViaProxy", java: "25" },
] as const;

async function run(program: string, args: string[], cwd = root, env = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code}`)));
  });
}

async function capture(program: string, args: string[]): Promise<string> {
  const output: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code}`)));
  });
  return Buffer.concat(output).toString("utf8").trim();
}

function javaHome(version: string): string {
  const path = process.env[`JAVA_HOME_${version}_X64`] ?? process.env[`STACKANVIL_JAVA_${version}`];
  if (!path || !existsSync(join(path, "bin", "java"))) {
    throw new Error(`Java ${version} is missing. Set JAVA_HOME_${version}_X64 or STACKANVIL_JAVA_${version}.`);
  }
  return path;
}

function indexHtml(tag: string): string {
  const rows = projects.map(({ id, name }) => `          <tr><td><a href="${id}/index.html">${name}</a></td><td><code>${id}</code></td></tr>`).join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>StackAnvil Javadocs</title>
    <style>
      :root { color: #252823; background: #f7f7f3; font: 16px/1.55 system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
      header { display: flex; align-items: center; gap: 16px; padding-bottom: 24px; border-bottom: 2px solid #252823; }
      header img { width: 54px; height: 54px; }
      h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.1; letter-spacing: -.035em; }
      h2 { margin: 38px 0 10px; font-size: 1.2rem; }
      p { max-width: 64ch; }
      code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 8px; border-bottom: 1px solid #d5d8d0; text-align: left; vertical-align: top; }
      th { font-size: .85rem; }
      a { color: #a34112; text-underline-offset: 3px; }
      a:hover { color: #762b0b; }
      a:focus-visible { outline: 2px solid #a34112; outline-offset: 3px; }
      footer { margin-top: 42px; padding-top: 16px; border-top: 1px solid #d5d8d0; color: #52564f; font-size: .9rem; }
      @media (max-width: 540px) { main { padding-top: 28px; } th, td { overflow-wrap: anywhere; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <img src="logo.png" alt="StackAnvil logo" width="54" height="54">
        <h1>StackAnvil Javadocs</h1>
      </header>
      <p>API documentation for the four fully patched projects in <a href="https://github.com/${sourceRepository}/releases/tag/${tag}">${tag}</a>.</p>
      <h2>Projects</h2>
      <table>
        <thead><tr><th>Project</th><th>Source folder</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <footer>Generated from the release source. See the <a href="https://github.com/${sourceRepository}">patch stack</a> or <a href="https://stackanvil-maven.pistonmaster.net/">Maven repository</a>.</footer>
    </main>
  </body>
</html>
`;
}

async function publish(): Promise<void> {
  const release = JSON.parse(await capture("gh", ["release", "view", "--repo", sourceRepository, "--json", "tagName"])) as { tagName: string };
  const tag = release.tagName;
  if (!/^stack-v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Unexpected release tag: ${tag}`);
  const published = existsSync(publishedFile)
    ? JSON.parse(await readFile(publishedFile, "utf8")) as { tag: string }
    : undefined;
  if (published?.tag === tag && existsSync(join(site, "index.html"))
    && projects.every(({ id }) => existsSync(join(site, id, "index.html")))) {
    console.log(`${tag} is already published`);
    return;
  }

  await rm(source, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
  try {
    await run("git", ["clone", "--depth", "1", "--branch", tag, "--single-branch",
      `https://github.com/${sourceRepository}.git`, source]);
    await run("bun", ["install", "--frozen-lockfile"], source);
    await run("bun", ["run", "build", "all"], source);
    const viaFabricPlus = JSON.parse(await readFile(join(source, "viafabricplus.json"), "utf8")) as { version: string };
    await mkdir(stage, { recursive: true });
    for (const project of projects) {
      const home = javaHome(project.java);
      const dir = join(source, ".worktrees", project.id);
      const args = ["./gradlew", "--no-daemon", `-PstackanvilMavenRepo=${join(source, ".stackanvil", "maven")}`];
      if (project.id === "viafabricplus-bedrock") args.push(`-PstackanvilViaFabricPlusVersion=${viaFabricPlus.version}`);
      if (project.id === "viaproxy") args.push("-I", join(root, "scripts", "viaproxy-javadoc.init.gradle"));
      args.push("javadoc");
      await run("bash", args, dir, { ...process.env, JAVA_HOME: home, PATH: `${join(home, "bin")}:${process.env.PATH ?? ""}` });
      const docs = join(dir, "build", "docs", "javadoc");
      if (!existsSync(join(docs, "index.html"))) throw new Error(`No Javadocs generated for ${project.id}`);
      await cp(docs, join(stage, project.id), { recursive: true });
    }
    await copyFile(join(root, "logo.png"), join(stage, "logo.png"));
    await writeFile(join(stage, "index.html"), indexHtml(tag));
    await writeFile(join(stage, ".nojekyll"), "");
    await rm(site, { recursive: true, force: true });
    await rename(stage, site);
    await writeFile(publishedFile, `${JSON.stringify({ tag }, null, 2)}\n`);
    console.log(`Published Javadocs for ${tag}`);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
  }
}

await publish();
