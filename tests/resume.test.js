import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildRows } from '../src/lib/rows.js';
import {
    agentCommand, TERMINALS, pickTerminal, buildResumeLaunch,
} from '../src/lib/resume.js';

const everything = () => true;
const nothing = () => false;

suite('resuming an agent session', () => {
    test('resumes Claude Code by session id', () => {
        assertDeepEqual(agentCommand({ agent: 'Claude Code', id: 'aaaa1111' }),
            ['claude', '--resume', 'aaaa1111']);
    });

    test('resumes opencode by session id', () => {
        assertDeepEqual(agentCommand({ agent: 'opencode', id: 'ses_123' }),
            ['opencode', '--session', 'ses_123']);
    });

    test('does not care how recap spelled the agent', () => {
        assertDeepEqual(agentCommand({ agent: 'claude code', id: 'x' }), ['claude', '--resume', 'x']);
        assertDeepEqual(agentCommand({ agent: 'OpenCode', id: 'x' }), ['opencode', '--session', 'x']);
    });

    test('refuses an agent it does not know how to resume', () => {
        // Guessing at a command line for an unknown agent is how you end up running
        // something surprising in somebody's project directory.
        assertEqual(agentCommand({ agent: 'aider', id: 'x' }), null);
        assertEqual(agentCommand({ agent: '', id: 'x' }), null);
        assertEqual(agentCommand({ id: 'x' }), null);
        assertEqual(agentCommand({ agent: 'Claude Code', id: '' }), null);
        assertEqual(agentCommand(null), null);
    });
});

suite('choosing a terminal', () => {
    test('uses the terminal the user configured, if it is there', () => {
        const terminal = pickTerminal('konsole', name => name === 'konsole');
        assertEqual(terminal.name, 'konsole');
    });

    test('knows how each terminal it lists takes a command', () => {
        for (const terminal of TERMINALS) {
            const argv = terminal.argv('/work', ['claude', '--resume', 'x']);
            assertEqual(argv[0], terminal.name);
            assert(argv.includes('claude'), `${terminal.name}: the command is not in the argv`);
            assert(argv.includes('--resume'), `${terminal.name}: the command's arguments are lost`);
        }
    });

    test('every terminal that can be told a directory is told it', () => {
        for (const terminal of TERMINALS) {
            const argv = terminal.argv('/work', ['claude']).join(' ');
            if (terminal.passesDirectory)
                assert(argv.includes('/work'), `${terminal.name}: never told where to start`);
        }
    });

    test('falls back to whichever known terminal is installed', () => {
        const terminal = pickTerminal('', name => name === 'xterm');
        assertEqual(terminal.name, 'xterm');
    });

    test('prefers the GNOME terminals when several are installed', () => {
        // This is a GNOME Shell extension: the desktop's own terminal is the least
        // surprising window to open.
        assertEqual(pickTerminal('', everything).name, TERMINALS[0].name);
        assert(['kgx', 'ptyxis'].includes(TERMINALS[0].name),
            `expected a GNOME terminal first, got ${TERMINALS[0].name}`);
    });

    test('a configured terminal that is not installed falls back rather than failing', () => {
        const terminal = pickTerminal('not-a-terminal', name => name === 'xterm');
        assertEqual(terminal.name, 'xterm');
    });

    test('an unknown but installed terminal is used as given, with -e', () => {
        // Someone's favourite terminal that this list has never heard of still works, as
        // long as it takes -e, which nearly all of them do.
        const terminal = pickTerminal('st', name => name === 'st');
        assertEqual(terminal.name, 'st');
        assertDeepEqual(terminal.argv('/work', ['claude', '-r', 'x']),
            ['st', '-e', 'claude', '-r', 'x']);
    });

    test('says so when there is no terminal at all', () => {
        assertEqual(pickTerminal('', nothing), null);
    });
});

suite('launching the resume', () => {
    const target = { agent: 'Claude Code', id: 'aaaa1111', dir: '/home/me/git/orchestrator' };

    test('opens the session\'s own directory, which is the whole point', () => {
        // The idea text is explicit: it must be restored from the folder it was running in.
        const launch = buildResumeLaunch(target, { terminal: 'kgx', isAvailable: everything });
        assertEqual(launch.cwd, '/home/me/git/orchestrator');
        assert(launch.argv.join(' ').includes('/home/me/git/orchestrator'),
            'the terminal is not told the directory either');
    });

    test('runs the resume command in it', () => {
        const launch = buildResumeLaunch(target, { terminal: 'kgx', isAvailable: everything });
        assertDeepEqual(launch.argv,
            ['kgx', '--working-directory=/home/me/git/orchestrator', '--',
                'claude', '--resume', 'aaaa1111']);
    });

    test('explains itself rather than failing silently when there is no terminal', () => {
        const launch = buildResumeLaunch(target, { terminal: '', isAvailable: nothing });
        assertEqual(launch.argv, null);
        assert(launch.problem.includes('terminal'), launch.problem);
    });

    test('explains itself when the agent is not one it can resume', () => {
        const launch = buildResumeLaunch({ ...target, agent: 'aider' },
            { terminal: 'kgx', isAvailable: everything });
        assertEqual(launch.argv, null);
        assert(launch.problem.includes('aider'), launch.problem);
    });

    test('resumes what the recorded report says is waiting for you', () => {
        // End to end over a real recap document: the row a user would click, resumed.
        const document = decodeDocument(fixtureText('every-status')).document;
        const row = buildRows(document).find(r => r.statusWord === 'waiting');
        const launch = buildResumeLaunch(row.resume, { terminal: 'kgx', isAvailable: everything });
        assertDeepEqual(launch.argv, [
            'kgx', '--working-directory=/home/demo/projects/blog-pipeline', '--',
            'claude', '--resume', 'bbbb2222',
        ]);
    });
});
