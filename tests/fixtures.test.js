// The fixtures are the boundary with recap, so they get tested like code: if a re-recording
// ever drops a status or turns a list into null, this is where the two ideas find out.

import { suite, test, assert, assertEqual } from './harness.js';
import { fixture, fixtureNames } from './util.js';
import { SUPPORTED_SCHEMA_VERSION, STATUS_WORDS } from '../src/lib/contract.js';

suite('fixtures', () => {
    test('there are fixtures at all', () => {
        assert(fixtureNames().length > 0, 'tests/fixtures is empty — run scripts/record-fixtures.sh');
    });

    test('every fixture is a schema version 1 document', () => {
        for (const name of fixtureNames())
            assertEqual(fixture(name).version, SUPPORTED_SCHEMA_VERSION, name);
    });

    test('every fixture has lists where version 1 promises lists', () => {
        for (const name of fixtureNames()) {
            const doc = fixture(name);
            assert(Array.isArray(doc.projects), `${name}: projects is not a list`);
            for (const project of doc.projects)
                assert(Array.isArray(project.sessions), `${name}: ${project.name} has no session list`);
        }
    });

    test('every fixture uses only the status words version 1 promises', () => {
        for (const name of fixtureNames()) {
            for (const project of fixture(name).projects) {
                assert(STATUS_WORDS.includes(project.status),
                    `${name}: ${project.name} has status "${project.status}"`);
                for (const session of project.sessions) {
                    assert(STATUS_WORDS.includes(session.status),
                        `${name}: session ${session.id} has status "${session.status}"`);
                }
            }
        }
    });

    test('every fixture says how the statuses were arrived at', () => {
        for (const name of fixtureNames()) {
            const liveness = fixture(name).liveness;
            assert(['process-table', 'unavailable'].includes(liveness),
                `${name}: liveness is "${liveness}"`);
        }
    });

    test('between them, the fixtures cover every status recap can report', () => {
        const seen = new Set();
        for (const name of fixtureNames()) {
            for (const project of fixture(name).projects)
                seen.add(project.status);
        }
        for (const word of STATUS_WORDS)
            assert(seen.has(word), `no fixture contains a "${word}" project`);
    });

    test('the empty fixture is an empty document, not an empty file', () => {
        const doc = fixture('empty');
        assert(Array.isArray(doc.projects) && doc.projects.length === 0,
            'empty.json should have projects: []');
    });

    test('one fixture pins the unreadable-session case', () => {
        const unreadable = fixture('every-status').projects
            .flatMap(p => p.sessions)
            .filter(s => s.unreadable);
        assertEqual(unreadable.length, 1, 'expected exactly one unreadable session');
        assertEqual(unreadable[0].status, 'unclear');
    });

    test('no fixture leaks the machine it was recorded on', () => {
        // scripts/record-fixtures.sh rewrites the throwaway store's path to /home/demo, in
        // both the plain and the dash-escaped spelling. A fixture with /tmp/recap-demo-xxxx
        // in it means that rewriting missed a case.
        for (const name of fixtureNames()) {
            const text = JSON.stringify(fixture(name));
            assert(!text.includes('recap-demo-'), `${name}: still mentions the recording tmpdir`);
        }
    });
});
