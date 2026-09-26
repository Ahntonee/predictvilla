/* Compares literal frontend API calls with Express route declarations. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Recursively collects JavaScript and HTML files used by the browser.
function collectFrontendFiles(directory, files = []) {
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) collectFrontendFiles(filePath, files);
    else if (/\.(?:html|js)$/.test(name)) files.push(filePath);
  }
  return files;
}

// Joins an Express mount prefix and router path without duplicate slashes.
function joinRoute(prefix, route) {
  return `${prefix}/${route}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// Converts an Express path into a regular expression suitable for call matching.
function routePattern(route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

// Normalises a literal or template API call into its comparable pathname.
function normaliseCall(raw, helperName) {
  let value = raw.replace(/([A-Za-z0-9])\$\{[^}]+\}$/, '$1');
  value = value.split('?')[0].replace(/\$\{[^}]+\}/g, 'value');
  if (helperName === 'api') value = `/api${value}`;
  return value.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// Builds the complete method/path set from direct app routes and mounted routers.
function collectServerRoutes() {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const routes = [];
  for (const match of server.matchAll(/app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }
  for (const mount of server.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g)) {
    const prefix = mount[1];
    const routerFile = path.join(ROOT, 'routes', `${mount[2]}.js`);
    if (!fs.existsSync(routerFile)) continue;
    const source = fs.readFileSync(routerFile, 'utf8');
    for (const route of source.matchAll(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]*)['"]/g)) {
      routes.push({ method: route[1].toUpperCase(), path: joinRoute(prefix, route[2]) });
    }
  }
  return routes;
}

// Reports frontend calls for which no Express route with the same method exists.
function runAudit() {
  const serverRoutes = collectServerRoutes();
  const issues = [];
  for (const filePath of collectFrontendFiles(path.join(ROOT, 'public'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const call of source.matchAll(/\b(fetch|api)\(\s*([`'"])(\/[^`'"]+)\2/g)) {
      const helper = call[1];
      const route = normaliseCall(call[3], helper);
      if (!route.startsWith('/api/')) continue;
      const statementEnd = source.indexOf(';', call.index);
      const following = source.slice(call.index, statementEnd < 0 ? call.index + 500 : statementEnd);
      const method = following.match(/\bmethod\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/i)?.[1].toUpperCase() || 'GET';
      const dynamicCallPattern = new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/value/g, '[^/]+')}$`);
      const found = serverRoutes.some(candidate => candidate.method === method
        && (routePattern(candidate.path).test(route) || dynamicCallPattern.test(candidate.path)));
      if (!found) issues.push(`${path.relative(ROOT, filePath)}: ${method} ${route}`);
    }
  }
  const unique = [...new Set(issues)];
  if (unique.length) {
    console.error(unique.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Route audit passed against ${serverRoutes.length} mounted API routes.`);
  }
}

runAudit();
