/* Audits static frontend pages for broken local assets, handlers and scripts. */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// Recursively collects HTML pages from the public application directory.
function collectHtmlFiles(directory, files = []) {
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) collectHtmlFiles(filePath, files);
    else if (name.endsWith('.html')) files.push(filePath);
  }
  return files;
}

// Returns true for URLs resolved dynamically by Express rather than static files.
function isDynamicRoute(url) {
  return url === '/' || /^\/(predictions|prediction|league|blog|tips)\//.test(url);
}

// Resolves a page-relative or site-absolute static asset path.
function resolveStaticTarget(pagePath, url) {
  return url.startsWith('/')
    ? path.join(PUBLIC_DIR, url.slice(1))
    : path.resolve(path.dirname(pagePath), url);
}

// Extracts inline scripts while excluding external script tags.
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/type=["']application\/ld\+json["']/i.test(match[1]))
    .map(match => match[2])
    .filter(script => script.trim());
}

// Replaces server-side template tokens so template scripts can be syntax checked.
function normaliseTemplateScript(script) {
  return script
    .replace(/__SEO_ARTICLE_JSON__/g, '{}')
    .replace(/'__[A-Z0-9_]+__'/g, "''")
    .replace(/__[A-Z0-9_]+__/g, 'null');
}

// Audits all public and admin HTML pages and exits unsuccessfully on confirmed issues.
function runAudit() {
  const issues = [];
  const files = collectHtmlFiles(PUBLIC_DIR);
  const sharedPublic = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'app.js'), 'utf8');
  const sharedAdmin = fs.readFileSync(path.join(PUBLIC_DIR, 'admin', 'admin.js'), 'utf8');

  for (const filePath of files) {
    const relative = path.relative(path.resolve(__dirname, '..'), filePath);
    const html = fs.readFileSync(filePath, 'utf8');
    const sharedCode = filePath.includes(`${path.sep}admin${path.sep}`) ? sharedAdmin : sharedPublic;
    const allCode = `${html}\n${sharedCode}`;
    const scriptCode = `${inlineScripts(html).join('\n')}\n${sharedCode}`;

    for (const match of html.matchAll(/(?:href|src)=["']([^"'#?]+)["']/gi)) {
      const url = match[1];
      if (url.includes('${') || /^(https?:|mailto:|tel:|data:|javascript:|\/api\/)/i.test(url) || isDynamicRoute(url)) continue;
      const target = resolveStaticTarget(filePath, url);
      if (path.extname(target) && !fs.existsSync(target)) issues.push(`${relative}: missing local target ${url}`);
    }

    const handlers = [...html.matchAll(/on(?:click|change|input|submit|keyup)=["']\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/gi)]
      .map(match => match[1]);
    for (const handler of new Set(handlers)) {
      const definition = new RegExp(`(?:function\\s+${handler}\\s*\\(|(?:window\\.)?${handler}\\s*=)`);
      if (!definition.test(allCode)) issues.push(`${relative}: inline handler ${handler}() has no definition`);
    }

    for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attributes = match[1];
      if (/\bonclick\s*=|\btype\s*=\s*["']submit["']/i.test(attributes)) continue;
      const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const dataNames = [...attributes.matchAll(/\b(data-[\w-]+)(?:\s*=|\s|$)/gi)].map(item => item[1]);
      const classes = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1].split(/\s+/) || [];
      const connected = (id && scriptCode.includes(id))
        || dataNames.some(name => scriptCode.includes(name))
        || classes.some(name => name && scriptCode.includes(`.${name}`));
      if (!connected) {
        const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
        issues.push(`${relative}: button "${label || '(icon)'}" has no detectable event connection`);
      }
    }

    inlineScripts(html).forEach((script, index) => {
      try { new Function(normaliseTemplateScript(script)); }
      catch (error) { issues.push(`${relative}: inline script ${index + 1} does not parse (${error.message})`); }
    });
  }

  if (issues.length) {
    console.error(issues.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Frontend audit passed for ${files.length} HTML pages.`);
  }
}

runAudit();
