import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { fixtureText } from './util.js';
import { buildArgv, classifyOutcome } from '../src/lib/recap.js';
import { PROBLEM } from '../src/lib/problem.js';

function problemOf(outcome) {
    const result = classifyOutcome(outcome);
    assert(!result.ok, `expected a problem, got ${JSON.stringify(result)}`);
    return result.problem;
}

suite('the recap command line', () => {
    test('asks for the machine-readable report and nothing else by default', () => {
        assertDeepEqual(buildArgv({}), ['recap', '--json']);
    });

    test('runs the binary the user configured', () => {
        assertDeepEqual(buildArgv({ path: '/opt/bin/recap' }), ['/opt/bin/recap', '--json']);
        // A bare name is left for PATH to resolve, which is what the default relies on.
        assertDeepEqual(buildArgv({ path: 'recap-dev' }), ['recap-dev', '--json']);
    });

    test('falls back to plain recap when the configured path is blank', () => {
        assertDeepEqual(buildArgv({ path: '   ' }), ['recap', '--json']);
    });

    test('passes the filters through as recap\'s own flags', () => {
        assertDeepEqual(buildArgv({ since: '2d' }), ['recap', '--json', '--since', '2d']);
        assertDeepEqual(buildArgv({ agent: 'claude' }), ['recap', '--json', '--agent', 'claude']);
        assertDeepEqual(buildArgv({ roots: ['/home/me/git', '/srv/work'] }),
            ['recap', '--json', '--root', '/home/me/git', '--root', '/srv/work']);
    });

    test('leaves recap\'s own defaults alone when a filter is unset', () => {
        // "all agents" is the absence of --agent, not an --agent value.
        assertDeepEqual(buildArgv({ agent: 'all', since: '', roots: [] }), ['recap', '--json']);
        assertDeepEqual(buildArgv({ agent: '  ', since: '  ', roots: ['', '  '] }),
            ['recap', '--json']);
    });

    test('never passes --smart: a panel refresh must not cost money or a network call', () => {
        const argv = buildArgv({ since: '2d', agent: 'opencode', roots: ['/x'] });
        assert(!argv.includes('--smart'), 'the panel must never invoke the model path');
    });
});

suite('classifying how recap ran', () => {
    test('a clean run with a report is the report', () => {
        const result = classifyOutcome({ exitStatus: 0, stdout: fixtureText('every-status') });
        assert(result.ok, 'a good run should decode');
        assertEqual(result.document.projects.length, 6);
    });

    test('a missing binary is its own problem, and says how to fix it', () => {
        const problem = problemOf({ failedToStart: true, notFound: true, message: 'No such file' });
        assertEqual(problem.kind, PROBLEM.NOT_INSTALLED);
        assert(problem.detail.toLowerCase().includes('install'),
            'the one actionable case should say what the action is');
    });

    test('a failure to start that is not a missing binary is not blamed on recap', () => {
        const problem = problemOf({ failedToStart: true, notFound: false, message: 'Permission denied' });
        assertEqual(problem.kind, PROBLEM.NOT_RUN);
        assert(problem.detail.includes('Permission denied'), 'should pass on what went wrong');
    });

    test('being cancelled at the timeout is a timeout, not a failure', () => {
        const problem = problemOf({ cancelled: true, timedOut: true, timeoutSeconds: 10 });
        assertEqual(problem.kind, PROBLEM.TIMED_OUT);
        assert(problem.detail.includes('10'), 'should say how long it waited');
    });

    test('a non-zero exit reports what recap said on stderr', () => {
        const problem = problemOf({
            exitStatus: 2,
            stdout: '',
            stderr: 'recap: unknown flag --nope\nusage: recap [flags]\n',
        });
        assertEqual(problem.kind, PROBLEM.FAILED);
        assert(problem.detail.includes('unknown flag --nope'), 'should quote recap');
        assert(!problem.detail.includes('usage:'),
            'one line of stderr is a message; ten are a wall of text in a menu');
    });

    test('a non-zero exit with a silent stderr still says the exit code', () => {
        const problem = problemOf({ exitStatus: 3, stdout: '', stderr: '' });
        assertEqual(problem.kind, PROBLEM.FAILED);
        assert(problem.detail.includes('3'), 'should name the exit status');
    });

    test('a clean exit with nothing printed is a no-output problem', () => {
        assertEqual(problemOf({ exitStatus: 0, stdout: '' }).kind, PROBLEM.NO_OUTPUT);
    });

    test('a clean exit printing rubbish is an unreadable-output problem', () => {
        assertEqual(problemOf({ exitStatus: 0, stdout: 'hello?' }).kind, PROBLEM.UNREADABLE_OUTPUT);
    });

    test('cancellation that is not a timeout is nobody\'s problem', () => {
        // The extension was disabled, or a refresh was superseded. There is no user to tell.
        const result = classifyOutcome({ cancelled: true, timedOut: false });
        assert(!result.ok, 'a cancelled run has no document');
        assertEqual(result.problem, null);
    });

    test('never throws, whatever the seam hands it', () => {
        for (const outcome of [{}, null, undefined, { exitStatus: 'two' }, { stdout: 42 }])
            classifyOutcome(outcome);
    });
});
