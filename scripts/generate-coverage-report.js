const fs = require('fs');
const path = require('path');

const coverageDir = path.join(__dirname, '..', 'coverage');
const finalPath = path.join(coverageDir, 'coverage-final.json');
const reportPath = path.join(coverageDir, 'coverage-report.md');

const raw = JSON.parse(fs.readFileSync(finalPath, 'utf8'));

function isSourceFile(filePath) {
    const normalized = filePath.split(path.sep).join('/');
    const srcIndex = normalized.lastIndexOf('/src/');
    if (srcIndex === -1) {
        return false;
    }
    const relative = normalized.slice(srcIndex + 1);
    return !relative.startsWith('src/test/');
}

function pct(covered, total) {
    if (total === 0) {
        return 100;
    }
    return Math.round((covered / total) * 1000) / 10;
}

function statementLines(statement) {
    const lines = [];
    for (let line = statement.start.line; line <= statement.end.line; line++) {
        lines.push(line);
    }
    return lines;
}

function uncoveredLines(fileData) {
    const covered = new Set();
    const all = new Set();
    for (const key of Object.keys(fileData.statementMap)) {
        const statement = fileData.statementMap[key];
        for (const line of statementLines(statement)) {
            all.add(line);
            if (fileData.s[key] > 0) {
                covered.add(line);
            }
        }
    }
    const uncovered = [];
    for (const line of all) {
        if (!covered.has(line)) {
            uncovered.push(line);
        }
    }
    return uncovered.sort((a, b) => a - b);
}

function formatRanges(lines) {
    if (lines.length === 0) {
        return '';
    }
    const ranges = [];
    let start = lines[0];
    let prev = lines[0];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === prev + 1) {
            prev = lines[i];
            continue;
        }
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = lines[i];
        prev = lines[i];
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    return ranges.join(', ');
}

const files = [];
for (const filePath of Object.keys(raw)) {
    if (!isSourceFile(filePath)) {
        continue;
    }
    const data = raw[filePath];
    const statementsTotal = Object.keys(data.s).length;
    const statementsCovered = Object.values(data.s).filter((count) => count > 0).length;
    const functionsTotal = Object.keys(data.f).length;
    const functionsCovered = Object.values(data.f).filter((count) => count > 0).length;
    const branchesTotal = Object.values(data.b).reduce((sum, counts) => sum + counts.length, 0);
    const branchesCovered = Object.values(data.b).reduce((sum, counts) => sum + counts.filter((count) => count > 0).length, 0);
    const uncovered = uncoveredLines(data);
    const coveredLines = new Set();
    for (const key of Object.keys(data.statementMap)) {
        const statement = data.statementMap[key];
        if (data.s[key] > 0) {
            for (const line of statementLines(statement)) {
                coveredLines.add(line);
            }
        }
    }
    const linesTotal = coveredLines.size + uncovered.length;
    files.push({
        filePath: filePath.split(path.sep).join('/').replace(/^.*\/src\//, 'src/'),
        statements: pct(statementsCovered, statementsTotal),
        branches: pct(branchesCovered, branchesTotal),
        functions: pct(functionsCovered, functionsTotal),
        lines: pct(linesTotal - uncovered.length, linesTotal),
        uncovered,
        ranges: formatRanges(uncovered)
    });
}

files.sort((a, b) => a.lines - b.lines || a.filePath.localeCompare(b.filePath));

const totalStatements = files.reduce((sum, file) => sum + file.statements, 0);
const totalBranches = files.reduce((sum, file) => sum + file.branches, 0);
const totalFunctions = files.reduce((sum, file) => sum + file.functions, 0);
const totalLines = files.reduce((sum, file) => sum + file.lines, 0);
const fileCount = files.length;

const lines = [];
lines.push('# Code Coverage Report');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push('## Overall Summary');
lines.push('');
lines.push('| Metric | Value |');
lines.push('| --- | --- |');
lines.push(`| Files | ${fileCount} |`);
lines.push(`| Statements | ${fileCount === 0 ? 100 : Math.round((totalStatements / fileCount) * 10) / 10}% |`);
lines.push(`| Branches | ${fileCount === 0 ? 100 : Math.round((totalBranches / fileCount) * 10) / 10}% |`);
lines.push(`| Functions | ${fileCount === 0 ? 100 : Math.round((totalFunctions / fileCount) * 10) / 10}% |`);
lines.push(`| Lines | ${fileCount === 0 ? 100 : Math.round((totalLines / fileCount) * 10) / 10}% |`);
lines.push('');
lines.push('## Per-File Coverage');
lines.push('');
lines.push('| File | Statements % | Branches % | Functions % | Lines % | Uncovered Lines |');
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const file of files) {
    lines.push(`| ${file.filePath} | ${file.statements} | ${file.branches} | ${file.functions} | ${file.lines} | ${file.ranges || '-'} |`);
}
lines.push('');
for (const file of files) {
    if (file.lines >= 100) {
        continue;
    }
    lines.push(`## ${file.filePath}`);
    lines.push('');
    lines.push(`Lines: ${file.lines}%`);
    lines.push('');
    lines.push(`Uncovered lines: ${file.ranges}`);
    lines.push('');
}

fs.writeFileSync(reportPath, lines.join('\n'));
console.log(`Coverage report written to ${reportPath}`);
