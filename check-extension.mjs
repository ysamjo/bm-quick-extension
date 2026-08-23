import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
    fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8')
);
const referencedFiles = new Set();

Object.values(manifest.icons || {}).forEach(file => referencedFiles.add(file));
Object.values(manifest.action?.default_icon || {}).forEach(file =>
    referencedFiles.add(file)
);
if (manifest.action?.default_popup) {
    referencedFiles.add(manifest.action.default_popup);
}
if (manifest.options_page) referencedFiles.add(manifest.options_page);
if (manifest.background?.service_worker) {
    referencedFiles.add(manifest.background.service_worker);
}
for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(file => referencedFiles.add(file));
    (script.css || []).forEach(file => referencedFiles.add(file));
}
for (const resourceGroup of manifest.web_accessible_resources || []) {
    resourceGroup.resources.forEach(file => referencedFiles.add(file));
}
for (const rule of manifest.declarative_net_request?.rule_resources || []) {
    referencedFiles.add(rule.path);
}

const missingFiles = [...referencedFiles].filter(file =>
    !fs.existsSync(path.join(projectDir, file))
);
if (missingFiles.length) {
    throw new Error(`Fehlende Manifest-Dateien: ${missingFiles.join(', ')}`);
}

const commonFiles = [
    ['shared.js', 'src/shared.js'],
    ['preclean.js', 'src/preclean.js'],
    ['worker-api-bridge.js', 'src/worker-api-bridge.js'],
    ['overview-price-badges.js', 'src/overview-price-badges.js'],
    ['brickmerge-tweaker-v140.js', 'src/brickmerge-tweaker.js']
];
const differences = commonFiles.filter(([extensionFile, userscriptFile]) =>
    !fs.readFileSync(path.join(projectDir, extensionFile)).equals(
        fs.readFileSync(path.join(projectDir, userscriptFile))
    )
);
if (differences.length) {
    throw new Error(
        `Extension und Userscript sind nicht synchron: ${differences
            .map(([file]) => file)
            .join(', ')}`
    );
}

console.log(
    `Chrome-Manifest ${manifest.version}: ${referencedFiles.size} Dateien vorhanden.`
);
