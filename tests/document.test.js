import { suite, test, assert, assertEqual } from './harness.js';
import { fixtureText, fixture } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { PROBLEM } from '../src/lib/problem.js';

function problemOf(text) {
    const result = decodeDocument(text);
    assert(!result.ok, `expected a problem, got a document: ${JSON.stringify(result)}`);
    return result.problem;
}

suite('document decoding', () => {
    test('accepts every recorded fixture', () => {
        for (const name of ['every-status', 'empty', 'finished', 'no-liveness']) {
            const result = decodeDocument(fixtureText(name));
            assert(result.ok, `${name}: ${result.ok ? '' : result.problem.detail}`);
            assertEqual(result.document.projects.length, fixture(name).projects.length, name);
        }
    });

    test('keeps the fields the extension shows', () => {
        const doc = decodeDocument(fixtureText('every-status')).document;
        const running = doc.projects.find(p => p.status === 'running');
        assertEqual(running.name, 'orchestrator');
        assertEqual(running.sessions[0].agent, 'Claude Code');
        assertEqual(doc.liveness, 'process-table');
    });

    test('ignores fields it has never heard of, so recap can add some', () => {
        const doc = JSON.parse(fixtureText('empty'));
        doc.weather = 'fine';
        doc.projects.push({ name: 'p', status: 'idle', recap: '', sessions: [], moon_phase: 'gibbous' });
        const result = decodeDocument(JSON.stringify(doc));
        assert(result.ok, 'an added field should not be a problem');
        assertEqual(result.document.projects[0].name, 'p');
    });

    test('refuses a version it does not understand, and says both versions', () => {
        const doc = JSON.parse(fixtureText('every-status'));
        doc.version = 2;
        const problem = problemOf(JSON.stringify(doc));
        assertEqual(problem.kind, PROBLEM.UNSUPPORTED_VERSION);
        assert(problem.detail.includes('2'), 'should name the version recap emitted');
        assert(problem.detail.includes('1'), 'should name the version we understand');
    });

    test('refuses an older version too — 0 is not "close enough" to 1', () => {
        const doc = JSON.parse(fixtureText('every-status'));
        doc.version = 0;
        assertEqual(problemOf(JSON.stringify(doc)).kind, PROBLEM.UNSUPPORTED_VERSION);
    });

    test('reports output that is not JSON at all', () => {
        const problem = problemOf('recap: command not found\n');
        assertEqual(problem.kind, PROBLEM.UNREADABLE_OUTPUT);
    });

    test('reports empty output as its own case, not as broken JSON', () => {
        // A recap that printed nothing has failed differently from one that printed
        // rubbish, and the menu should not blame the JSON.
        assertEqual(problemOf('').kind, PROBLEM.NO_OUTPUT);
        assertEqual(problemOf('   \n\t ').kind, PROBLEM.NO_OUTPUT);
    });

    test('reports JSON that is not a recap document', () => {
        assertEqual(problemOf('[1, 2, 3]').kind, PROBLEM.NOT_A_DOCUMENT);
        assertEqual(problemOf('"hello"').kind, PROBLEM.NOT_A_DOCUMENT);
        assertEqual(problemOf('null').kind, PROBLEM.NOT_A_DOCUMENT);
        assertEqual(problemOf('{}').kind, PROBLEM.NOT_A_DOCUMENT);
        assertEqual(problemOf('{"version": "1"}').kind, PROBLEM.NOT_A_DOCUMENT);
    });

    test('demands the lists version 1 guarantees', () => {
        assertEqual(problemOf('{"version": 1}').kind, PROBLEM.NOT_A_DOCUMENT);
        assertEqual(problemOf('{"version": 1, "projects": null}').kind, PROBLEM.NOT_A_DOCUMENT);
        assert(decodeDocument('{"version": 1, "projects": []}').ok);
    });

    test('survives a project entry that is nonsense, rather than losing the document', () => {
        // One bad row is not a reason to show nothing: the row model is what has to cope
        // with it, so decoding must let it through.
        const result = decodeDocument('{"version": 1, "projects": [null, 7, {"name": "ok"}]}');
        assert(result.ok, 'a malformed project should not sink the whole document');
        assertEqual(result.document.projects.length, 3);
    });

    test('never throws, whatever it is handed', () => {
        for (const input of ['', '{', '}{', '   ', 'undefined', '{"version":1,"projects":[', null, undefined])
            decodeDocument(input);
    });
});
