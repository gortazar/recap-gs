import { suite, test, assert, assertEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildRows } from '../src/lib/rows.js';
import { summarise, summariseProblem } from '../src/lib/summary.js';
import { PROBLEM, problem } from '../src/lib/problem.js';

function rows(...statuses) {
    return statuses.map((status, i) => ({
        name: `p${i}`, statusWord: status, sessionCount: 1,
    }));
}

suite('panel summary', () => {
    test('shows the most urgent status, so one waiting session is visible unopened', () => {
        assertEqual(summarise(rows('idle', 'running', 'waiting', 'finished')).iconName,
            'recap-waiting-symbolic');
        assertEqual(summarise(rows('idle', 'running', 'finished')).iconName,
            'recap-running-symbolic');
        assertEqual(summarise(rows('idle', 'finished')).iconName, 'recap-idle-symbolic');
    });

    test('counts the projects in the status it is showing', () => {
        assertEqual(summarise(rows('waiting', 'waiting', 'running', 'idle')).label, '2');
        assertEqual(summarise(rows('running', 'running', 'running')).label, '3');
    });

    test('drops the count when the user asked for just an icon', () => {
        assertEqual(summarise(rows('waiting', 'waiting'), { showCount: false }).label, '');
    });

    test('says nothing at all when there is nothing to report', () => {
        const summary = summarise([]);
        assertEqual(summary.iconName, 'recap-symbolic');
        assertEqual(summary.label, '');
        assert(summary.tooltip.length > 0, 'even an empty panel should explain itself');
    });

    test('spells the whole fleet out in the tooltip, most urgent first', () => {
        const summary = summarise(rows('idle', 'waiting', 'running', 'waiting', 'finished'));
        assertEqual(summary.tooltip,
            '2 waiting for you, 1 running, 1 idle, 1 finished');
    });

    test('counts one project as one, not as "1 projects"', () => {
        assertEqual(summarise(rows('running')).tooltip, '1 running');
    });

    test('summarises the recorded fixture the way the fixture reads', () => {
        const document = decodeDocument(fixtureText('every-status')).document;
        const summary = summarise(buildRows(document));
        // orchestrator is running, blog-pipeline is waiting: waiting wins.
        assertEqual(summary.iconName, 'recap-waiting-symbolic');
        assertEqual(summary.label, '1');
        assertEqual(summary.tooltip, '1 waiting for you, 1 running, 2 interrupted, 1 unclear, 1 idle');
    });

    test('a problem is a neutral icon and the problem\'s own words', () => {
        const summary = summariseProblem(
            problem(PROBLEM.NOT_INSTALLED, 'recap is not installed', 'Install it and this panel works.'));
        assertEqual(summary.iconName, 'recap-symbolic');
        assertEqual(summary.label, '');
        assertEqual(summary.tooltip, 'recap is not installed');
    });

    test('a problem never turns the panel into an alarm', () => {
        // A refresh failing every 30 seconds must not look like a session needing you.
        for (const kind of Object.values(PROBLEM)) {
            const summary = summariseProblem(problem(kind, 'title', 'detail'));
            assertEqual(summary.iconName, 'recap-symbolic', kind);
        }
    });
});
